import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getCairoDateKey,
  getSaturdayWeekStart,
  shiftWeekStart,
} = require('@zayed-mart/shared');

describe('ZayedMart NestJS API + Global Walkie-Talkie + Zero-Conflict Sync E2E', () => {
  let nestApp;
  let baseUrl = '';
  let tempDir = '';
  let ownerToken = '';
  let securityToken = '';
  let hallToken = '';
  let managerToken = '';
  let cashier1Token = '';
  let cashier2Token = '';
  let cashier3Token = '';
  let cashier1Id = '';
  let cashier2Id = '';
  let cashier3Id = '';
  let hallEmpId = '';
  let secEmpId = '';
  let currentWeek = '';
  let nextWeek = '';
  let prevWeek = '';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zayed-nest-e2e-'));
    process.env.ZAYED_TEST_DB_PATH = path.join(tempDir, 'test_zayed.db');
    process.env.ZAYED_UPLOADS_DIR = path.join(tempDir, 'uploads');
    process.env.ZAYED_DISABLE_CLOUD_BROADCAST = '1';
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_PRISMA_URL;

    const { createZayedNestApp } = require('../dist/app.factory.js');
    nestApp = await createZayedNestApp({ serveSpa: false, quietLogs: true });
    await nestApp.listen(0, '127.0.0.1');
    const addr = nestApp.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (nestApp) {
      await nestApp.close();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore Windows file lock delay
    }
  });

  async function api(endpoint, method = 'GET', body = undefined, token = '') {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  it('1. serves NestJS + Turborepo health check and public store info without leaking secrets', async () => {
    const health = await api('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.framework, 'nestjs');
    assert.equal(health.json.monorepo, 'turborepo');
    assert.equal(health.json.cloudRealtime, true);

    const info = await api('/api/auth/store-info');
    assert.equal(info.status, 200);
    assert.equal(info.json.ok, true);
    assert.ok(info.json.store_name);
    assert.equal(info.json.session_hmac_secret, undefined);
  });

  it('2. authenticates owner (PIN 123) and enforces 401 on unauthenticated requests', async () => {
    const unauth = await api('/api/bootstrap');
    assert.equal(unauth.status, 401);

    const login = await api('/api/auth/login', 'POST', { password: '١٢٣' }); // Arabic-Indic digits supported!
    assert.equal(login.status, 200);
    assert.equal(login.json.ok, true);
    assert.equal(login.json.user.role, 'owner');
    assert.ok(login.json.token);
    ownerToken = login.json.token;

    const boot = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    assert.equal(boot.status, 200);
    assert.equal(boot.json.cloudRealtime.enabled, true);
    assert.ok(boot.json.cloudRealtime.url.includes('supabase.co'));
  });

  it('3. creates employees (Security & Hall) and syncs cross-device login accounts without conflict', async () => {
    const secEmp = await api(
      '/api/employees',
      'POST',
      {
        name: 'أحمد حارس البوابة',
        emp_code: '501',
        department: 'أمن وبوابة',
        system_role: 'security',
        login_enabled: 1,
      },
      ownerToken
    );
    assert.equal(secEmp.status, 201);
    assert.equal(secEmp.json.employee.system_role, 'security');

    const hallEmp = await api(
      '/api/employees',
      'POST',
      {
        name: 'كريم منسق الممر',
        emp_code: '502',
        department: 'منسقي ممرات',
        system_role: 'hall',
        login_enabled: 1,
      },
      ownerToken
    );
    assert.equal(hallEmp.status, 201);

    // Login as Security Guard (PIN 501) and Hall Staff (PIN 502)
    const secLogin = await api('/api/auth/login', 'POST', { password: '501' });
    assert.equal(secLogin.status, 200);
    assert.equal(secLogin.json.user.role, 'security');
    securityToken = secLogin.json.token;

    const hallLogin = await api('/api/auth/login', 'POST', { password: '502' });
    assert.equal(hallLogin.status, 200);
    assert.equal(hallLogin.json.user.role, 'hall');
    hallToken = hallLogin.json.token;

    // Verify PC & Phone both see exact same 2 employees via bootstrap
    const secBoot = await api('/api/bootstrap', 'GET', undefined, securityToken);
    assert.equal(secBoot.status, 200);
    assert.equal(secBoot.json.employees.length, 2);
    assert.equal(secBoot.json.serverColdEmpty, false);
  });

  it('4. enforces Attendance State Machine (no double break, post-checkout lock, flexible shifts)', async () => {
    const scanIn = await api(
      '/api/attendance/quick-scan',
      'POST',
      { code_or_qr: '501', preferred_action: 'check_in' },
      securityToken
    );
    assert.equal(scanIn.status, 201);
    assert.equal(scanIn.json.nextAction, 'check_in');
    const empId = scanIn.json.employee.id;

    // Duplicate check_in while present is strictly blocked (400)
    const dupIn = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'check_in' },
      securityToken
    );
    assert.equal(dupIn.status, 400);

    const brkStart = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'break_start', allowed_break_minutes: 30 },
      securityToken
    );
    assert.equal(brkStart.status, 201);

    // Starting another break while already on_break is strictly blocked (400)
    const doubleBreak = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'break_start', allowed_break_minutes: 15 },
      securityToken
    );
    assert.equal(doubleBreak.status, 400);

    const brkEnd = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'break_end' },
      securityToken
    );
    assert.equal(brkEnd.status, 201);

    const checkOut = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'check_out' },
      securityToken
    );
    assert.equal(checkOut.status, 201);

    // Immediate check-in after check-out is locked until next shift window (400)
    const lockedReCheckIn = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'check_in' },
      securityToken
    );
    assert.equal(lockedReCheckIn.status, 400);

    // Owner/Admin can explicitly override to reopen shift if needed
    const adminReopen = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'check_in', allow_reopen_shift: true },
      ownerToken
    );
    assert.equal(adminReopen.status, 201);
  });

  it('5. enforces Multi-Role Walkie-Talkie channels (Cashier/Hall/Security/Admin/CCTV) and Admin RBAC control', async () => {
    // Hall employee has access to 'floor' (CH-03), 'security' (CH-01), and 'emergency' (CH-09),
    // but is blocked (403) from 'warehouse' (CH-04)
    const hallWrongCh = await api(
      '/api/walkie/presence',
      'POST',
      { channel: 'warehouse', peer_id: 'peer_hall_1', status: 'listening', live_on: true },
      hallToken
    );
    assert.equal(hallWrongCh.status, 403);

    // Hall employee CAN join 'security' (CH-01) to talk to Security
    const hallToSec = await api(
      '/api/walkie/presence',
      'POST',
      { channel: 'security', peer_id: 'peer_hall_1', status: 'listening', live_on: true },
      hallToken
    );
    assert.equal(hallToSec.status, 200);

    // Security guard has walkie:all_channels -> CAN enter 'warehouse' (CH-04), 'cashier' (CH-02), and 'security' (CH-01)
    const secWarehouseCh = await api(
      '/api/walkie/presence',
      'POST',
      { channel: 'warehouse', peer_id: 'peer_sec_1', status: 'listening', live_on: true },
      securityToken
    );
    assert.equal(secWarehouseCh.status, 200);
    assert.ok(secWarehouseCh.json.channelActivitySummary);

    // Security guard joins CH-01 (security)
    const secPres = await api(
      '/api/walkie/presence',
      'POST',
      { channel: 'security', peer_id: 'peer_sec_1', status: 'listening', live_on: true },
      securityToken
    );
    assert.equal(secPres.status, 200);
    assert.equal(secPres.json.ok, true);

    // Owner joins CH-01 (security) from a separate network/device
    const ownerSig = await api(
      '/api/walkie/signal',
      'POST',
      {
        channel: 'security',
        peer_id: 'peer_owner_1',
        target_peer_id: 'peer_sec_1',
        signal_type: 'join',
        data: { mic_mode: 'vad', has_mic: true },
      },
      ownerToken
    );
    assert.equal(ownerSig.status, 200);
    assert.ok(ownerSig.json.activeUnits.length >= 2);

    // Security guard streams a 250ms 8kHz G.711 μ-law live audio packet
    const fakeMuLaw = Buffer.alloc(200, 0x7f).toString('base64');
    const liveFrame = await api(
      '/api/walkie/live-frame',
      'POST',
      {
        channel: 'security',
        peer_id: 'peer_sec_1',
        sample_rate: 8000,
        ulaw_b64: fakeMuLaw,
      },
      securityToken
    );
    assert.equal(liveFrame.status, 200);
    assert.ok(liveFrame.json.seq >= 1);

    // Owner polls and receives the live frame, presence, and channelActivitySummary
    const ownerPoll = await api(
      '/api/walkie/poll?channel=security&listening=1&peer_id=peer_owner_1&live_on=1&last_frame_seq=0',
      'GET',
      undefined,
      ownerToken
    );
    assert.equal(ownerPoll.status, 200);
    assert.equal(ownerPoll.json.liveFrames.length, 1);
    assert.equal(ownerPoll.json.liveFrames[0].from_peer_id, 'peer_sec_1');
    assert.ok(ownerPoll.json.channelActivitySummary.security);

    const pingTx = await api(
      '/api/walkie/transmit',
      'POST',
      { channel: 'security', peer_id: 'peer_sec_1', kind: 'ping', is_emergency: true },
      securityToken
    );
    assert.equal(pingTx.status, 201);
    assert.equal(pingTx.json.call.kind, 'ping');

    // Test Admin RBAC policy reset endpoint
    const resetRes = await api('/api/rbac/policies/cashier/reset', 'POST', {}, ownerToken);
    assert.equal(resetRes.status, 201);
    assert.equal(resetRes.json.ok, true);
    assert.ok(resetRes.json.permissions.includes('shortages:write'));
    assert.ok(resetRes.json.permissions.includes('notes:write'));
    assert.ok(resetRes.json.permissions.includes('walkie:use'));
    assert.ok(resetRes.json.permissions.includes('attendance:self'));
  });

  it('6. provides lightweight /api/sync-check digest and idempotent offline replay', async () => {
    const sync1 = await api('/api/sync-check', 'GET', undefined, ownerToken);
    assert.equal(sync1.status, 200);
    assert.equal(sync1.json.ok, true);
    assert.ok(sync1.json.digest);

    // Create a shortage item -> digest must change
    const shRes = await api(
      '/api/shortages',
      'POST',
      {
        id: 'idemp-shortage-001',
        item_name: 'لبن جهينة كامل الدسم',
        category: 'ألبان وجبن',
        requested_qty: 5,
        unit: 'كرتونة',
      },
      hallToken
    );
    assert.equal(shRes.status, 201);

    const sync2 = await api('/api/sync-check', 'GET', undefined, ownerToken);
    assert.equal(sync2.status, 200);
    assert.notEqual(sync2.json.digest, sync1.json.digest);

    // Replaying an attendance log with the same client UUID must be idempotent (no duplicate or error)
    const boot = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    const firstEmpId = boot.json.employees[0].id;
    const replayId = 'idemp-att-replay-001';

    const firstAtt = await api(
      '/api/attendance',
      'POST',
      { id: replayId, employee_id: firstEmpId, action_type: 'break_start', allowed_break_minutes: 15 },
      ownerToken
    );
    assert.equal(firstAtt.status, 201);

    const replayAtt = await api(
      '/api/attendance',
      'POST',
      { id: replayId, employee_id: firstEmpId, action_type: 'break_start', allowed_break_minutes: 15 },
      ownerToken
    );
    assert.equal(replayAtt.status, 201);
    assert.equal(replayAtt.json.log.id, replayId);
  });

  function openSseCollector(token) {
    const events = [];
    let reqRef = null;
    let resRef = null;
    let buffer = '';

    const ready = new Promise((resolve, reject) => {
      reqRef = http.get(`${baseUrl}/api/events?token=${encodeURIComponent(token)}`, (res) => {
        resRef = res;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';
          for (const frame of frames) {
            const eventLine = frame
              .split('\n')
              .find((l) => l.startsWith('event:'))
              ?.slice(6)
              .trim();
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data:'))
              ?.slice(5)
              .trim();
            if (eventLine) {
              let parsed = null;
              if (dataLine) {
                try {
                  parsed = JSON.parse(dataLine);
                } catch {
                  parsed = dataLine;
                }
              }
              events.push({ event: eventLine, data: parsed });
              if (eventLine === 'connected') resolve();
            }
          }
        });
      });
      reqRef.on('error', reject);
    });

    return {
      ready,
      events,
      close() {
        try {
          resRef?.destroy();
        } catch {
          // ignore
        }
        try {
          reqRef?.destroy();
        } catch {
          // ignore
        }
      },
    };
  }

  it('7. exposes schedule:* permissions in /api/rbac/overview and role defaults', async () => {
    const overview = await api('/api/rbac/overview', 'GET', undefined, ownerToken);
    assert.equal(overview.status, 200);

    const permIds = overview.json.permissionsCatalog.map((p) => p.id);
    assert.ok(permIds.includes('schedule:read'));
    assert.ok(permIds.includes('schedule:manage'));
    assert.ok(permIds.includes('schedule:swap_request'));

    const { policies } = overview.json;
    for (const mgrRole of ['owner', 'manager', 'supervisor']) {
      assert.ok(policies[mgrRole].includes('schedule:read'));
      assert.ok(policies[mgrRole].includes('schedule:manage'));
      assert.ok(policies[mgrRole].includes('schedule:swap_request'));
    }

    assert.ok(policies.cashier.includes('schedule:read'));
    assert.ok(policies.cashier.includes('schedule:swap_request'));
    assert.equal(policies.cashier.includes('schedule:manage'), false);

    for (const viewOnlyRole of ['hall', 'security', 'cctv']) {
      assert.ok(policies[viewOnlyRole].includes('schedule:read'));
      assert.equal(policies[viewOnlyRole].includes('schedule:manage'), false);
      assert.equal(policies[viewOnlyRole].includes('schedule:swap_request'), false);
    }

    assert.equal(policies.kiosk.includes('schedule:read'), false);
  });

  it('8. manages defaults & weekly overrides across 3 teams, copy_previous_week, and reset_to_defaults', async () => {
    currentWeek = getSaturdayWeekStart(getCairoDateKey());
    nextWeek = shiftWeekStart(currentWeek, 1);
    prevWeek = shiftWeekStart(currentWeek, -1);

    const c1 = await api(
      '/api/employees',
      'POST',
      { name: 'ندى كاشير ١', emp_code: '601', department: 'كاشير', system_role: 'cashier' },
      ownerToken
    );
    assert.equal(c1.status, 201);
    cashier1Id = c1.json.employee.id;

    const c2 = await api(
      '/api/employees',
      'POST',
      { name: 'سارة كاشير ٢', emp_code: '602', department: 'كاشير', system_role: 'cashier' },
      ownerToken
    );
    assert.equal(c2.status, 201);
    cashier2Id = c2.json.employee.id;

    const c3 = await api(
      '/api/employees',
      'POST',
      { name: 'مريم كاشير ٣', emp_code: '603', department: 'كاشير', system_role: 'cashier' },
      ownerToken
    );
    assert.equal(c3.status, 201);
    cashier3Id = c3.json.employee.id;

    const mgr = await api(
      '/api/employees',
      'POST',
      { name: 'طارق مدير الفرع', emp_code: '604', department: 'المدير', system_role: 'manager' },
      ownerToken
    );
    assert.equal(mgr.status, 201);

    cashier1Token = (await api('/api/auth/login', 'POST', { password: '601' })).json.token;
    cashier2Token = (await api('/api/auth/login', 'POST', { password: '602' })).json.token;
    cashier3Token = (await api('/api/auth/login', 'POST', { password: '603' })).json.token;
    managerToken = (await api('/api/auth/login', 'POST', { password: '604' })).json.token;

    const boot = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    hallEmpId = boot.json.employees.find((e) => e.emp_code === '502').id;
    secEmpId = boot.json.employees.find((e) => e.emp_code === '501').id;

    for (const [employeeId, dayOfWeek, teamGroup] of [
      [cashier1Id, 'sat', 'cashiers'],
      [cashier2Id, 'mon', 'cashiers'],
      [cashier3Id, 'thu', 'cashiers'],
      [hallEmpId, 'tue', 'hall'],
      [secEmpId, 'wed', 'security_cctv'],
    ]) {
      const assignRes = await api(
        '/api/schedules/assign',
        'PUT',
        { employeeId, dayOfWeek, teamGroup, scope: 'default' },
        managerToken
      );
      assert.equal(assignRes.status, 200);
      assert.equal(assignRes.json.ok, true);
    }

    // Weekly override for cashier3 in currentWeek (thu -> fri)
    const bulkOvr = await api(
      '/api/schedules/bulk',
      'POST',
      {
        action: 'save_entries',
        scope: 'week',
        weekStartDate: currentWeek,
        entries: [{ employeeId: cashier3Id, dayOfWeek: 'fri', teamGroup: 'cashiers' }],
      },
      managerToken
    );
    assert.equal(bulkOvr.status, 200);

    const curSchedule = await api(
      `/api/schedules/week?weekStart=${currentWeek}`,
      'GET',
      undefined,
      managerToken
    );
    assert.equal(curSchedule.status, 200);
    assert.deepEqual(curSchedule.json.visibleGroups, ['cashiers', 'hall', 'security_cctv']);
    assert.equal(curSchedule.json.groups.length, 3);

    const cashGroup = curSchedule.json.groups.find((g) => g.id === 'cashiers');
    const hallGroup = curSchedule.json.groups.find((g) => g.id === 'hall');
    const secGroup = curSchedule.json.groups.find((g) => g.id === 'security_cctv');
    assert.ok(cashGroup.employees.length >= 3);
    assert.ok(hallGroup.employees.some((e) => e.id === hallEmpId && e.effective_day_of_week === 'tue'));
    assert.ok(secGroup.employees.some((e) => e.id === secEmpId && e.effective_day_of_week === 'wed'));

    const c3Row = cashGroup.employees.find((e) => e.id === cashier3Id);
    assert.equal(c3Row.default_day_of_week, 'thu');
    assert.equal(c3Row.effective_day_of_week, 'fri');
    assert.equal(c3Row.is_override, true);
    assert.equal(hallGroup.coverageByDay.tue.lowCoverage, true);
    assert.equal(cashGroup.coverageByDay.sat.offCount, 1);
    assert.equal(cashGroup.coverageByDay.sat.onDutyCount, 2);

    // copy_previous_week copies currentWeek effective schedule (including c3=fri) to nextWeek
    const copyRes = await api(
      '/api/schedules/bulk',
      'POST',
      { action: 'copy_previous_week', weekStartDate: nextWeek },
      managerToken
    );
    assert.equal(copyRes.status, 200);
    assert.ok(copyRes.json.copiedCount >= 5);

    const nextAfterCopy = await api(
      `/api/schedules/week?weekStart=${nextWeek}`,
      'GET',
      undefined,
      managerToken
    );
    const c3NextCopy = nextAfterCopy.json.groups
      .find((g) => g.id === 'cashiers')
      .employees.find((e) => e.id === cashier3Id);
    assert.equal(c3NextCopy.effective_day_of_week, 'fri');
    assert.equal(c3NextCopy.is_override, true);

    // reset_to_defaults restores nextWeek back to defaults (c3=thu)
    const resetRes = await api(
      '/api/schedules/bulk',
      'POST',
      { action: 'reset_to_defaults', weekStartDate: nextWeek },
      managerToken
    );
    assert.equal(resetRes.status, 200);

    const nextAfterReset = await api(
      `/api/schedules/week?weekStart=${nextWeek}`,
      'GET',
      undefined,
      managerToken
    );
    const c3NextReset = nextAfterReset.json.groups
      .find((g) => g.id === 'cashiers')
      .employees.find((e) => e.id === cashier3Id);
    assert.equal(c3NextReset.effective_day_of_week, 'thu');
    assert.equal(c3NextReset.is_override, false);
  });

  it('9. enforces cashier team visibility isolation and 403 on admin endpoints', async () => {
    const c1Week = await api(
      `/api/schedules/week?weekStart=${nextWeek}`,
      'GET',
      undefined,
      cashier1Token
    );
    assert.equal(c1Week.status, 200);
    assert.deepEqual(c1Week.json.visibleGroups, ['cashiers']);
    assert.equal(c1Week.json.groups.length, 1);
    assert.equal(c1Week.json.groups[0].id, 'cashiers');
    assert.equal(c1Week.json.canManage, false);
    assert.equal(c1Week.json.canSwap, true);

    const hallWeek = await api(
      `/api/schedules/week?weekStart=${nextWeek}`,
      'GET',
      undefined,
      hallToken
    );
    assert.equal(hallWeek.status, 200);
    assert.deepEqual(hallWeek.json.visibleGroups, ['hall']);
    assert.equal(hallWeek.json.groups.length, 1);
    assert.equal(hallWeek.json.canSwap, false);

    assert.equal(
      (
        await api(
          '/api/schedules/assign',
          'PUT',
          { employeeId: cashier1Id, dayOfWeek: 'sun', scope: 'default' },
          cashier1Token
        )
      ).status,
      403
    );
    assert.equal(
      (
        await api(
          '/api/schedules/bulk',
          'POST',
          { action: 'reset_to_defaults', weekStartDate: nextWeek },
          cashier1Token
        )
      ).status,
      403
    );
    assert.equal(
      (
        await api(
          '/api/schedules/settings',
          'PUT',
          { swapRequiresManagerApproval: true },
          cashier1Token
        )
      ).status,
      403
    );
    assert.equal(
      (
        await api(
          '/api/schedules/swaps',
          'POST',
          { requestType: 'move', weekStartDate: nextWeek, targetDay: 'fri' },
          hallToken
        )
      ).status,
      403
    );

    // Regression: employee with week-level team_group override and NO default row sees their override group
    const weekOnlyEmpRes = await api(
      '/api/employees',
      'POST',
      { name: 'موظف تجاوز أسبوعي', emp_code: '610', department: 'منسقي ممرات', system_role: 'hall' },
      ownerToken
    );
    assert.equal(weekOnlyEmpRes.status, 201);
    const weekOnlyEmpId = weekOnlyEmpRes.json.employee.id;
    await api(
      '/api/schedules/assign',
      'PUT',
      {
        employeeId: weekOnlyEmpId,
        dayOfWeek: 'thu',
        teamGroup: 'security_cctv',
        scope: 'week',
        weekStartDate: nextWeek,
      },
      managerToken
    );
    const weekOnlyToken = (await api('/api/auth/login', 'POST', { password: '610' })).json.token;
    const weekOnlyView = await api(
      `/api/schedules/week?weekStart=${nextWeek}`,
      'GET',
      undefined,
      weekOnlyToken
    );
    assert.equal(weekOnlyView.status, 200);
    assert.equal(weekOnlyView.json.userTeamGroup, 'security_cctv');
    assert.deepEqual(weekOnlyView.json.visibleGroups, ['security_cctv']);
    assert.ok(weekOnlyView.json.groups[0].employees.some((e) => e.id === weekOnlyEmpId));
    await api(`/api/employees/${weekOnlyEmpId}`, 'DELETE', undefined, ownerToken);
  });

  it('10. executes full dual-cashier swap (auto-apply), blocks self-approval, sends targeted SSE, and supports revert', async () => {
    const c2Sse = openSseCollector(cashier2Token);
    const hallSse = openSseCollector(hallToken);
    try {
      await Promise.all([c2Sse.ready, hallSse.ready]);

      // Cashier 1 requests swap with Cashier 2 (sat <-> mon) in nextWeek
      const createRes = await api(
        '/api/schedules/swaps',
        'POST',
        {
          requestType: 'swap',
          scope: 'week',
          weekStartDate: nextWeek,
          targetEmployeeId: cashier2Id,
          reason: 'ظرف عائلي',
        },
        cashier1Token
      );
      assert.equal(createRes.status, 201);
      assert.equal(createRes.json.swap.status, 'pending_peer');
      assert.equal(createRes.json.swap.requester_approved, 1);
      assert.equal(createRes.json.swap.target_approved, 0);
      const swapId = createRes.json.swap.id;

      // Give event loop a tick to deliver SSE frames
      await new Promise((r) => setTimeout(r, 80));
      assert.ok(
        c2Sse.events.some((e) => e.event === 'day_off_swap' && e.data?.requestId === swapId),
        'Cashier 2 should receive targeted SSE day_off_swap notification'
      );
      assert.equal(
        hallSse.events.some((e) => e.event === 'day_off_swap'),
        false,
        'Unrelated hall user must NOT receive targeted cashier swap SSE event'
      );

      // Cashier 2 sees awaiting_my_action in bootstrap
      const c2Boot = await api('/api/bootstrap', 'GET', undefined, cashier2Token);
      assert.equal(c2Boot.status, 200);
      assert.equal(c2Boot.json.summary.pendingDayOffSwapsCount, 1);
      assert.equal(c2Boot.json.pendingDayOffSwaps[0].id, swapId);
      assert.equal(c2Boot.json.pendingDayOffSwaps[0].awaiting_my_action, true);

      // Schedule remains unchanged while pending_peer
      const beforeApprove = await api(
        `/api/schedules/week?weekStart=${nextWeek}`,
        'GET',
        undefined,
        cashier1Token
      );
      const empsBefore = beforeApprove.json.groups[0].employees;
      assert.equal(empsBefore.find((e) => e.id === cashier1Id).effective_day_of_week, 'sat');
      assert.equal(empsBefore.find((e) => e.id === cashier2Id).effective_day_of_week, 'mon');

      // Cashier 1 cannot self-approve as peer (403)
      assert.equal(
        (
          await api(
            `/api/schedules/swaps/${swapId}/respond`,
            'POST',
            { decision: 'approve' },
            cashier1Token
          )
        ).status,
        403
      );
      // Manager cannot bypass peer approval via /respond (403) or /decision (400)
      assert.equal(
        (
          await api(
            `/api/schedules/swaps/${swapId}/respond`,
            'POST',
            { decision: 'approve' },
            managerToken
          )
        ).status,
        403
      );
      assert.equal(
        (
          await api(
            `/api/schedules/swaps/${swapId}/decision`,
            'POST',
            { decision: 'approve' },
            managerToken
          )
        ).status,
        400
      );
      // Unrelated Cashier 3 cannot respond (403)
      assert.equal(
        (
          await api(
            `/api/schedules/swaps/${swapId}/respond`,
            'POST',
            { decision: 'approve' },
            cashier3Token
          )
        ).status,
        403
      );

      // Cashier 2 approves -> auto-applies immediately
      const approveRes = await api(
        `/api/schedules/swaps/${swapId}/respond`,
        'POST',
        { decision: 'approve' },
        cashier2Token
      );
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.json.swap.status, 'approved');
      assert.equal(approveRes.json.swap.requester_approved, 1);
      assert.equal(approveRes.json.swap.target_approved, 1);

      const afterApprove = await api(
        `/api/schedules/week?weekStart=${nextWeek}`,
        'GET',
        undefined,
        cashier1Token
      );
      const empsAfter = afterApprove.json.groups[0].employees;
      assert.equal(empsAfter.find((e) => e.id === cashier1Id).effective_day_of_week, 'mon');
      assert.equal(empsAfter.find((e) => e.id === cashier2Id).effective_day_of_week, 'sat');
      assert.equal(empsAfter.find((e) => e.id === cashier1Id).override_source, 'swap');

      // Cashier cannot revert (403); Manager reverts -> original days restored
      assert.equal(
        (await api(`/api/schedules/swaps/${swapId}/revert`, 'POST', {}, cashier1Token)).status,
        403
      );
      const revertRes = await api(
        `/api/schedules/swaps/${swapId}/revert`,
        'POST',
        { reason: 'تعديل تشغيلي' },
        managerToken
      );
      assert.equal(revertRes.status, 200);
      assert.equal(revertRes.json.swap.status, 'reverted');

      const afterRevert = await api(
        `/api/schedules/week?weekStart=${nextWeek}`,
        'GET',
        undefined,
        managerToken
      );
      const empsReverted = afterRevert.json.groups.find((g) => g.id === 'cashiers').employees;
      assert.equal(empsReverted.find((e) => e.id === cashier1Id).effective_day_of_week, 'sat');
      assert.equal(empsReverted.find((e) => e.id === cashier2Id).effective_day_of_week, 'mon');
    } finally {
      c2Sse.close();
      hallSse.close();
    }
  });

  it('11. supports manager approval setting toggle and one-way move workflow', async () => {
    const settingsRes = await api(
      '/api/schedules/settings',
      'PUT',
      {
        swapRequiresManagerApproval: true,
        minOnDuty: { cashiers: 2, hall: 1, security_cctv: 1 },
      },
      managerToken
    );
    assert.equal(settingsRes.status, 200);
    assert.equal(settingsRes.json.settings.swapRequiresManagerApproval, true);
    assert.equal(settingsRes.json.settings.minOnDuty.hall, 1);

    // Dual-cashier swap now stops at pending_manager
    const swapCreate = await api(
      '/api/schedules/swaps',
      'POST',
      {
        requestType: 'swap',
        scope: 'week',
        weekStartDate: nextWeek,
        targetEmployeeId: cashier2Id,
      },
      cashier1Token
    );
    assert.equal(swapCreate.status, 201);
    const swapId = swapCreate.json.swap.id;

    const peerApprove = await api(
      `/api/schedules/swaps/${swapId}/respond`,
      'POST',
      { decision: 'approve' },
      cashier2Token
    );
    assert.equal(peerApprove.status, 200);
    assert.equal(peerApprove.json.swap.status, 'pending_manager');

    const mgrApproveSwap = await api(
      `/api/schedules/swaps/${swapId}/decision`,
      'POST',
      { decision: 'approve' },
      managerToken
    );
    assert.equal(mgrApproveSwap.status, 200);
    assert.equal(mgrApproveSwap.json.swap.status, 'approved');

    // One-way 'move' requires manager /decision
    const moveCreate = await api(
      '/api/schedules/swaps',
      'POST',
      {
        requestType: 'move',
        scope: 'week',
        weekStartDate: nextWeek,
        targetDay: 'wed',
        reason: 'موعد طبي',
      },
      cashier3Token
    );
    assert.equal(moveCreate.status, 201);
    assert.equal(moveCreate.json.swap.status, 'pending_manager');
    const moveId = moveCreate.json.swap.id;

    const moveDecision = await api(
      `/api/schedules/swaps/${moveId}/decision`,
      'POST',
      { decision: 'approve' },
      managerToken
    );
    assert.equal(moveDecision.status, 200);
    assert.equal(moveDecision.json.swap.status, 'approved');

    const weekCheck = await api(
      `/api/schedules/week?weekStart=${nextWeek}`,
      'GET',
      undefined,
      managerToken
    );
    const cashEmps = weekCheck.json.groups.find((g) => g.id === 'cashiers').employees;
    assert.equal(cashEmps.find((e) => e.id === cashier1Id).effective_day_of_week, 'mon');
    assert.equal(cashEmps.find((e) => e.id === cashier2Id).effective_day_of_week, 'sat');
    assert.equal(cashEmps.find((e) => e.id === cashier3Id).effective_day_of_week, 'wed');

    // Requester cancel & idempotency check
    const cancelDraft = await api(
      '/api/schedules/swaps',
      'POST',
      {
        id: 'idemp-swap-cancel-001',
        requestType: 'move',
        scope: 'week',
        weekStartDate: nextWeek,
        targetDay: 'fri',
      },
      cashier1Token
    );
    assert.equal(cancelDraft.status, 201);
    const replayDraft = await api(
      '/api/schedules/swaps',
      'POST',
      {
        id: 'idemp-swap-cancel-001',
        requestType: 'move',
        scope: 'week',
        weekStartDate: nextWeek,
        targetDay: 'fri',
      },
      cashier1Token
    );
    assert.equal(replayDraft.status, 200);
    assert.equal(replayDraft.json.swap.id, 'idemp-swap-cancel-001');

    // Cashier 2 cannot cancel Cashier 1's request (403); Cashier 1 can cancel (200)
    assert.equal(
      (await api('/api/schedules/swaps/idemp-swap-cancel-001/cancel', 'POST', {}, cashier2Token))
        .status,
      403
    );
    const cancelOk = await api(
      '/api/schedules/swaps/idemp-swap-cancel-001/cancel',
      'POST',
      {},
      cashier1Token
    );
    assert.equal(cancelOk.status, 200);
    assert.equal(cancelOk.json.swap.status, 'cancelled');

    // Restore settings and clean nextWeek back to defaults
    await api(
      '/api/schedules/settings',
      'PUT',
      { swapRequiresManagerApproval: false },
      managerToken
    );
    await api(
      '/api/schedules/bulk',
      'POST',
      { action: 'reset_to_defaults', weekStartDate: nextWeek },
      managerToken
    );

    // Test permanent swap updates defaults + future weeks, and revert restores defaults
    const permSwapCreate = await api(
      '/api/schedules/swaps',
      'POST',
      {
        requestType: 'swap',
        scope: 'permanent',
        weekStartDate: nextWeek,
        targetEmployeeId: cashier2Id,
      },
      cashier1Token
    );
    assert.equal(permSwapCreate.status, 201);
    const permSwapId = permSwapCreate.json.swap.id;
    const permApprove = await api(
      `/api/schedules/swaps/${permSwapId}/respond`,
      'POST',
      { decision: 'approve' },
      cashier2Token
    );
    assert.equal(permApprove.status, 200);
    assert.equal(permApprove.json.swap.status, 'approved');

    const futureWeek2 = shiftWeekStart(nextWeek, 1);
    const futureCheck = await api(
      `/api/schedules/week?weekStart=${futureWeek2}`,
      'GET',
      undefined,
      managerToken
    );
    const futureCash = futureCheck.json.groups.find((g) => g.id === 'cashiers').employees;
    assert.equal(futureCash.find((e) => e.id === cashier1Id).default_day_of_week, 'mon');
    assert.equal(futureCash.find((e) => e.id === cashier2Id).default_day_of_week, 'sat');

    const permRevert = await api(
      `/api/schedules/swaps/${permSwapId}/revert`,
      'POST',
      {},
      managerToken
    );
    assert.equal(permRevert.status, 200);
    const futureAfterRevert = await api(
      `/api/schedules/week?weekStart=${futureWeek2}`,
      'GET',
      undefined,
      managerToken
    );
    const futureCashReverted = futureAfterRevert.json.groups.find((g) => g.id === 'cashiers').employees;
    assert.equal(futureCashReverted.find((e) => e.id === cashier1Id).default_day_of_week, 'sat');
    assert.equal(futureCashReverted.find((e) => e.id === cashier2Id).default_day_of_week, 'mon');
  });

  it('12. enforces edge guards (self-swap, cross-group, past-day, stale-snapshot 409, deactivation auto-cancel)', async () => {
    // Self-swap blocked
    assert.equal(
      (
        await api(
          '/api/schedules/swaps',
          'POST',
          { requestType: 'swap', weekStartDate: nextWeek, targetEmployeeId: cashier1Id },
          cashier1Token
        )
      ).status,
      400
    );

    // Cross-group swap blocked
    assert.equal(
      (
        await api(
          '/api/schedules/swaps',
          'POST',
          { requestType: 'swap', weekStartDate: nextWeek, targetEmployeeId: hallEmpId },
          cashier1Token
        )
      ).status,
      400
    );

    // Past-day swap blocked for cashier
    assert.equal(
      (
        await api(
          '/api/schedules/swaps',
          'POST',
          { requestType: 'swap', weekStartDate: prevWeek, targetEmployeeId: cashier2Id },
          cashier1Token
        )
      ).status,
      400
    );

    // Stale-snapshot 409 when admin modifies schedule mid-swap
    const midSwap = await api(
      '/api/schedules/swaps',
      'POST',
      { requestType: 'swap', weekStartDate: nextWeek, targetEmployeeId: cashier2Id },
      cashier1Token
    );
    assert.equal(midSwap.status, 201);
    const midSwapId = midSwap.json.swap.id;

    // Duplicate open swap blocked for same requester/week
    assert.equal(
      (
        await api(
          '/api/schedules/swaps',
          'POST',
          { requestType: 'swap', weekStartDate: nextWeek, targetEmployeeId: cashier3Id },
          cashier1Token
        )
      ).status,
      400
    );

    // Admin reassigns cashier2 mid-swap
    const adminEdit = await api(
      '/api/schedules/assign',
      'PUT',
      { employeeId: cashier2Id, dayOfWeek: 'sun', scope: 'week', weekStartDate: nextWeek },
      managerToken
    );
    assert.equal(adminEdit.status, 200);

    // Cashier 2 approving the now-stale swap returns 409 Conflict
    const staleRespond = await api(
      `/api/schedules/swaps/${midSwapId}/respond`,
      'POST',
      { decision: 'approve' },
      cashier2Token
    );
    assert.equal(staleRespond.status, 409);

    // Auto-cancel pending swaps on employee deactivation
    await api(
      '/api/schedules/bulk',
      'POST',
      { action: 'reset_to_defaults', weekStartDate: nextWeek },
      managerToken
    );
    const tempCashier = await api(
      '/api/employees',
      'POST',
      { name: 'كاشير مؤقت', emp_code: '609', department: 'كاشير', system_role: 'cashier' },
      ownerToken
    );
    assert.equal(tempCashier.status, 201);
    const tempId = tempCashier.json.employee.id;
    await api(
      '/api/schedules/assign',
      'PUT',
      { employeeId: tempId, dayOfWeek: 'sun', teamGroup: 'cashiers', scope: 'default' },
      managerToken
    );

    const pendingTempSwap = await api(
      '/api/schedules/swaps',
      'POST',
      { requestType: 'swap', weekStartDate: nextWeek, targetEmployeeId: tempId },
      cashier1Token
    );
    assert.equal(pendingTempSwap.status, 201);
    const tempSwapId = pendingTempSwap.json.swap.id;

    const delRes = await api(`/api/employees/${tempId}`, 'DELETE', undefined, ownerToken);
    assert.equal(delRes.status, 200);

    const swapsList = await api(
      `/api/schedules/swaps?weekStart=${nextWeek}`,
      'GET',
      undefined,
      managerToken
    );
    const cancelledTempSwap = swapsList.json.swaps.find((s) => s.id === tempSwapId);
    assert.equal(cancelledTempSwap.status, 'cancelled');
    assert.equal(cancelledTempSwap.rejection_reason, 'تم تعطيل حساب الموظف');
  });

  it('13. integrates scheduled day-off with attendance summary (absentCount exclusion & workedOnDayOff)', async () => {
    const initBoot = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    assert.equal(initBoot.status, 200);
    const todayWeek = initBoot.json.dayOffSchedule.weekStartDate;
    const todayWeekday = initBoot.json.dayOffSchedule.todayWeekday;
    const otherWeekday = todayWeekday === 'sat' ? 'sun' : 'sat';

    // Ensure hallEmpId (currently absent today) is NOT scheduled off today first
    await api(
      '/api/schedules/assign',
      'PUT',
      { employeeId: hallEmpId, dayOfWeek: otherWeekday, scope: 'week', weekStartDate: todayWeek },
      managerToken
    );
    const bootBefore = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    const hallBefore = bootBefore.json.employees.find((e) => e.id === hallEmpId);
    assert.equal(hallBefore.currentStatus, 'absent');
    assert.equal(hallBefore.isScheduledOff, false);
    const absentBefore = bootBefore.json.summary.absentCount;
    const offBefore = bootBefore.json.summary.scheduledOffCount;

    // Assign hallEmpId to today's weekday -> excluded from absentCount, counted in scheduledOffCount
    await api(
      '/api/schedules/assign',
      'PUT',
      { employeeId: hallEmpId, dayOfWeek: todayWeekday, scope: 'week', weekStartDate: todayWeek },
      managerToken
    );
    const bootOff = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    const hallOff = bootOff.json.employees.find((e) => e.id === hallEmpId);
    assert.equal(hallOff.isScheduledOff, true);
    assert.equal(hallOff.workedOnDayOff, false);
    assert.equal(bootOff.json.summary.scheduledOffCount, offBefore + 1);
    assert.equal(bootOff.json.summary.absentCount, absentBefore - 1);

    // If scheduled-off employee checks in anyway -> workedOnDayOff becomes true
    const checkInRes = await api(
      '/api/attendance',
      'POST',
      { employee_id: hallEmpId, action_type: 'check_in' },
      ownerToken
    );
    assert.equal(checkInRes.status, 201);

    const bootWorked = await api('/api/bootstrap', 'GET', undefined, ownerToken);
    const hallWorked = bootWorked.json.employees.find((e) => e.id === hallEmpId);
    assert.equal(hallWorked.isScheduledOff, true);
    assert.equal(hallWorked.workedOnDayOff, true);
    assert.equal(hallWorked.currentStatus, 'present');
    assert.equal(bootWorked.json.summary.scheduledOffCount, offBefore);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
    assert.equal(resetRes.json.permissions.includes('attendance:self'), false);
    assert.equal(resetRes.json.permissions.includes('attendance:kiosk'), false);
    assert.equal(resetRes.json.permissions.includes('attendance:write'), false);
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

  let cctvToken = '';
  let supervisorToken = '';
  let warehouseToken = '';
  let deliveryToken = '';
  let cctvEmpId = '';
  let supervisorEmpId = '';
  let warehouseEmpId = '';
  let deliveryEmpId = '';
  let targetEmpId = '';
  let nightHallEmpId = '';

  it('14. enforces strict attendance RBAC (only owner/manager/supervisor/security/cctv can record)', async () => {
    const overview = await api('/api/rbac/overview', 'GET', undefined, ownerToken);
    assert.equal(overview.status, 200);
    const { policies } = overview.json;

    for (const nonKioskRole of [
      'manager',
      'supervisor',
      'cctv',
      'security',
      'cashier',
      'hall',
      'warehouse',
      'delivery',
    ]) {
      assert.equal(
        policies[nonKioskRole].includes('attendance:self'),
        false,
        `${nonKioskRole} must not have attendance:self`
      );
      assert.equal(
        policies[nonKioskRole].includes('attendance:kiosk'),
        false,
        `${nonKioskRole} must not have attendance:kiosk`
      );
    }

    for (const restrictedRole of ['cashier', 'hall', 'warehouse', 'delivery', 'kiosk']) {
      assert.equal(
        policies[restrictedRole].includes('attendance:write'),
        false,
        `${restrictedRole} must not have attendance:write`
      );
      assert.equal(
        policies[restrictedRole].includes('attendance:verify'),
        false,
        `${restrictedRole} must not have attendance:verify`
      );
    }

    for (const authRole of ['owner', 'manager', 'supervisor', 'security', 'cctv']) {
      assert.ok(policies[authRole].includes('attendance:write'));
    }
    for (const verifyRole of ['owner', 'manager', 'supervisor', 'cctv']) {
      assert.ok(policies[verifyRole].includes('attendance:verify'));
    }
    assert.equal(policies.security.includes('attendance:verify'), false);
    assert.ok(policies.kiosk.includes('attendance:kiosk'));

    const cctvEmp = await api(
      '/api/employees',
      'POST',
      { name: 'رامي مراقب الكاميرات', emp_code: '701', department: 'كاميرات', system_role: 'cctv' },
      ownerToken
    );
    assert.equal(cctvEmp.status, 201);
    cctvEmpId = cctvEmp.json.employee.id;

    const supEmp = await api(
      '/api/employees',
      'POST',
      { name: 'هاني مشرف الصالة', emp_code: '702', department: 'إدارة وإشراف', system_role: 'supervisor' },
      ownerToken
    );
    assert.equal(supEmp.status, 201);
    supervisorEmpId = supEmp.json.employee.id;

    const whEmp = await api(
      '/api/employees',
      'POST',
      { name: 'خالد أمين المخزن', emp_code: '703', department: 'مخزن', system_role: 'warehouse' },
      ownerToken
    );
    assert.equal(whEmp.status, 201);
    warehouseEmpId = whEmp.json.employee.id;

    const delEmp = await api(
      '/api/employees',
      'POST',
      { name: 'يوسف طيار التوصيل', emp_code: '704', department: 'دليفري', system_role: 'delivery' },
      ownerToken
    );
    assert.equal(delEmp.status, 201);
    deliveryEmpId = delEmp.json.employee.id;

    const targetEmp = await api(
      '/api/employees',
      'POST',
      {
        name: 'وليد موظف صباحي',
        emp_code: '705',
        department: 'منسقي ممرات',
        system_role: 'hall',
        shift_start: '08:00',
        shift_end: '20:00',
        phone: '01000000705',
      },
      ownerToken
    );
    assert.equal(targetEmp.status, 201);
    targetEmpId = targetEmp.json.employee.id;

    const nightHallEmp = await api(
      '/api/employees',
      'POST',
      {
        name: 'باسم موظف ليلي',
        emp_code: '706',
        department: 'منسقي ممرات',
        system_role: 'hall',
        shift_start: '22:00',
        shift_end: '06:00',
      },
      ownerToken
    );
    assert.equal(nightHallEmp.status, 201);
    nightHallEmpId = nightHallEmp.json.employee.id;

    cctvToken = (await api('/api/auth/login', 'POST', { password: '701' })).json.token;
    supervisorToken = (await api('/api/auth/login', 'POST', { password: '702' })).json.token;
    warehouseToken = (await api('/api/auth/login', 'POST', { password: '703' })).json.token;
    deliveryToken = (await api('/api/auth/login', 'POST', { password: '704' })).json.token;

    // Restricted roles CANNOT record attendance even for themselves or via quick-scan
    for (const [label, tok, ownEmpId, ownCode] of [
      ['cashier', cashier1Token, cashier1Id, '601'],
      ['hall', hallToken, hallEmpId, '502'],
      ['warehouse', warehouseToken, warehouseEmpId, '703'],
      ['delivery', deliveryToken, deliveryEmpId, '704'],
    ]) {
      const attRes = await api(
        '/api/attendance',
        'POST',
        { employee_id: ownEmpId, action_type: 'check_in' },
        tok
      );
      assert.equal(attRes.status, 403, `${label} must get 403 on POST /api/attendance`);

      const scanRes = await api(
        '/api/attendance/quick-scan',
        'POST',
        { code_or_qr: ownCode, preferred_action: 'check_in' },
        tok
      );
      assert.equal(scanRes.status, 403, `${label} must get 403 on POST /api/attendance/quick-scan`);
    }

    // Authorized roles succeed
    const supCheckIn = await api(
      '/api/attendance',
      'POST',
      { employee_id: supervisorEmpId, action_type: 'check_in' },
      supervisorToken
    );
    assert.equal(supCheckIn.status, 201);

    const mgrBreak = await api(
      '/api/attendance',
      'POST',
      { employee_id: supervisorEmpId, action_type: 'break_start', allowed_break_minutes: 15 },
      managerToken
    );
    assert.equal(mgrBreak.status, 201);

    const ownerBreakEnd = await api(
      '/api/attendance',
      'POST',
      { employee_id: supervisorEmpId, action_type: 'break_end' },
      ownerToken
    );
    assert.equal(ownerBreakEnd.status, 201);

    const secCheckOut = await api(
      '/api/attendance',
      'POST',
      { employee_id: supervisorEmpId, action_type: 'check_out' },
      securityToken
    );
    assert.equal(secCheckOut.status, 201);

    const cctvCheckIn = await api(
      '/api/attendance',
      'POST',
      { employee_id: cctvEmpId, action_type: 'check_in' },
      cctvToken
    );
    assert.equal(cctvCheckIn.status, 201);
  });

  it('15. supports CCTV confirm + mismatch verification, verify-all mismatch skip, and range report fields', async () => {
    // Security records check_in -> pending CCTV verification
    const secIn = await api(
      '/api/attendance',
      'POST',
      { employee_id: targetEmpId, action_type: 'check_in' },
      securityToken
    );
    assert.equal(secIn.status, 201);
    assert.equal(secIn.json.log.cctv_status, 'pending');
    assert.equal(secIn.json.log.verified_by_cctv, 0);
    const targetLogId = secIn.json.log.id;

    // Security cannot verify (403)
    const secVerifyAttempt = await api(
      `/api/attendance/${targetLogId}/verify`,
      'POST',
      { status: 'confirmed' },
      securityToken
    );
    assert.equal(secVerifyAttempt.status, 403);

    // CCTV confirms attendance with observed time and note
    const cctvConfirm = await api(
      `/api/attendance/${targetLogId}/verify`,
      'POST',
      { status: 'confirmed', observed_time: '08:05', note: 'شوهد عند البوابة الرئيسية' },
      cctvToken
    );
    assert.equal(cctvConfirm.status, 200);
    assert.equal(cctvConfirm.json.ok, true);
    assert.equal(cctvConfirm.json.log.cctv_status, 'confirmed');
    assert.equal(cctvConfirm.json.log.verified_by_cctv, 1);
    assert.equal(cctvConfirm.json.log.cctv_observed_time, '08:05');
    assert.equal(cctvConfirm.json.log.cctv_note, 'شوهد عند البوابة الرئيسية');
    assert.ok(cctvConfirm.json.log.verified_by);

    // Security records check-in for cashier1 (pending) and cashier2 (to mark mismatch)
    const c1In = await api(
      '/api/attendance',
      'POST',
      { employee_id: cashier1Id, action_type: 'check_in' },
      securityToken
    );
    assert.equal(c1In.status, 201);
    const pendingLogId = c1In.json.log.id;

    const c2In = await api(
      '/api/attendance',
      'POST',
      { employee_id: cashier2Id, action_type: 'check_in' },
      securityToken
    );
    assert.equal(c2In.status, 201);
    const mismatchLogId = c2In.json.log.id;

    // CCTV marks cashier2 log as mismatch via PATCH
    const mismatchRes = await api(
      `/api/attendance/${mismatchLogId}/verify`,
      'PATCH',
      { status: 'mismatch', observed_time: '09:15', note: 'لم يظهر بالكاميرا في هذا التوقيت' },
      cctvToken
    );
    assert.equal(mismatchRes.status, 200);
    assert.equal(mismatchRes.json.log.cctv_status, 'mismatch');
    assert.equal(mismatchRes.json.log.verified_by_cctv, 0);

    // CCTV records cashier3 check-in with confirm_by_cctv: false -> pending
    const c3Pending = await api(
      '/api/attendance',
      'POST',
      { employee_id: cashier3Id, action_type: 'check_in', confirm_by_cctv: false },
      cctvToken
    );
    assert.equal(c3Pending.status, 201);
    assert.equal(c3Pending.json.log.cctv_status, 'pending');
    assert.equal(c3Pending.json.log.verified_by_cctv, 0);

    // CCTV records warehouse check-in with default confirm_by_cctv -> auto-confirmed
    const whAuto = await api(
      '/api/attendance',
      'POST',
      {
        employee_id: warehouseEmpId,
        action_type: 'check_in',
        cctv_observed_time: '08:02',
        cctv_note: 'مطابقة فورية',
      },
      cctvToken
    );
    assert.equal(whAuto.status, 201);
    assert.equal(whAuto.json.log.cctv_status, 'confirmed');
    assert.equal(whAuto.json.log.verified_by_cctv, 1);
    assert.equal(whAuto.json.log.cctv_observed_time, '08:02');

    // Check bootstrap summary & enriched employee CCTV fields
    const bootBeforeVerifyAll = await api('/api/bootstrap', 'GET', undefined, cctvToken);
    assert.equal(bootBeforeVerifyAll.status, 200);
    assert.ok(bootBeforeVerifyAll.json.summary.mismatchAttendanceCount >= 1);
    const c2Emp = bootBeforeVerifyAll.json.employees.find((e) => e.id === cashier2Id);
    assert.equal(c2Emp.latestCctvStatus, 'mismatch');
    assert.equal(c2Emp.latestCctvObservedTime, '09:15');
    assert.equal(c2Emp.latestCctvNote, 'لم يظهر بالكاميرا في هذا التوقيت');
    assert.ok(c2Emp.latestVerifiedBy);
    const delEmpBoot = bootBeforeVerifyAll.json.employees.find((e) => e.id === deliveryEmpId);
    assert.equal(delEmpBoot.latestCctvStatus, 'none');

    // Create a supplier + truck delivery so supplierStats is populated in /api/reports/range
    const supRes = await api(
      '/api/suppliers',
      'POST',
      { name: 'شركة المراعي', category: 'ألبان' },
      ownerToken
    );
    assert.equal(supRes.status, 201);
    const arriveRes = await api(
      '/api/trucks/arrive',
      'POST',
      { supplier_id: supRes.json.supplier.id, supplier_name: 'شركة المراعي', category: 'ألبان' },
      securityToken
    );
    assert.equal(arriveRes.status, 201);

    const rangeRes = await api('/api/reports/range', 'GET', undefined, cctvToken);
    assert.equal(rangeRes.status, 200);
    assert.ok(rangeRes.json.totals.mismatchCount >= 1);
    const targetStat = rangeRes.json.employeeStats.find((e) => e.id === targetEmpId);
    assert.equal(targetStat.shift_start, '08:00');
    assert.equal(targetStat.shift_end, '20:00');
    assert.equal(typeof targetStat.breaksCount, 'number');
    assert.equal(typeof targetStat.checkOutsCount, 'number');
    assert.equal(targetStat.checkInsCount, 1);
    const maraiStat = rangeRes.json.supplierStats.find((s) => s.name === 'شركة المراعي');
    assert.ok(maraiStat);
    assert.ok(maraiStat.id);

    // verify-all confirms pending rows and strictly SKIPS mismatch row
    const verifyAllRes = await api('/api/attendance/verify-all', 'POST', {}, cctvToken);
    assert.equal(verifyAllRes.status, 200);
    assert.ok(verifyAllRes.json.count >= 2);

    const bootAfterVerifyAll = await api('/api/bootstrap', 'GET', undefined, cctvToken);
    const pendingLogAfter = bootAfterVerifyAll.json.attendanceLogs.find((l) => l.id === pendingLogId);
    const mismatchLogAfter = bootAfterVerifyAll.json.attendanceLogs.find((l) => l.id === mismatchLogId);
    assert.equal(pendingLogAfter.cctv_status, 'confirmed');
    assert.equal(pendingLogAfter.verified_by_cctv, 1);
    assert.equal(mismatchLogAfter.cctv_status, 'mismatch');
    assert.equal(mismatchLogAfter.verified_by_cctv, 0);
  });

  it('16. exposes shiftRoster in GET /api/schedules/week with strict visibility & privacy controls', async () => {
    // Security sees full shift visibility across all 3 groups, canVerify: false, no emp_code
    const secSched = await api('/api/schedules/week', 'GET', undefined, securityToken);
    assert.equal(secSched.status, 200);
    assert.equal(secSched.json.hasFullShiftVisibility, true);
    assert.equal(secSched.json.canVerify, false);
    assert.deepEqual(secSched.json.visibleGroups, ['cashiers', 'hall', 'security_cctv']);
    assert.equal(secSched.json.groups.length, 3);
    assert.equal('emp_code' in secSched.json.groups[0].employees[0], false);

    const secTargetItem = secSched.json.shiftRoster.find((e) => e.id === targetEmpId);
    assert.ok(secTargetItem);
    assert.equal(secTargetItem.currentStatus, 'present');
    assert.equal(secTargetItem.latestCctvStatus, 'confirmed');
    assert.equal(secTargetItem.phone, '01000000705');
    assert.ok(secTargetItem.checkInTime);
    assert.ok(secTargetItem.latestLogId);
    assert.equal(typeof secTargetItem.lateMinutes, 'number');

    // CCTV sees full shift visibility and canVerify: true
    const cctvSched = await api('/api/schedules/week', 'GET', undefined, cctvToken);
    assert.equal(cctvSched.status, 200);
    assert.equal(cctvSched.json.hasFullShiftVisibility, true);
    assert.equal(cctvSched.json.canVerify, true);
    assert.ok(cctvSched.json.shiftRoster.some((e) => e.id === cashier2Id && e.latestCctvStatus === 'mismatch'));

    // Manager sees emp_code in groups[].employees[]
    const mgrSched = await api('/api/schedules/week', 'GET', undefined, managerToken);
    assert.equal(mgrSched.status, 200);
    assert.ok('emp_code' in mgrSched.json.groups[0].employees[0]);

    // Cashier1 sees hasFullShiftVisibility: false, overlapsMyShift, NO sensitive/oversight fields, and NO non-overlapping night hall worker
    const c1Sched = await api('/api/schedules/week', 'GET', undefined, cashier1Token);
    assert.equal(c1Sched.status, 200);
    assert.equal(c1Sched.json.hasFullShiftVisibility, false);
    assert.equal(c1Sched.json.canVerify, false);
    assert.deepEqual(c1Sched.json.visibleGroups, ['cashiers']);
    assert.equal('emp_code' in c1Sched.json.groups[0].employees[0], false);

    const c1Me = c1Sched.json.shiftRoster.find((e) => e.id === cashier1Id);
    assert.ok(c1Me);
    assert.equal(c1Me.isMe, true);
    assert.equal(c1Me.overlapsMyShift, true);

    const c1TargetOverlap = c1Sched.json.shiftRoster.find((e) => e.id === targetEmpId);
    assert.ok(c1TargetOverlap, 'Overlapping morning hall employee should appear in cashier shiftRoster');
    assert.equal(c1TargetOverlap.overlapsMyShift, true);
    assert.equal('phone' in c1TargetOverlap, false);
    assert.equal('emp_code' in c1TargetOverlap, false);
    assert.equal('lateMinutes' in c1TargetOverlap, false);
    assert.equal('checkInTime' in c1TargetOverlap, false);
    assert.equal('latestLogId' in c1TargetOverlap, false);
    assert.equal('latestCctvStatus' in c1TargetOverlap, false);

    const c1NightExcluded = c1Sched.json.shiftRoster.find((e) => e.id === nightHallEmpId);
    assert.equal(
      c1NightExcluded,
      undefined,
      'Non-overlapping night-shift employee from another group must not appear in cashier shiftRoster'
    );
  });

  // Valid 1x1 PNG base64 fixture (genuine PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A)
  const VALID_TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('17. supports self-service role profile photo upload, magic-byte/512KB/SVG validation, preset selection, and cleanup', async () => {
    // Public GET /api/auth/profiles returns safe role cards without leaking username, pin_hash, pin_cipher, emp_code, or phone
    const pubProfilesBefore = await api('/api/auth/profiles');
    assert.equal(pubProfilesBefore.status, 200);
    assert.equal(pubProfilesBefore.json.ok, true);
    assert.equal(pubProfilesBefore.json.login_show_role_cards, true);
    assert.ok(Array.isArray(pubProfilesBefore.json.profiles));
    assert.ok(pubProfilesBefore.json.profiles.length >= 3);
    for (const p of pubProfilesBefore.json.profiles) {
      assert.equal('username' in p, false, 'Public profiles must never leak username');
      assert.equal('pin_hash' in p, false);
      assert.equal('pin_cipher' in p, false);
      assert.equal('emp_code' in p, false);
      assert.equal('phone' in p, false);
    }

    // Reject SVG/XSS data URI, corrupted magic bytes, and >512KB payload
    const svgAttempt = await api(
      '/api/profile/me/avatar',
      'POST',
      { dataUrl: 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=' },
      cashier1Token
    );
    assert.equal(svgAttempt.status, 400);

    const badMagicAttempt = await api(
      '/api/profile/me/avatar',
      'POST',
      { dataUrl: 'data:image/png;base64,dGVzdC1ub3QtYS1wbmc=' },
      cashier1Token
    );
    assert.equal(badMagicAttempt.status, 400);

    const oversizedBuffer = Buffer.alloc(530 * 1024, 0xff);
    oversizedBuffer[0] = 0x89;
    oversizedBuffer[1] = 0x50;
    oversizedBuffer[2] = 0x4e;
    oversizedBuffer[3] = 0x47;
    const oversizedAttempt = await api(
      '/api/profile/me/avatar',
      'POST',
      { dataUrl: `data:image/png;base64,${oversizedBuffer.toString('base64')}` },
      cashier1Token
    );
    assert.equal(oversizedAttempt.status, 400);

    // Valid PNG upload succeeds for Cashier (even without trucks:write / attendance:write!)
    const uploadRes = await api(
      '/api/profile/me/avatar',
      'POST',
      { dataUrl: VALID_TINY_PNG_DATA_URL },
      cashier1Token
    );
    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.json.ok, true);
    assert.ok(uploadRes.json.avatar_url);
    assert.equal(uploadRes.json.user.avatar_url, uploadRes.json.avatar_url);

    // Normalized GET /api/profile/me returns updated avatar_url + both flat and nested employee fields
    const myProf = await api('/api/profile/me', 'GET', undefined, cashier1Token);
    assert.equal(myProf.status, 200);
    assert.equal(myProf.json.profile.avatar_url, uploadRes.json.avatar_url);
    assert.equal(myProf.json.profile.employee_id, cashier1Id);
    assert.ok(myProf.json.profile.employee);
    assert.equal(myProf.json.profile.employee.id, cashier1Id);
    assert.equal(myProf.json.profile.employee.avatar_url, uploadRes.json.avatar_url);

    // Selecting an avatar preset via PUT /api/profile/me clears custom photo and sets preset
    const presetRes = await api(
      '/api/profile/me',
      'PUT',
      {
        display_name: 'سارة كاشير 1',
        avatar_preset: 'badge_cashier',
        avatar_color: '#007B83',
      },
      cashier1Token
    );
    assert.equal(presetRes.status, 200);
    assert.equal(presetRes.json.user.avatar_preset, 'badge_cashier');
    assert.equal(presetRes.json.user.avatar_color, '#007B83');
    assert.equal(presetRes.json.user.own_avatar_url, '');

    // Re-upload photo and delete via DELETE /api/profile/me/avatar
    const reupload = await api(
      '/api/profile/me/avatar',
      'POST',
      { dataUrl: VALID_TINY_PNG_DATA_URL },
      cashier1Token
    );
    assert.equal(reupload.status, 200);
    assert.ok(reupload.json.avatar_url);

    const delRes = await api('/api/profile/me/avatar', 'DELETE', undefined, cashier1Token);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.json.user.own_avatar_url, '');
  });

  it('18. supports self-service username availability, password-verified username change, and triple-mode login', async () => {
    // Live availability checks
    const availOk = await api(
      '/api/profile/username-available?username=Sara.Cashier_1',
      'GET',
      undefined,
      cashier1Token
    );
    assert.equal(availOk.status, 200);
    assert.equal(availOk.json.available, true);
    assert.equal(availOk.json.normalized, 'sara.cashier_1');

    const availTaken = await api(
      '/api/profile/username-available?username=ADMIN',
      'GET',
      undefined,
      cashier1Token
    );
    assert.equal(availTaken.status, 200);
    assert.equal(availTaken.json.available, false);

    const availReserved = await api(
      '/api/profile/username-available?username=root',
      'GET',
      undefined,
      cashier1Token
    );
    assert.equal(availReserved.status, 200);
    assert.equal(availReserved.json.available, false);

    // Wrong current_password rejected
    const wrongPassRes = await api(
      '/api/profile/me/username',
      'PUT',
      { new_username: 'sara.cashier_1', current_password: '999' },
      cashier1Token
    );
    assert.equal(wrongPassRes.status, 400);

    // Correct current_password ('601') updates username
    const changeUserRes = await api(
      '/api/profile/me/username',
      'PUT',
      { new_username: 'Sara.Cashier_1', current_password: '601' },
      cashier1Token
    );
    assert.equal(changeUserRes.status, 200);
    assert.equal(changeUserRes.json.user.username, 'sara.cashier_1');
    const c1UserId = changeUserRes.json.user.id;

    // Duplicate username rejected for another user with 409
    const dupUserRes = await api(
      '/api/profile/me/username',
      'PUT',
      { new_username: 'SARA.CASHIER_1', current_password: '602' },
      cashier2Token
    );
    assert.equal(dupUserRes.status, 409);

    // Triple-mode login verification:
    // Mode 1: Username + Password (case-insensitive username)
    const loginByUsername = await api('/api/auth/login', 'POST', {
      username: 'SARA.CASHIER_1',
      password: '601',
    });
    assert.equal(loginByUsername.status, 200);
    assert.equal(loginByUsername.json.user.id, c1UserId);
    assert.equal(loginByUsername.json.user.username, 'sara.cashier_1');

    // Mode 2: Role Photo Card Tap (user_id + password)
    const loginByUserId = await api('/api/auth/login', 'POST', {
      user_id: c1UserId,
      password: '601',
    });
    assert.equal(loginByUserId.status, 200);
    assert.equal(loginByUserId.json.user.id, c1UserId);

    // Mode 3: Fast PIN / Password-only keypad
    const loginByPinOnly = await api('/api/auth/login', 'POST', {
      password: '601',
    });
    assert.equal(loginByPinOnly.status, 200);
    assert.equal(loginByPinOnly.json.user.id, c1UserId);
    cashier1Token = loginByPinOnly.json.token;
  });

  it('19. enforces self-service password change, session_version revocation, blocks old emp_code bypass, and hides conflict display_name', async () => {
    // Open two concurrent sessions for Security Guard (emp_code = '501')
    const secSessionA = await api('/api/auth/login', 'POST', { password: '501' });
    const secSessionB = await api('/api/auth/login', 'POST', { password: '501' });
    assert.equal(secSessionA.status, 200);
    assert.equal(secSessionB.status, 200);
    const tokenA = secSessionA.json.token;
    const tokenB = secSessionB.json.token;

    // Verify GET /api/profile/me/sessions lists active sessions
    const sessionsList = await api('/api/profile/me/sessions', 'GET', undefined, tokenA);
    assert.equal(sessionsList.status, 200);
    assert.ok(sessionsList.json.sessions.length >= 2);
    assert.ok(sessionsList.json.sessions.some((s) => s.is_current === true));

    // Attempt password change to an already-used password ('123' used by Owner)
    // MUST return 400 and NEVER leak the conflicting user's display_name!
    const conflictAttempt = await api(
      '/api/profile/me/password',
      'PUT',
      {
        current_password: '501',
        new_password: '123',
        confirm_password: '123',
      },
      tokenA
    );
    assert.equal(conflictAttempt.status, 400);
    assert.equal(
      conflictAttempt.json.error.includes('Admin') || conflictAttempt.json.error.includes('إدارة'),
      false,
      'Self-service password conflict must not leak the other account display_name'
    );

    // Change Security password from '501' to 'Sec#2026' on tokenA
    const pwdChange = await api(
      '/api/profile/me/password',
      'PUT',
      {
        current_password: '501',
        new_password: 'Sec#2026',
        confirm_password: 'Sec#2026',
      },
      tokenA
    );
    assert.equal(pwdChange.status, 200);
    assert.equal(pwdChange.json.ok, true);
    assert.ok(pwdChange.json.token, 'Must issue fresh session token for active device');
    const freshTokenA = pwdChange.json.token;

    // Old tokenB AND old tokenA (v1) must now be rejected with 401
    const checkOldB = await api('/api/auth/me', 'GET', undefined, tokenB);
    assert.equal(checkOldB.status, 401);
    const checkOldA = await api('/api/auth/me', 'GET', undefined, tokenA);
    assert.equal(checkOldA.status, 401);

    // Fresh token (v2) remains authenticated seamlessly
    const checkFreshA = await api('/api/auth/me', 'GET', undefined, freshTokenA);
    assert.equal(checkFreshA.status, 200);

    // CRITICAL SECURITY ASSERTION: Old emp_code '501' MUST NOT bypass the new password via employees table fallback!
    const bypassAttempt = await api('/api/auth/login', 'POST', { password: '501' });
    assert.equal(
      bypassAttempt.status,
      401,
      'Old emp_code must be rejected after employee changes their password'
    );

    // New password logs in cleanly
    const loginNewPass = await api('/api/auth/login', 'POST', { password: 'Sec#2026' });
    assert.equal(loginNewPass.status, 200);
    assert.equal(loginNewPass.json.user.role, 'security');

    // Restore Security password to '5015' ( >= 4 chars) or admin reset back to '501' for subsequent tests
    const adminRestore = await api(
      `/api/settings/role-accounts/${loginNewPass.json.user.id}/credentials`,
      'PUT',
      { new_password: '501' },
      ownerToken
    );
    assert.equal(adminRestore.status, 200);
    const reloginSec = await api('/api/auth/login', 'POST', { password: '501' });
    assert.equal(reloginSec.status, 200);
    securityToken = reloginSec.json.token;
  });

  it('20. supports admin role-level default photos, account credential/photo management, RBAC/kiosk guards, and preferences sync', async () => {
    // Non-admin (cashier) blocked from admin role-accounts endpoints
    const forbiddenList = await api('/api/settings/role-accounts', 'GET', undefined, cashier1Token);
    assert.equal(forbiddenList.status, 403);

    const forbiddenRoleAvatar = await api(
      '/api/settings/roles/cashier/avatar',
      'POST',
      { dataUrl: VALID_TINY_PNG_DATA_URL },
      cashier1Token
    );
    assert.equal(forbiddenRoleAvatar.status, 403);

    // Owner fetches full role-accounts directory
    const dirRes = await api('/api/settings/role-accounts', 'GET', undefined, ownerToken);
    assert.equal(dirRes.status, 200);
    assert.equal(dirRes.json.roles.length, 10);
    assert.ok(dirRes.json.accounts.length >= 5);

    // Owner sets default photo for 'cashier' role -> Cashier without custom photo inherits it!
    const roleAvatarRes = await api(
      '/api/settings/roles/cashier/avatar',
      'POST',
      { dataUrl: VALID_TINY_PNG_DATA_URL },
      ownerToken
    );
    assert.equal(roleAvatarRes.status, 200);
    assert.ok(roleAvatarRes.json.avatar_url);

    const c2Prof = await api('/api/profile/me', 'GET', undefined, cashier2Token);
    assert.equal(c2Prof.status, 200);
    assert.equal(c2Prof.json.profile.own_avatar_url, '');
    assert.equal(c2Prof.json.profile.role_default_avatar_url, roleAvatarRes.json.avatar_url);
    assert.equal(c2Prof.json.profile.effective_avatar_url, roleAvatarRes.json.avatar_url);

    // Owner updates Hall account credentials (username + password) -> invalidates old hallToken
    const hallAccount = dirRes.json.accounts.find((a) => a.employee_id === hallEmpId);
    assert.ok(hallAccount);
    const adminCredUpdate = await api(
      `/api/settings/role-accounts/${hallAccount.id}/credentials`,
      'PUT',
      {
        username: 'karim.hall',
        display_name: 'كريم منسق الممر',
        new_password: '5029',
      },
      ownerToken
    );
    assert.equal(adminCredUpdate.status, 200);
    assert.equal(adminCredUpdate.json.account.username, 'karim.hall');

    const oldHallCheck = await api('/api/auth/me', 'GET', undefined, hallToken);
    assert.equal(oldHallCheck.status, 401);

    const newHallLogin = await api('/api/auth/login', 'POST', {
      username: 'karim.hall',
      password: '5029',
    });
    assert.equal(newHallLogin.status, 200);
    hallToken = newHallLogin.json.token;

    // Last-owner lockout guard prevents deactivating or demoting sole owner
    const ownerAccount = dirRes.json.accounts.find((a) => a.role === 'owner');
    assert.ok(ownerAccount);
    const demoteOwnerAttempt = await api(
      `/api/settings/role-accounts/${ownerAccount.id}/credentials`,
      'PUT',
      { role: 'manager' },
      ownerToken
    );
    assert.equal(demoteOwnerAttempt.status, 400);

    // Preferences sync (canonical + alias fields)
    const prefRes = await api(
      '/api/profile/me/preferences',
      'PUT',
      {
        theme: 'liquid-glass',
        mode: 'dark',
        reducedBlur: true,
        fontFamily: 'ibm-plex',
        fontScale: 'scale-large',
        density: 'compact',
        liteMode: false,
        voiceConfirm: true,
        uiSounds: true,
        walkieChimes: false,
      },
      cashier1Token
    );
    assert.equal(prefRes.status, 200);
    assert.equal(prefRes.json.preferences.theme, 'liquid-glass');
    assert.equal(prefRes.json.preferences.modePref, 'dark');
    assert.equal(prefRes.json.preferences.glassMode, 'reduced');
    assert.equal(prefRes.json.preferences.fontFamily, 'ibm-plex');
    assert.equal(prefRes.json.preferences.walkieChimes, false);

    const c1Boot = await api('/api/bootstrap', 'GET', undefined, cashier1Token);
    assert.equal(c1Boot.status, 200);
    assert.equal(c1Boot.json.myProfile.preferences.theme, 'liquid-glass');
    assert.equal(c1Boot.json.myProfile.preferences.modePref, 'dark');

    // Canonical 'ibm' & 'auto' fontFamily and 'auto' glassMode round-trip cleanly
    const prefCanonicalIbm = await api(
      '/api/profile/me/preferences',
      'PUT',
      { fontFamily: 'ibm', glassMode: 'auto' },
      cashier1Token
    );
    assert.equal(prefCanonicalIbm.status, 200);
    assert.equal(prefCanonicalIbm.json.preferences.fontFamily, 'ibm');
    assert.equal(prefCanonicalIbm.json.preferences.glassMode, 'auto');

    const prefCanonicalAuto = await api(
      '/api/profile/me/preferences',
      'PUT',
      { fontFamily: 'auto', glassMode: 'auto' },
      cashier1Token
    );
    assert.equal(prefCanonicalAuto.status, 200);
    assert.equal(prefCanonicalAuto.json.preferences.fontFamily, 'auto');
    assert.equal(prefCanonicalAuto.json.preferences.glassMode, 'auto');

    // Legacy 8-theme -> 5-theme alias migration & invalid theme rejection (preserves previous valid theme)
    const prefLegacyNordic = await api(
      '/api/profile/me/preferences',
      'PUT',
      { theme: 'nordic' },
      cashier1Token
    );
    assert.equal(prefLegacyNordic.status, 200);
    assert.equal(prefLegacyNordic.json.preferences.theme, 'minimal');

    const bootAfterNordic = await api('/api/bootstrap', 'GET', undefined, cashier1Token);
    assert.equal(bootAfterNordic.status, 200);
    assert.equal(bootAfterNordic.json.myProfile.preferences.theme, 'minimal');

    const prefLegacyCyber = await api(
      '/api/profile/me/preferences',
      'PUT',
      { theme: 'cyber-ops' },
      cashier1Token
    );
    assert.equal(prefLegacyCyber.status, 200);
    assert.equal(prefLegacyCyber.json.preferences.theme, 'modern');

    const prefLegacyDesert = await api(
      '/api/profile/me/preferences',
      'PUT',
      { theme: 'desert-sand' },
      cashier1Token
    );
    assert.equal(prefLegacyDesert.status, 200);
    assert.equal(prefLegacyDesert.json.preferences.theme, 'elegant');

    const prefInvalidTheme = await api(
      '/api/profile/me/preferences',
      'PUT',
      { theme: 'invalid-theme-xyz' },
      cashier1Token
    );
    assert.equal(prefInvalidTheme.status, 200);
    assert.equal(
      prefInvalidTheme.json.preferences.theme,
      'elegant',
      'Invalid theme string must be ignored while preserving previous valid theme'
    );

    // Self-healing on read for legacy DB rows across /api/bootstrap, /api/profile/me, and /api/auth/me
    const { DatabaseService } = require('../dist/database/database.service.js');
    const dbService = nestApp.get(DatabaseService);
    const c1UserId = c1Boot.json.myProfile.user_id;

    for (const [legacyTheme, expectedCanonical] of [
      ['nordic', 'minimal'],
      ['cyber-ops', 'modern'],
      ['desert-sand', 'elegant'],
    ]) {
      await dbService.execute(
        'UPDATE system_users SET preferences_json = ? WHERE id = ?',
        [JSON.stringify({ theme: legacyTheme, modePref: 'dark' }), c1UserId]
      );
      const healedBoot = await api('/api/bootstrap', 'GET', undefined, cashier1Token);
      assert.equal(healedBoot.status, 200);
      assert.equal(healedBoot.json.myProfile.preferences.theme, expectedCanonical);

      const healedProfile = await api('/api/profile/me', 'GET', undefined, cashier1Token);
      assert.equal(healedProfile.status, 200);
      assert.equal(healedProfile.json.profile.preferences.theme, expectedCanonical);

      const healedAuthMe = await api('/api/auth/me', 'GET', undefined, cashier1Token);
      assert.equal(healedAuthMe.status, 200);
      assert.equal(healedAuthMe.json.user.preferences.theme, expectedCanonical);
    }

    // Corrupt/unknown theme in legacy DB row is stripped cleanly on read
    await dbService.execute(
      'UPDATE system_users SET preferences_json = ? WHERE id = ?',
      [JSON.stringify({ theme: 'corrupt-removed-theme', modePref: 'light' }), c1UserId]
    );
    const healedCorruptBoot = await api('/api/bootstrap', 'GET', undefined, cashier1Token);
    assert.equal(healedCorruptBoot.status, 200);
    assert.equal(healedCorruptBoot.json.myProfile.preferences.theme, undefined);
    assert.equal(healedCorruptBoot.json.myProfile.preferences.modePref, 'light');

    // Kiosk token is strictly blocked (403) from self-service profile & preferences mutations
    const kioskLock = await api('/api/auth/lock-to-kiosk', 'POST', {}, ownerToken);
    assert.equal(kioskLock.status, 200);
    const kioskToken = kioskLock.json.token;

    const kioskPrefAttempt = await api(
      '/api/profile/me/preferences',
      'PUT',
      { theme: 'modern' },
      kioskToken
    );
    assert.equal(kioskPrefAttempt.status, 403);

    const kioskPassAttempt = await api(
      '/api/profile/me/password',
      'PUT',
      { current_password: '123', new_password: '9999' },
      kioskToken
    );
    assert.equal(kioskPassAttempt.status, 403);
  });
});

describe('Legacy Unmigrated Schema Compatibility E2E (missing v4.2 CCTV & v4.3 avatar_url columns)', () => {
  let legacyApp;
  let baseUrl = '';
  let tempDir = '';

  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zayed-legacy-schema-e2e-'));
    const dbPath = path.join(tempDir, 'legacy_zayed.db');

    // Pre-create the exact pre-v42/v43 table definitions (WITHOUT avatar_url, session_version, preferences_json, verified_by, cctv_status)
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE system_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        pin_cipher TEXT DEFAULT '',
        avatar_color TEXT DEFAULT '#0B57D0',
        is_active INTEGER DEFAULT 1,
        employee_id TEXT DEFAULT '',
        custom_permissions_json TEXT DEFAULT '[]',
        last_login_at TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE role_policies (
        role TEXT PRIMARY KEY,
        permissions_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE employees (
        id TEXT PRIMARY KEY,
        emp_code TEXT DEFAULT '',
        name TEXT NOT NULL,
        department TEXT NOT NULL,
        role_title TEXT DEFAULT '',
        shift_start TEXT DEFAULT '08:00',
        shift_end TEXT DEFAULT '20:00',
        avatar_color TEXT DEFAULT '#0B57D0',
        phone TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1,
        system_role TEXT DEFAULT '',
        login_enabled INTEGER DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE attendance_logs (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        employee_name TEXT NOT NULL,
        department TEXT NOT NULL,
        action_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        date_key TEXT NOT NULL,
        shift_date_key TEXT DEFAULT '',
        late_minutes INTEGER DEFAULT 0,
        allowed_break_minutes INTEGER DEFAULT 0,
        break_duration_minutes INTEGER DEFAULT 0,
        break_reason TEXT DEFAULT '',
        note TEXT DEFAULT '',
        proof_url TEXT DEFAULT '',
        recorded_by TEXT NOT NULL,
        verified_by_cctv INTEGER DEFAULT 0,
        verified_at TEXT DEFAULT '',
        synced INTEGER DEFAULT 1
      );
      CREATE TABLE walkie_presence (
        presence_key TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        role_label TEXT DEFAULT '',
        avatar_color TEXT DEFAULT '#146C2E',
        channel TEXT NOT NULL DEFAULT 'security',
        status TEXT NOT NULL DEFAULT 'listening',
        live_on INTEGER DEFAULT 1,
        mic_mode TEXT DEFAULT 'vad',
        updated_at_ms BIGINT NOT NULL
      );
    `);
    rawDb.close();

    process.env.ZAYED_TEST_DB_PATH = dbPath;
    process.env.ZAYED_UPLOADS_DIR = path.join(tempDir, 'uploads');
    process.env.ZAYED_DISABLE_CLOUD_BROADCAST = '1';
    process.env.ZAYED_SKIP_AUTO_SCHEMA_ALTER = '1';
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.POSTGRES_PRISMA_URL;

    const { createZayedNestApp } = require('../dist/app.factory.js');
    legacyApp = await createZayedNestApp({ serveSpa: false, quietLogs: true });
    await legacyApp.listen(0, '127.0.0.1');
    const addr = legacyApp.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    delete process.env.ZAYED_SKIP_AUTO_SCHEMA_ALTER;
    if (legacyApp) {
      await legacyApp.close();
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

  it('supports login (123), profiles, bootstrap, schedule, attendance, verify, preferences, and rbac without v42/v43 columns', async () => {
    const health = await api('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.pendingSchemaMigration, true);
    assert.equal(health.json.schemaCaps.systemUsersRoleProfiles, false);
    assert.equal(health.json.schemaCaps.attendanceCctvMeta, false);

    const profiles = await api('/api/auth/profiles');
    assert.equal(profiles.status, 200);
    assert.equal(profiles.json.ok, true);
    assert.ok(Array.isArray(profiles.json.profiles) && profiles.json.profiles.length >= 1);

    const login = await api('/api/auth/login', 'POST', { password: '123' });
    assert.equal(login.status, 200);
    assert.equal(login.json.ok, true);
    assert.equal(login.json.user.role, 'owner');
    const token = login.json.token;

    const boot = await api('/api/bootstrap', 'GET', undefined, token);
    assert.equal(boot.status, 200);
    assert.equal(boot.json.auth.user.role, 'owner');

    const schedule = await api('/api/schedules/week', 'GET', undefined, token);
    assert.equal(schedule.status, 200);
    assert.equal(schedule.json.ok, true);
    assert.ok(Array.isArray(schedule.json.groups));
    assert.ok(Array.isArray(schedule.json.shiftRoster));

    const empRes = await api(
      '/api/employees',
      'POST',
      { name: 'كاشير تجريبي', emp_code: '777', department: 'كاشير', system_role: 'cashier' },
      token
    );
    assert.equal(empRes.status, 201);
    const empId = empRes.json.employee.id;

    const checkIn = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'check_in', confirm_by_cctv: false },
      token
    );
    assert.equal(checkIn.status, 201);
    assert.ok(checkIn.json.log?.id);

    const verifyOne = await api(
      `/api/attendance/${checkIn.json.log.id}/verify`,
      'POST',
      { status: 'confirmed', note: 'ظاهر بالكاميرا' },
      token
    );
    assert.equal(verifyOne.status, 200);
    assert.equal(verifyOne.json.ok, true);

    const verifyAll = await api('/api/attendance/verify-all', 'POST', {}, token);
    assert.equal(verifyAll.status, 200);

    const editLog = await api(
      `/api/attendance/${checkIn.json.log.id}`,
      'PUT',
      { note: 'ملاحظة معدلة' },
      token
    );
    assert.equal(editLog.status, 200);

    const prefSave = await api(
      '/api/profile/me/preferences',
      'PUT',
      { theme: 'modern', modePref: 'dark' },
      token
    );
    assert.equal(prefSave.status, 200);
    assert.equal(prefSave.json.preferences.theme, 'modern');

    const profileMe = await api('/api/profile/me', 'GET', undefined, token);
    assert.equal(profileMe.status, 200);
    assert.equal(profileMe.json.profile.preferences.theme, 'modern');

    const roleAccounts = await api('/api/settings/role-accounts', 'GET', undefined, token);
    assert.equal(roleAccounts.status, 200);
    assert.equal(roleAccounts.json.ok, true);

    const rbacOverview = await api('/api/rbac/overview', 'GET', undefined, token);
    assert.equal(rbacOverview.status, 200);
    assert.ok(Array.isArray(rbacOverview.json.users));

    // Legacy unmigrated schema avatar preset + photo upload + role default avatar + account avatar
    const VALID_TINY_PNG =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // 1) Self-service avatar preset selection persists immediately across /profile/me, /auth/me, /bootstrap, /auth/profiles
    const presetSave = await api(
      '/api/profile/me',
      'PUT',
      { avatar_preset: 'badge_crown', avatar_color: '#007B83', clear_photo: true },
      token
    );
    assert.equal(presetSave.status, 200);
    assert.equal(presetSave.json.user.avatar_preset, 'badge_crown');
    assert.equal(presetSave.json.user.avatar_color, '#007B83');
    assert.equal(presetSave.json.user.effective_avatar_url, '');

    const [profAfterPreset, meAfterPreset, bootAfterPreset, pubAfterPreset] = await Promise.all([
      api('/api/profile/me', 'GET', undefined, token),
      api('/api/auth/me', 'GET', undefined, token),
      api('/api/bootstrap', 'GET', undefined, token),
      api('/api/auth/profiles'),
    ]);
    assert.equal(profAfterPreset.json.profile.avatar_preset, 'badge_crown');
    assert.equal(meAfterPreset.json.user.avatar_preset, 'badge_crown');
    assert.equal(bootAfterPreset.json.myProfile.avatar_preset, 'badge_crown');
    assert.equal(
      pubAfterPreset.json.profiles.find((p) => p.id === presetSave.json.user.id)?.avatar_preset,
      'badge_crown'
    );

    // 2) Self-service photo upload succeeds without 503 SCHEMA_MIGRATION_REQUIRED
    const selfUpload = await api(
      '/api/profile/me/avatar',
      'POST',
      { dataUrl: VALID_TINY_PNG },
      token
    );
    assert.equal(selfUpload.status, 200);
    assert.equal(selfUpload.json.ok, true);
    assert.ok(selfUpload.json.avatar_url);
    assert.equal(selfUpload.json.user.effective_avatar_url, selfUpload.json.avatar_url);

    const [profAfterPhoto, meAfterPhoto, bootAfterPhoto, pubAfterPhoto] = await Promise.all([
      api('/api/profile/me', 'GET', undefined, token),
      api('/api/auth/me', 'GET', undefined, token),
      api('/api/bootstrap', 'GET', undefined, token),
      api('/api/auth/profiles'),
    ]);
    assert.equal(profAfterPhoto.json.profile.avatar_url, selfUpload.json.avatar_url);
    assert.equal(meAfterPhoto.json.user.avatar_url, selfUpload.json.avatar_url);
    assert.equal(bootAfterPhoto.json.myProfile.avatar_url, selfUpload.json.avatar_url);
    assert.equal(
      pubAfterPhoto.json.profiles.find((p) => p.id === selfUpload.json.user.id)?.avatar_url,
      selfUpload.json.avatar_url
    );

    // 3) Role default avatar upload + delete on unmigrated schema
    const roleUpload = await api(
      '/api/settings/roles/cashier/avatar',
      'POST',
      { dataUrl: VALID_TINY_PNG },
      token
    );
    assert.equal(roleUpload.status, 200);
    assert.ok(roleUpload.json.avatar_url);

    const accountsAfterRoleUpload = await api('/api/settings/role-accounts', 'GET', undefined, token);
    assert.equal(accountsAfterRoleUpload.status, 200);
    assert.equal(
      accountsAfterRoleUpload.json.roles.find((r) => r.id === 'cashier')?.avatar_url,
      roleUpload.json.avatar_url
    );

    // Employee/cashier inherits role default photo unless they pick an explicit preset
    const cashierLogin = await api('/api/auth/login', 'POST', { password: '777' });
    assert.equal(cashierLogin.status, 200);
    assert.equal(cashierLogin.json.user.effective_avatar_url, roleUpload.json.avatar_url);
    const cashierToken = cashierLogin.json.token;

    const cashierPresetOverride = await api(
      '/api/profile/me',
      'PUT',
      { avatar_preset: 'badge_star', avatar_color: '#146C2E', clear_photo: true },
      cashierToken
    );
    assert.equal(cashierPresetOverride.status, 200);
    assert.equal(cashierPresetOverride.json.user.avatar_preset, 'badge_star');
    assert.equal(cashierPresetOverride.json.user.own_avatar_url, '');
    assert.equal(cashierPresetOverride.json.user.effective_avatar_url, '');

    const roleDelete = await api(
      '/api/settings/roles/cashier/avatar',
      'DELETE',
      undefined,
      token
    );
    assert.equal(roleDelete.status, 200);

    // 4) Admin account avatar upload + self-service delete
    const targetAccount = accountsAfterRoleUpload.json.accounts.find(
      (a) => a.employee_id === empId
    );
    assert.ok(targetAccount);
    const acctAvatarUpload = await api(
      `/api/settings/role-accounts/${targetAccount.id}/avatar`,
      'POST',
      { dataUrl: VALID_TINY_PNG },
      token
    );
    assert.equal(acctAvatarUpload.status, 200);
    assert.ok(acctAvatarUpload.json.avatar_url);

    const selfDelete = await api('/api/profile/me/avatar', 'DELETE', undefined, token);
    assert.equal(selfDelete.status, 200);
    assert.equal(selfDelete.json.user.own_avatar_url, '');
  });
});

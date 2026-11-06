import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('ZayedMart NestJS API + Global Walkie-Talkie + Zero-Conflict Sync E2E', () => {
  let nestApp;
  let baseUrl = '';
  let tempDir = '';
  let ownerToken = '';
  let securityToken = '';
  let hallToken = '';

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

  it('4. records 12-hour shift attendance (check_in -> break_start -> break_end -> check_out)', async () => {
    const scanIn = await api(
      '/api/attendance/quick-scan',
      'POST',
      { code_or_qr: '501', preferred_action: 'check_in' },
      securityToken
    );
    assert.equal(scanIn.status, 201);
    assert.equal(scanIn.json.nextAction, 'check_in');
    const empId = scanIn.json.employee.id;

    const brkStart = await api(
      '/api/attendance',
      'POST',
      { employee_id: empId, action_type: 'break_start', allowed_break_minutes: 30 },
      securityToken
    );
    assert.equal(brkStart.status, 201);

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
  });

  it('5. enforces Tactical Walkie-Talkie security channel isolation, signaling, and live audio relay', async () => {
    // Hall employee has NO walkie:use -> strictly blocked 403
    const hallPoll = await api('/api/walkie/poll?channel=security', 'GET', undefined, hallToken);
    assert.equal(hallPoll.status, 403);

    // Security guard is allowed ONLY on CH-01 (security) -> blocked 403 from transmitting on warehouse CH-02
    const secWrongCh = await api(
      '/api/walkie/presence',
      'POST',
      { channel: 'warehouse', peer_id: 'peer_sec_1', status: 'listening', live_on: true },
      securityToken
    );
    assert.equal(secWrongCh.status, 403);

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

    // Owner polls and receives the live frame, presence, and sends an urgent alert ping
    const ownerPoll = await api(
      '/api/walkie/poll?channel=security&listening=1&peer_id=peer_owner_1&live_on=1&last_frame_seq=0',
      'GET',
      undefined,
      ownerToken
    );
    assert.equal(ownerPoll.status, 200);
    assert.equal(ownerPoll.json.liveFrames.length, 1);
    assert.equal(ownerPoll.json.liveFrames[0].from_peer_id, 'peer_sec_1');

    const pingTx = await api(
      '/api/walkie/transmit',
      'POST',
      { channel: 'security', peer_id: 'peer_sec_1', kind: 'ping', is_emergency: true },
      securityToken
    );
    assert.equal(pingTx.status, 201);
    assert.equal(pingTx.json.call.kind, 'ping');
  });
});

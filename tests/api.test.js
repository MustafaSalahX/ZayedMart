import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

function startTestServer(extraOptions = {}) {
  const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'zayed-uploads-'));
  const { app, db } = createApp({
    dbPath: ':memory:',
    uploadsDir: tempUploads,
    ...extraOptions,
  });

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        db,
        close: () =>
          new Promise((res) => {
            server.close(() => {
              fs.rmSync(tempUploads, { recursive: true, force: true });
              res();
            });
          }),
      });
    });
  });
}

async function loginByPassword(baseUrl, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function authHeaders(token, withJson = false) {
  const h = { Authorization: `Bearer ${token}` };
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

test('One-Time Password Login (123 Admin), Auto Role Routing, Password Manager, Clean Real Data & RBAC Security', async () => {
  const ctx = await startTestServer({ maxLoginAttempts: 4, lockoutMs: 30000 });
  try {
    // 1. Unauthenticated requests are blocked (401); public store-info leaks ZERO user accounts
    const unauthBoot = await fetch(`${ctx.baseUrl}/api/bootstrap`);
    assert.equal(unauthBoot.status, 401);

    const storeInfoRes = await fetch(`${ctx.baseUrl}/api/auth/store-info`);
    assert.equal(storeInfoRes.status, 200);
    const storeInfo = await storeInfoRes.json();
    assert.equal(storeInfo.store_name, 'زايد مارت');
    assert.equal(storeInfo.profiles, undefined);

    // 2. Admin logs in with password '123' ONLY -> auto-selects 'owner' role & persistent session
    const adminLogin = await loginByPassword(ctx.baseUrl, '123');
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.json.user.role, 'owner');
    const ownerToken = adminLogin.json.token;

    // 3. Database starts 100% clean (zero fake employees, zero fake suppliers) for Real Data
    const initialBoot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(ownerToken) })
    ).json();
    assert.equal(initialBoot.employees.length, 0);
    assert.equal(initialBoot.suppliers.length, 0);

    // 4. Universal Lock-to-Kiosk works even before a dedicated Kiosk password is created!
    const secondAdminSession = await loginByPassword(ctx.baseUrl, '123');
    const deviceKioskRes = await fetch(`${ctx.baseUrl}/api/auth/lock-to-kiosk`, {
      method: 'POST',
      headers: authHeaders(secondAdminSession.json.token),
    });
    assert.equal(deviceKioskRes.status, 200);
    const deviceKioskJson = await deviceKioskRes.json();
    assert.equal(deviceKioskJson.user.role, 'kiosk');

    const oldSecondAdminReuse = await fetch(`${ctx.baseUrl}/api/rbac/overview`, {
      headers: authHeaders(secondAdminSession.json.token),
    });
    assert.equal(oldSecondAdminReuse.status, 401, 'Privileged token revoked on Kiosk lock');

    // 5. Real Data Entry: Single + Bulk Employees & Suppliers + Edit
    const singleEmpRes = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'أحمد محمود سيد',
        department: 'كاشير',
        role_title: 'كاشير أول',
        phone: '01011223344',
        shift_start: '08:00',
        shift_end: '16:00',
      }),
    });
    assert.equal(singleEmpRes.status, 201);

    const bulkEmpRes = await fetch(`${ctx.baseUrl}/api/employees/bulk`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        department: 'منسقي ممرات',
        lines: 'محمود علي حسن - منسق ممرات - 01122334455\nسارة خالد إبراهيم - كاشير مسائي',
      }),
    });
    assert.equal(bulkEmpRes.status, 201);
    const bulkEmpJson = await bulkEmpRes.json();
    assert.equal(bulkEmpJson.addedCount, 2);

    const singleSupRes = await fetch(`${ctx.baseUrl}/api/suppliers`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'شركة جهينة للألبان',
        category: 'ألبان وجبن',
        phone: '01099887766',
      }),
    });
    assert.equal(singleSupRes.status, 201);

    const bulkSupRes = await fetch(`${ctx.baseUrl}/api/suppliers/bulk`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        category: 'مشروبات وعصائر',
        lines: 'شركة بيبسي كولا - 01233445566\nشركة المراعي',
      }),
    });
    assert.equal(bulkSupRes.status, 201);
    const bulkSupJson = await bulkSupRes.json();
    assert.equal(bulkSupJson.addedCount, 2);

    const populatedBoot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(ownerToken) })
    ).json();
    assert.equal(populatedBoot.employees.length, 3);
    assert.equal(populatedBoot.suppliers.length, 3);

    // Edit employee & supplier
    const editEmpRes = await fetch(
      `${ctx.baseUrl}/api/employees/${populatedBoot.employees[0].id}`,
      {
        method: 'PUT',
        headers: authHeaders(ownerToken, true),
        body: JSON.stringify({ role_title: 'مسؤول كاشير' }),
      }
    );
    assert.equal(editEmpRes.status, 200);

    const editSupRes = await fetch(
      `${ctx.baseUrl}/api/suppliers/${populatedBoot.suppliers[0].id}`,
      {
        method: 'PUT',
        headers: authHeaders(ownerToken, true),
        body: JSON.stringify({ phone: '01000000001' }),
      }
    );
    assert.equal(editSupRes.status, 200);

    // 6. Admin creates & manages role passwords; duplicate passwords across roles are blocked!
    const dupPassRes = await fetch(`${ctx.baseUrl}/api/rbac/users`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        display_name: 'مراقب مكرر',
        role: 'cctv',
        password: '123',
      }),
    });
    assert.equal(dupPassRes.status, 400, 'Duplicate password must be rejected');

    for (const acc of [
      { display_name: 'غرفة الكاميرات', role: 'cctv', password: '333' },
      { display_name: 'بوابة الأمن والاستلام', role: 'security', password: '444' },
      { display_name: 'تابلت كشك العمال', role: 'kiosk', password: '000' },
      { display_name: 'كلمة مرور مؤقتة', role: 'supervisor', password: '555' },
    ]) {
      const cr = await fetch(`${ctx.baseUrl}/api/rbac/users`, {
        method: 'POST',
        headers: authHeaders(ownerToken, true),
        body: JSON.stringify(acc),
      });
      assert.equal(cr.status, 201);
    }

    // Admin overview decrypts & shows all managed passwords (1 owner + 4 roles + 3 employees = 8)
    const overviewBefore = await (
      await fetch(`${ctx.baseUrl}/api/rbac/overview`, { headers: authHeaders(ownerToken) })
    ).json();
    assert.equal(overviewBefore.users.length, 8);
    const adminRow = overviewBefore.users.find((u) => u.role === 'owner');
    assert.equal(adminRow.password_value, '123');

    // 7. Password-only login automatically routes to Kiosk ('000'), Security ('444'), CCTV ('333')
    const kioskLogin = await loginByPassword(ctx.baseUrl, '000');
    assert.equal(kioskLogin.status, 200);
    assert.equal(kioskLogin.json.user.role, 'kiosk');
    const kioskToken = kioskLogin.json.token;

    const kioskBoot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(kioskToken) })
    ).json();
    assert.equal(kioskBoot.notes.length, 0);
    assert.equal(kioskBoot.truckLogs.length, 0);
    assert.equal(kioskBoot.employees[0].phone, undefined);

    const emp0 = kioskBoot.employees[0];
    const emp1 = kioskBoot.employees[1];

    const kioskAttRes = await fetch(`${ctx.baseUrl}/api/attendance`, {
      method: 'POST',
      headers: authHeaders(kioskToken, true),
      body: JSON.stringify({
        employee_id: emp0.id,
        action_type: 'check_in',
        recorded_by: 'SPOOFED_OWNER',
      }),
    });
    assert.equal(kioskAttRes.status, 201);
    const kioskAttJson = await kioskAttRes.json();
    assert.equal(kioskAttJson.log.recorded_by, 'كشك العمال');
    assert.equal(kioskAttJson.log.verified_by_cctv, 0);

    const qr1 = await fetch(`${ctx.baseUrl}/api/attendance/quick-scan`, {
      method: 'POST',
      headers: authHeaders(kioskToken, true),
      body: JSON.stringify({ code_or_qr: `ZMART:EMP:${emp1.id}` }),
    });
    assert.equal(qr1.status, 201);

    for (const forbiddenEndpoint of [
      '/api/notes',
      '/api/trucks/arrive',
      '/api/employees',
      `/api/attendance/${kioskAttJson.log.id}/verify`,
    ]) {
      const denied = await fetch(`${ctx.baseUrl}${forbiddenEndpoint}`, {
        method: 'POST',
        headers: authHeaders(kioskToken, true),
        body: JSON.stringify({ name: 'X', content: 'X', supplier_name: 'X' }),
      });
      assert.equal(denied.status, 403);
    }

    // Security login via password '444'
    const secLogin = await loginByPassword(ctx.baseUrl, '444');
    assert.equal(secLogin.status, 200);
    assert.equal(secLogin.json.user.role, 'security');
    const secToken = secLogin.json.token;

    const trkArriveRes = await fetch(`${ctx.baseUrl}/api/trucks/arrive`, {
      method: 'POST',
      headers: authHeaders(secToken, true),
      body: JSON.stringify({ supplier_id: populatedBoot.suppliers[0].id }),
    });
    assert.equal(trkArriveRes.status, 201);
    const trkArrive = await trkArriveRes.json();

    const secVerifyDenied = await fetch(
      `${ctx.baseUrl}/api/attendance/${kioskAttJson.log.id}/verify`,
      { method: 'POST', headers: authHeaders(secToken) }
    );
    assert.equal(secVerifyDenied.status, 403);

    // CCTV login via password '333'
    const cctvLogin = await loginByPassword(ctx.baseUrl, '333');
    assert.equal(cctvLogin.status, 200);
    assert.equal(cctvLogin.json.user.role, 'cctv');
    const cctvToken = cctvLogin.json.token;

    const verAllRes = await fetch(`${ctx.baseUrl}/api/attendance/verify-all`, {
      method: 'POST',
      headers: authHeaders(cctvToken, true),
      body: JSON.stringify({ date_key: populatedBoot.dateKey }),
    });
    assert.equal(verAllRes.status, 200);

    const handoverRes = await fetch(`${ctx.baseUrl}/api/handovers`, {
      method: 'POST',
      headers: authHeaders(cctvToken, true),
      body: JSON.stringify({
        from_operator: 'خالد',
        to_operator: 'طارق',
      }),
    });
    assert.equal(handoverRes.status, 201);

    const completeTrk = await fetch(`${ctx.baseUrl}/api/trucks/${trkArrive.truck.id}/complete`, {
      method: 'POST',
      headers: authHeaders(cctvToken, true),
      body: JSON.stringify({
        delivery_condition: 'return_damaged',
        notes: 'تلف عبوات',
      }),
    });
    assert.equal(completeTrk.status, 200);

    const cctvRbacDenied = await fetch(`${ctx.baseUrl}/api/rbac/users`, {
      method: 'POST',
      headers: authHeaders(cctvToken, true),
      body: JSON.stringify({ display_name: 'X', password: '999' }),
    });
    assert.equal(cctvRbacDenied.status, 403);

    // 8. Upload magic-byte check + Admin deleting a password revokes its session immediately
    const fakeUpload = await fetch(`${ctx.baseUrl}/api/upload`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${Buffer.from('not-a-real-png').toString('base64')}`,
      }),
    });
    assert.equal(fakeUpload.status, 400);

    const tempLogin = await loginByPassword(ctx.baseUrl, '555');
    assert.equal(tempLogin.status, 200);
    assert.equal(tempLogin.json.user.role, 'supervisor');

    // Cannot delete last active owner
    const ownerDelDenied = await fetch(`${ctx.baseUrl}/api/rbac/users/${adminRow.id}`, {
      method: 'DELETE',
      headers: authHeaders(ownerToken),
    });
    assert.equal(ownerDelDenied.status, 400);

    // Delete temporary supervisor password -> revokes its token immediately
    const delTempRes = await fetch(
      `${ctx.baseUrl}/api/rbac/users/${tempLogin.json.user.id}`,
      {
        method: 'DELETE',
        headers: authHeaders(ownerToken),
      }
    );
    assert.equal(delTempRes.status, 200);

    const revokedUse = await fetch(`${ctx.baseUrl}/api/bootstrap`, {
      headers: authHeaders(tempLogin.json.token),
    });
    assert.equal(revokedUse.status, 401);

    // 9. Clear test operational logs while preserving real employees, suppliers & passwords
    const clearLogsRes = await fetch(`${ctx.baseUrl}/api/system/clear-logs`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
    });
    assert.equal(clearLogsRes.status, 200);

    const afterClearBoot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(ownerToken) })
    ).json();
    assert.equal(afterClearBoot.employees.length, 3, 'Real employees preserved');
    assert.equal(afterClearBoot.suppliers.length, 3, 'Real suppliers preserved');
    assert.equal(afterClearBoot.attendanceLogs.length, 0, 'Test attendance logs cleared');
    assert.equal(afterClearBoot.truckLogs.length, 0, 'Test truck logs cleared');

    // 10. Brute-force wrong password rate limiting triggers 429 lockout
    for (let i = 0; i < 3; i++) {
      const bad = await loginByPassword(ctx.baseUrl, 'wrong_pass');
      assert.equal(bad.status, 401);
    }
    const fourthBad = await loginByPassword(ctx.baseUrl, 'wrong_pass');
    assert.equal(fourthBad.status, 429);
  } finally {
    await ctx.close();
  }
});

test('Hall Role (عمال الصالة), Shortages (Null / 0 / Number Qty), Strict Isolation, Admin Full Control & Range Reports', async () => {
  const ctx = await startTestServer();
  try {
    // 1. Admin logs in using Eastern Arabic digits '١٢٣' -> normalized to '123'
    const adminLogin = await loginByPassword(ctx.baseUrl, '١٢٣');
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.json.user.role, 'owner');
    const ownerToken = adminLogin.json.token;

    // Seed real data across all modules (employee, supplier, attendance, truck, note)
    const empRes = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({ name: 'مصطفى صلاح', department: 'منسقي ممرات', emp_code: '201' }),
    });
    const emp = (await empRes.json()).employee;

    const supRes = await fetch(`${ctx.baseUrl}/api/suppliers`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({ name: 'شركة المراعي', category: 'ألبان وجبن' }),
    });
    const sup = (await supRes.json()).supplier;

    const attRes = await fetch(`${ctx.baseUrl}/api/attendance`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({ employee_id: emp.id, action_type: 'check_in', note: 'حضور مبكر' }),
    });
    const attLog = (await attRes.json()).log;

    const trkRes = await fetch(`${ctx.baseUrl}/api/trucks/arrive`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({ supplier_id: sup.id, notes: 'وصول صباحي' }),
    });
    const trkLog = (await trkRes.json()).truck;

    const noteRes = await fetch(`${ctx.baseUrl}/api/notes`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        location_tag: 'الممرات والصالة',
        category_tag: 'ملاحظة عامة',
        severity: 'urgent',
        content: 'مراجعة ثلاجة الألبان',
      }),
    });
    const noteLog = (await noteRes.json()).note;

    // 2. Admin creates Hall Worker ('777') & Supervisor ('888') passwords
    for (const u of [
      { display_name: 'عامل الصالة - ممرات', role: 'hall', password: '777' },
      { display_name: 'مشرف الصالة', role: 'supervisor', password: '888' },
    ]) {
      const r = await fetch(`${ctx.baseUrl}/api/rbac/users`, {
        method: 'POST',
        headers: authHeaders(ownerToken, true),
        body: JSON.stringify(u),
      });
      assert.equal(r.status, 201);
    }

    // 3. Hall worker logs in with Arabic digits '٧٧٧' -> strictly sees ONLY shortages & catalog!
    const hallLogin = await loginByPassword(ctx.baseUrl, '٧٧٧');
    assert.equal(hallLogin.status, 200);
    assert.equal(hallLogin.json.user.role, 'hall');
    const hallToken = hallLogin.json.token;

    const hallBoot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(hallToken) })
    ).json();
    assert.equal(hallBoot.employees.length, 0, 'Hall role must not see employees');
    assert.equal(hallBoot.attendanceLogs.length, 0, 'Hall role must not see attendance logs');
    assert.equal(hallBoot.suppliers.length, 0, 'Hall role must not see suppliers');
    assert.equal(hallBoot.truckLogs.length, 0, 'Hall role must not see truck logs');
    assert.equal(hallBoot.notes.length, 0, 'Hall role must not see CCTV notes');
    assert.equal(hallBoot.handovers.length, 0, 'Hall role must not see handovers');
    assert.equal(hallBoot.pendingHandover, null, 'Hall role must not see pending handover');
    assert.ok(Array.isArray(hallBoot.shortages), 'Hall role receives shortages list');
    assert.ok(Array.isArray(hallBoot.productCatalog), 'Hall role receives quick catalog');

    // Hall worker blocked from every non-shortage endpoint
    for (const [method, url] of [
      ['POST', '/api/attendance'],
      ['POST', '/api/trucks/arrive'],
      ['POST', '/api/notes'],
      ['POST', '/api/auth/lock-to-kiosk'],
      ['GET', '/api/reports/range'],
      ['GET', '/api/rbac/overview'],
    ]) {
      const denied = await fetch(`${ctx.baseUrl}${url}`, {
        method,
        headers: authHeaders(hallToken, method === 'POST'),
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      assert.equal(denied.status, 403, `Hall must get 403 on ${method} ${url}`);
    }

    // 4. Hall worker adds shortages with NULL (empty), 0, and positive Arabic-digit quantities
    const shNullRes = await fetch(`${ctx.baseUrl}/api/shortages`, {
      method: 'POST',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({
        item_name: 'لبن المراعي كامل الدسم 1 لتر',
        category: 'ألبان وجبن',
        requested_qty: '',
        urgency: 'out_of_stock',
      }),
    });
    assert.equal(shNullRes.status, 201);
    const shNull = (await shNullRes.json()).shortage;
    assert.strictEqual(shNull.requested_qty, null, 'Empty string must persist strictly as NULL');

    const shZeroRes = await fetch(`${ctx.baseUrl}/api/shortages`, {
      method: 'POST',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({
        item_name: 'جبنة فيتا 500 جم',
        category: 'ألبان وجبن',
        requested_qty: 0,
        unit: 'علبة',
        urgency: 'low_stock',
      }),
    });
    assert.equal(shZeroRes.status, 201);
    const shZero = (await shZeroRes.json()).shortage;
    assert.strictEqual(shZero.requested_qty, 0, 'Zero must persist strictly as 0 (not null)');

    const shNumRes = await fetch(`${ctx.baseUrl}/api/shortages`, {
      method: 'POST',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({
        item_name: 'زيت كريستال عباد 800 مل',
        category: 'بقالة جافة',
        requested_qty: '١٢',
        unit: 'كرتونة',
      }),
    });
    assert.equal(shNumRes.status, 201);
    const shNum = (await shNumRes.json()).shortage;
    assert.strictEqual(shNum.requested_qty, 12, 'Eastern Arabic digits converted to 12');

    // Negative quantity must be rejected
    const shBadQty = await fetch(`${ctx.baseUrl}/api/shortages`, {
      method: 'POST',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({ item_name: 'صنف خاطئ', requested_qty: -3 }),
    });
    assert.equal(shBadQty.status, 400);

    // Duplicate open shortage merges automatically instead of cluttering the list
    const shDupRes = await fetch(`${ctx.baseUrl}/api/shortages`, {
      method: 'POST',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({
        item_name: 'لبن المراعي كامل الدسم 1 لتر',
        category: 'ألبان وجبن',
        requested_qty: 0,
      }),
    });
    assert.equal(shDupRes.status, 200);
    const shDupJson = await shDupRes.json();
    assert.equal(shDupJson.merged, true);
    assert.strictEqual(shDupJson.shortage.requested_qty, 0);

    // Hall worker can update open item quantity back to null!
    const shBackToNull = await fetch(`${ctx.baseUrl}/api/shortages/${shNull.id}`, {
      method: 'PUT',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({ requested_qty: null, notes: 'الرف فاضي تماماً' }),
    });
    assert.equal(shBackToNull.status, 200);
    assert.strictEqual((await shBackToNull.json()).shortage.requested_qty, null);

    // Hall worker CANNOT permanently delete shortages or mark them resolved
    const hallDelDenied = await fetch(`${ctx.baseUrl}/api/shortages/${shNull.id}`, {
      method: 'DELETE',
      headers: authHeaders(hallToken),
    });
    assert.equal(hallDelDenied.status, 403);

    const hallStatusDenied = await fetch(`${ctx.baseUrl}/api/shortages/${shNull.id}/status`, {
      method: 'POST',
      headers: authHeaders(hallToken, true),
      body: JSON.stringify({ status: 'resolved' }),
    });
    assert.equal(hallStatusDenied.status, 403);

    // 5. Supervisor manages shortages (ordered/resolved) & bulk catalog, but still cannot DELETE records
    const supLogin = await loginByPassword(ctx.baseUrl, '888');
    const supToken = supLogin.json.token;

    const supOrderRes = await fetch(`${ctx.baseUrl}/api/shortages/${shZero.id}/status`, {
      method: 'POST',
      headers: authHeaders(supToken, true),
      body: JSON.stringify({ status: 'ordered' }),
    });
    assert.equal(supOrderRes.status, 200);

    const supBulkCat = await fetch(`${ctx.baseUrl}/api/catalog/bulk`, {
      method: 'POST',
      headers: authHeaders(supToken, true),
      body: JSON.stringify({
        category: 'مشروبات وعصائر',
        default_unit: 'باكت',
        lines: ['بيبسي لتر ونصف', 'عصير جهينة مانجو'],
      }),
    });
    assert.equal(supBulkCat.status, 201);
    assert.equal((await supBulkCat.json()).addedCount, 2);

    const supDelDenied = await fetch(`${ctx.baseUrl}/api/shortages/${shZero.id}`, {
      method: 'DELETE',
      headers: authHeaders(supToken),
    });
    assert.equal(supDelDenied.status, 403, 'Permanent delete reserved for Admin records:manage');

    // CCTV role must NOT see shortages in bootstrap or range reports
    await fetch(`${ctx.baseUrl}/api/rbac/users`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({ display_name: 'مراقب كاميرات', role: 'cctv', password: '333' }),
    });
    const cctvTok = (await loginByPassword(ctx.baseUrl, '333')).json.token;
    const cctvBootIso = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(cctvTok) })
    ).json();
    assert.equal(cctvBootIso.shortages.length, 0, 'CCTV must not receive shortages');
    assert.equal(cctvBootIso.productCatalog.length, 0, 'CCTV must not receive product catalog');
    const cctvRepIso = await (
      await fetch(`${ctx.baseUrl}/api/reports/range`, { headers: authHeaders(cctvTok) })
    ).json();
    assert.equal(cctvRepIso.totals.shortagesTotal, 0, 'CCTV range report must mask shortages');

    // 6. Admin Full Control: Comprehensive Reports + Edit & Delete ANY operational record
    const rangeRes = await fetch(`${ctx.baseUrl}/api/reports/range`, {
      headers: authHeaders(ownerToken),
    });
    assert.equal(rangeRes.status, 200);
    const rangeReport = await rangeRes.json();
    assert.equal(rangeReport.totals.shortagesTotal, 3);
    assert.equal(rangeReport.totals.shortagesOpen, 2);
    assert.equal(rangeReport.totals.shortagesOrdered, 1);
    assert.equal(rangeReport.employeeStats.length, 1);
    assert.equal(rangeReport.supplierStats.length, 1);

    // Admin edits & deletes attendance, truck, note, and shortage records
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/attendance/${attLog.id}`, {
          method: 'PUT',
          headers: authHeaders(ownerToken, true),
          body: JSON.stringify({ note: 'تم التعديل بواسطة الأدمن', late_minutes: 5 }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/trucks/${trkLog.id}`, {
          method: 'PUT',
          headers: authHeaders(ownerToken, true),
          body: JSON.stringify({ status: 'completed', delivery_condition: 'complete' }),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/notes/${noteLog.id}`, {
          method: 'PUT',
          headers: authHeaders(ownerToken, true),
          body: JSON.stringify({ content: 'تم الفحص والتعديل من الإدارة', is_open_handover: false }),
        })
      ).status,
      200
    );

    for (const delUrl of [
      `/api/shortages/${shNum.id}`,
      `/api/attendance/${attLog.id}`,
      `/api/trucks/${trkLog.id}`,
      `/api/notes/${noteLog.id}`,
    ]) {
      const dRes = await fetch(`${ctx.baseUrl}${delUrl}`, {
        method: 'DELETE',
        headers: authHeaders(ownerToken),
      });
      assert.equal(dRes.status, 200, `Admin must be able to delete ${delUrl}`);
    }

    // 7. Individual Employee Login & Shared Same-Role Visibility (Security & Hall Workers)
    const addSec1 = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'مصطفي صلاح',
        emp_code: '233',
        department: 'أمن ونظافة',
      }),
    });
    assert.equal(addSec1.status, 201);

    const addSec2 = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'رجب عبدالفتاح',
        emp_code: '234',
        department: 'أمن ونظافة',
      }),
    });
    assert.equal(addSec2.status, 201);

    const addHall1 = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'كريم حسن',
        emp_code: '235',
        department: 'منسقي ممرات',
      }),
    });
    assert.equal(addHall1.status, 201);

    const addHall2 = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'مصطفى سيد',
        emp_code: '236',
        department: 'ثلاجات وأجبان',
      }),
    });
    assert.equal(addHall2.status, 201);

    // Login as Security Guard 1 ('233' -> مصطفي صلاح)
    const sec1Login = await loginByPassword(ctx.baseUrl, '233');
    assert.equal(sec1Login.status, 200);
    assert.equal(sec1Login.json.user.role, 'security');
    assert.equal(sec1Login.json.user.display_name, 'مصطفي صلاح');

    // Login as Security Guard 2 ('234' -> رجب عبدالفتاح)
    const sec2Login = await loginByPassword(ctx.baseUrl, '234');
    assert.equal(sec2Login.status, 200);
    assert.equal(sec2Login.json.user.role, 'security');
    assert.equal(sec2Login.json.user.display_name, 'رجب عبدالفتاح');

    // Security Guard 1 logs a truck arrival
    const sec1Truck = await (
      await fetch(`${ctx.baseUrl}/api/trucks/arrive`, {
        method: 'POST',
        headers: authHeaders(sec1Login.json.token, true),
        body: JSON.stringify({ supplier_name: 'شركة المراعي' }),
      })
    ).json();
    assert.equal(sec1Truck.truck.recorded_by, 'مصطفي صلاح (الأمن)');

    // Security Guard 2 sees Security Guard 1's truck and completes it
    const sec2Boot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, {
        headers: authHeaders(sec2Login.json.token),
      })
    ).json();
    assert.equal(sec2Boot.truckLogs.length, 1);
    assert.equal(sec2Boot.truckLogs[0].recorded_by, 'مصطفي صلاح (الأمن)');

    // Login as Hall Worker 1 ('235' -> كريم حسن) and Hall Worker 2 ('236' -> مصطفى سيد)
    const hall1Login = await loginByPassword(ctx.baseUrl, '235');
    assert.equal(hall1Login.status, 200);
    assert.equal(hall1Login.json.user.role, 'hall');
    assert.equal(hall1Login.json.user.display_name, 'كريم حسن');

    const hall2Login = await loginByPassword(ctx.baseUrl, '236');
    assert.equal(hall2Login.status, 200);
    assert.equal(hall2Login.json.user.role, 'hall');
    assert.equal(hall2Login.json.user.display_name, 'مصطفى سيد');

    // Hall Worker 1 adds a shortage
    const h1Shortage = await (
      await fetch(`${ctx.baseUrl}/api/shortages`, {
        method: 'POST',
        headers: authHeaders(hall1Login.json.token, true),
        body: JSON.stringify({ item_name: 'مكرونة الملكة 400 جم', requested_qty: 10, unit: 'كرتونة' }),
      })
    ).json();
    assert.equal(h1Shortage.shortage.recorded_by, 'كريم حسن (عمال الصالة)');

    // Hall Worker 2 sees Hall Worker 1's shortage and updates its quantity
    const hall2Boot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, {
        headers: authHeaders(hall2Login.json.token),
      })
    ).json();
    const sharedItem = hall2Boot.shortages.find((s) => s.id === h1Shortage.shortage.id);
    assert.ok(sharedItem, 'Hall Worker 2 must see Hall Worker 1 shortage');

    const h2Update = await (
      await fetch(`${ctx.baseUrl}/api/shortages/${sharedItem.id}`, {
        method: 'PUT',
        headers: authHeaders(hall2Login.json.token, true),
        body: JSON.stringify({ requested_qty: 15 }),
      })
    ).json();
    assert.equal(h2Update.shortage.requested_qty, 15);
    assert.equal(h2Update.shortage.updated_by, 'مصطفى سيد (عمال الصالة)');

    // 10. Role-Specific Shift Handover & Role Colleagues Dropdown (الأمن للأمن، عمال الصالة لعمال الصالة)
    const sec1Boot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, {
        headers: authHeaders(sec1Login.json.token),
      })
    ).json();
    // Security 1 ('مصطفي صلاح') should see Security 2 ('رجب عبدالفتاح') in roleColleagues, NOT Hall workers
    assert.ok(
      sec1Boot.roleColleagues.some((c) => c.name === 'رجب عبدالفتاح'),
      'Security 1 dropdown should include Security 2'
    );
    assert.ok(
      !sec1Boot.roleColleagues.some((c) => c.name === 'مصطفي صلاح'),
      'Security 1 dropdown should exclude self'
    );
    assert.ok(
      !sec1Boot.roleColleagues.some((c) => c.name === 'كريم حسن'),
      'Security 1 dropdown should NOT include Hall workers'
    );

    // Security 1 submits a shift handover to Security 2
    const secHandoverRes = await fetch(`${ctx.baseUrl}/api/handovers`, {
      method: 'POST',
      headers: authHeaders(sec1Login.json.token, true),
      body: JSON.stringify({
        to_operator: 'رجب عبدالفتاح',
        shift_name: 'الوردية الصباحية ← المسائية',
        summary_note: 'تابع عربية المراعي على الرصيف',
      }),
    });
    assert.equal(secHandoverRes.status, 201);

    // Hall 1 ('كريم حسن') submits a shift handover to Hall 2 ('مصطفى سيد')
    const hallHandoverRes = await fetch(`${ctx.baseUrl}/api/handovers`, {
      method: 'POST',
      headers: authHeaders(hall1Login.json.token, true),
      body: JSON.stringify({
        to_operator: 'مصطفى سيد',
        shift_name: 'الوردية الصباحية ← المسائية',
        summary_note: 'باقي رص مكرونة الملكة',
      }),
    });
    assert.equal(hallHandoverRes.status, 201);

    // Verify Security 2 still sees Security 1's unacknowledged handover (Hall handover didn't overwrite it!)
    const sec2BootAfter = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, {
        headers: authHeaders(sec2Login.json.token),
      })
    ).json();
    assert.ok(sec2BootAfter.pendingHandover, 'Security 2 should see pending security handover');
    assert.equal(sec2BootAfter.pendingHandover.from_operator, 'مصطفي صلاح');
    assert.equal(sec2BootAfter.pendingHandover.to_operator, 'رجب عبدالفتاح');
    assert.equal(sec2BootAfter.pendingHandover.target_role, 'security');

    // Verify Hall 2 sees Hall 1's unacknowledged handover (isolated to hall role!)
    const hall2BootAfter = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, {
        headers: authHeaders(hall2Login.json.token),
      })
    ).json();
    assert.ok(hall2BootAfter.pendingHandover, 'Hall 2 should see pending hall handover');
    assert.equal(hall2BootAfter.pendingHandover.from_operator, 'كريم حسن');
    assert.equal(hall2BootAfter.pendingHandover.to_operator, 'مصطفى سيد');
    assert.equal(hall2BootAfter.pendingHandover.target_role, 'hall');

    // 11. Separated Departments: 'المدير' -> manager, 'نظافة' -> none (attendance card only)
    const addMgrRes = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        emp_code: '240',
        name: 'عادل محمود',
        department: 'المدير',
        role_title: 'مدير الفرع',
        phone: '01099887766',
      }),
    });
    assert.equal(addMgrRes.status, 201);
    const mgrLogin = await loginByPassword(ctx.baseUrl, '240');
    assert.equal(mgrLogin.status, 200);
    assert.equal(mgrLogin.json.user.role, 'manager');

    const addCleanRes = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        emp_code: '241',
        name: 'سعيد نظافة',
        department: 'نظافة',
        role_title: 'عامل نظافة',
      }),
    });
    assert.equal(addCleanRes.status, 201);
    const cleanLogin = await loginByPassword(ctx.baseUrl, '241');
    assert.equal(cleanLogin.status, 401, 'Cleaning department defaults to attendance-only (no login)');
  } finally {
    await ctx.close();
  }
});

test('Vercel Serverless Readiness: Clean Real Store Data, Cold-Start Session Rehydration, Non-Blocking SSE & Inline Proof Upload', async () => {
  const ctx1 = await startTestServer({ serverless: true, seedStoreData: true });
  const ctx2 = await startTestServer({ serverless: true, seedStoreData: true });
  try {
    // 1. Only Owner ('123') is pre-configured out of the box (zero fake accounts or fake employees)
    const login = await loginByPassword(ctx1.baseUrl, '123');
    assert.equal(login.status, 200, 'Owner password 123 should succeed');
    assert.equal(login.json.user.role, 'owner');
    const ownerToken = login.json.token;

    // 2. Store data starts 100% clean (zero fake employees, suppliers, catalog, or shortages)
    const boot1 = await (
      await fetch(`${ctx1.baseUrl}/api/bootstrap`, { headers: authHeaders(ownerToken) })
    ).json();
    assert.equal(boot1.employees.length, 0);
    assert.equal(boot1.suppliers.length, 0);
    assert.equal(boot1.productCatalog.length, 0);
    assert.equal(boot1.shortages.length, 0);

    // 3. Cold-Start Session Rehydration: token issued on Instance 1 works seamlessly on cold-started Instance 2
    const boot2Res = await fetch(`${ctx2.baseUrl}/api/bootstrap`, {
      headers: authHeaders(ownerToken),
    });
    assert.equal(boot2Res.status, 200, 'Token should survive serverless cold start across instances');
    const boot2 = await boot2Res.json();
    assert.equal(boot2.auth.user.role, 'owner');

    // 4. SSE endpoint (/api/events) closes cleanly in serverless mode without hanging
    const sseRes = await fetch(`${ctx1.baseUrl}/api/events`, {
      headers: authHeaders(ownerToken),
    });
    assert.equal(sseRes.status, 200);
    const sseText = await sseRes.text();
    assert.ok(sseText.includes('event: connected'));

    // 5. Image upload in serverless mode returns self-contained dataUrl after magic-byte validation
    const validPngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const uploadRes = await fetch(`${ctx1.baseUrl}/api/upload`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({ dataUrl: validPngBase64, prefix: 'vercel_test' }),
    });
    assert.equal(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.equal(uploadJson.url, validPngBase64);

    // 6. Explicit logout on Instance 2 revokes the rehydrated session on Instance 2
    const logoutRes = await fetch(`${ctx2.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders(ownerToken),
    });
    assert.equal(logoutRes.status, 200);
    const afterLogoutRes = await fetch(`${ctx2.baseUrl}/api/bootstrap`, {
      headers: authHeaders(ownerToken),
    });
    assert.equal(afterLogoutRes.status, 401);
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

test('12-Hour Cross-Day Shift Sync, Smart Break Duration, Cashier Role & Suggestions, Team Chat, Profile & Individual Logs', async () => {
  const ctx = await startTestServer();
  try {
    const adminLogin = await loginByPassword(ctx.baseUrl, '123');
    assert.equal(adminLogin.status, 200);
    const ownerToken = adminLogin.json.token;

    // 1. Create two Cashiers ('كاشير' -> role 'cashier') with 12-hour night shift (20:00 -> 08:00)
    const c1Res = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        emp_code: '501',
        name: 'ندى محمود',
        department: 'كاشير',
        role_title: 'كاشير مسائي 12 ساعة',
        shift_start: '20:00',
        shift_end: '08:00',
      }),
    });
    assert.equal(c1Res.status, 201);
    const cashier1 = (await c1Res.json()).employee;

    const c2Res = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        emp_code: '502',
        name: 'عمر خالد',
        department: 'كاشير',
        role_title: 'كاشير صباحي 12 ساعة',
        shift_start: '08:00',
        shift_end: '20:00',
      }),
    });
    assert.equal(c2Res.status, 201);

    // 2. Verify Cashier 1 & Cashier 2 log in with 'cashier' role & view personal profile + password
    const c1Login = await loginByPassword(ctx.baseUrl, '501');
    assert.equal(c1Login.status, 200);
    assert.equal(c1Login.json.user.role, 'cashier');
    const c1Token = c1Login.json.token;

    const c2Login = await loginByPassword(ctx.baseUrl, '502');
    assert.equal(c2Login.status, 200);
    assert.equal(c2Login.json.user.role, 'cashier');
    const c2Token = c2Login.json.token;

    const c1Profile = await (
      await fetch(`${ctx.baseUrl}/api/profile/me`, { headers: authHeaders(c1Token) })
    ).json();
    assert.equal(c1Profile.profile.my_password, '501');
    assert.equal(c1Profile.profile.display_name, 'ندى محمود');

    // 3. 12-Hour Cross-Day Shift Synchronization (Day 1: 2026-10-31 -> Day 2: 2026-11-01)
    const day1 = '2026-10-31';
    const day2 = '2026-11-01';

    // Check in on Day 1 at 20:05
    const checkInRes = await fetch(`${ctx.baseUrl}/api/attendance`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        employee_id: cashier1.id,
        action_type: 'check_in',
        timestamp: '2026-10-31T20:05:00',
      }),
    });
    assert.equal(checkInRes.status, 201);
    const checkInLog = (await checkInRes.json()).log;
    assert.equal(checkInLog.shift_date_key, day1);

    // Inspect Day 2 before any Day 2 action -> Cashier 1 must appear PRESENT on Day 2 via Cross-Day Shift sync!
    const bootDay2AfterCheckIn = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap?date=${day2}`, { headers: authHeaders(ownerToken) })
    ).json();
    const c1OnDay2 = bootDay2AfterCheckIn.employees.find((e) => e.id === cashier1.id);
    assert.equal(c1OnDay2.currentStatus, 'present', 'Employee checked in on Day 1 night shift must be present on Day 2');
    assert.equal(c1OnDay2.isCrossDayShift, true);
    assert.equal(c1OnDay2.shiftDateKey, day1);

    // On Day 2 at 01:00 AM, Security/Admin gives Cashier 1 a 30-minute break
    const breakStartRes = await fetch(`${ctx.baseUrl}/api/attendance`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        employee_id: cashier1.id,
        action_type: 'break_start',
        timestamp: '2026-11-01T01:00:00',
        allowed_break_minutes: 30,
        break_reason: 'بريك غداء/عشاء',
      }),
    });
    assert.equal(breakStartRes.status, 201);
    const breakStartLog = (await breakStartRes.json()).log;
    assert.equal(breakStartLog.shift_date_key, day1, 'Break on Day 2 links to Day 1 shift_date_key');
    assert.equal(breakStartLog.allowed_break_minutes, 30);

    // Verify both Day 1 and Day 2 show Cashier 1 as on_break with allowedBreakMinutes = 30
    const bootDay1DuringBreak = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap?date=${day1}`, { headers: authHeaders(ownerToken) })
    ).json();
    const c1Day1Break = bootDay1DuringBreak.employees.find((e) => e.id === cashier1.id);
    assert.equal(c1Day1Break.currentStatus, 'on_break');
    assert.equal(c1Day1Break.allowedBreakMinutes, 30);

    // On Day 2 at 01:25 AM, Cashier 1 ends break (25 minutes elapsed)
    const breakEndRes = await fetch(`${ctx.baseUrl}/api/attendance`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        employee_id: cashier1.id,
        action_type: 'break_end',
        timestamp: '2026-11-01T01:25:00',
      }),
    });
    assert.equal(breakEndRes.status, 201);
    const breakEndLog = (await breakEndRes.json()).log;
    assert.equal(breakEndLog.shift_date_key, day1);
    assert.equal(breakEndLog.break_duration_minutes, 25);

    // On Day 2 at 08:05 AM, Cashier 1 checks out -> syncs to both Day 1 and Day 2!
    const checkOutRes = await fetch(`${ctx.baseUrl}/api/attendance`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        employee_id: cashier1.id,
        action_type: 'check_out',
        timestamp: '2026-11-01T08:05:00',
      }),
    });
    assert.equal(checkOutRes.status, 201);
    const checkOutLog = (await checkOutRes.json()).log;
    assert.equal(checkOutLog.shift_date_key, day1);

    const bootDay1Final = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap?date=${day1}`, { headers: authHeaders(ownerToken) })
    ).json();
    const bootDay2Final = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap?date=${day2}`, { headers: authHeaders(ownerToken) })
    ).json();
    const c1Day1End = bootDay1Final.employees.find((e) => e.id === cashier1.id);
    const c1Day2End = bootDay2Final.employees.find((e) => e.id === cashier1.id);
    assert.equal(c1Day1End.currentStatus, 'checked_out', 'Day 1 reflects Day 2 check_out');
    assert.equal(c1Day2End.currentStatus, 'checked_out', 'Day 2 reflects Day 2 check_out');
    assert.equal(c1Day1End.totalBreakMinutes, 25);
    assert.equal(c1Day2End.totalBreakMinutes, 25);

    // 4. Cashier 1 posts a product suggestion (is_suggestion: true), a shortage, a cashier note, and a team chat message
    const sugRes = await fetch(`${ctx.baseUrl}/api/shortages`, {
      method: 'POST',
      headers: authHeaders(c1Token, true),
      body: JSON.stringify({
        item_name: 'شوكولاتة دبي فستق',
        category: 'بقالة جافة',
        is_suggestion: true,
        notes: 'العملاء يسألون عنها بكثرة عند الكاشير',
      }),
    });
    assert.equal(sugRes.status, 201);
    const sugItem = (await sugRes.json()).shortage;
    assert.equal(sugItem.is_suggestion, 1);

    const c1NoteRes = await fetch(`${ctx.baseUrl}/api/notes`, {
      method: 'POST',
      headers: authHeaders(c1Token, true),
      body: JSON.stringify({
        location_tag: 'الكاشير',
        category_tag: 'مشكلة كاشير / أسعار',
        severity: 'warning',
        content: 'باركود لبن جهينة 1.5 لتر غير معرف على السيستم',
      }),
    });
    assert.equal(c1NoteRes.status, 201);

    const chatRes = await fetch(`${ctx.baseUrl}/api/team-messages`, {
      method: 'POST',
      headers: authHeaders(c1Token, true),
      body: JSON.stringify({
        channel: 'cashier',
        priority: 'urgent',
        message: 'محتاجة فكة 10 و 20 جنيه على كاشير 1 ضروري',
      }),
    });
    assert.equal(chatRes.status, 201);

    // 5. Cashier 2 sees Cashier 1's suggestion, cashier note, and team chat message
    const c2Boot = await (
      await fetch(`${ctx.baseUrl}/api/bootstrap`, { headers: authHeaders(c2Token) })
    ).json();
    assert.equal(c2Boot.shortages.length, 1);
    assert.equal(c2Boot.shortages[0].is_suggestion, 1);
    assert.equal(c2Boot.notes.length, 1);
    assert.equal(c2Boot.teamMessages.length, 1);
    assert.equal(c2Boot.teamMessages[0].sender_name, 'ندى محمود');

    // 6. Individual Person Log (/api/logs/person/:id) & Master Audit Log (/api/audit-logs)
    const personLogRes = await fetch(`${ctx.baseUrl}/api/logs/person/${cashier1.id}`, {
      headers: authHeaders(ownerToken),
    });
    assert.equal(personLogRes.status, 200);
    const personLog = await personLogRes.json();
    assert.equal(personLog.summary.totalAttendanceEvents, 4);
    assert.equal(personLog.summary.totalBreakMinutes, 25);
    assert.equal(personLog.summary.shortagesCount, 1);
    assert.equal(personLog.summary.notesCount, 1);
    assert.equal(personLog.summary.messagesCount, 1);

    const masterAuditRes = await fetch(`${ctx.baseUrl}/api/audit-logs`, {
      headers: authHeaders(ownerToken),
    });
    assert.equal(masterAuditRes.status, 200);
    const masterAudit = await masterAuditRes.json();
    assert.ok(masterAudit.auditLogs.length > 0);
  } finally {
    await ctx.close();
  }
});

test('Tactical Walkie-Talkie PTT: Security Channel Isolation, Live Presence, SSE Relay, Emergency Broadcast & Auto-Pruning', async () => {
  const ctx = await startTestServer();
  try {
    const adminLogin = await loginByPassword(ctx.baseUrl, '123');
    assert.equal(adminLogin.status, 200);
    const ownerToken = adminLogin.json.token;

    // 1. Create two Security Guards, one CCTV operator, and one Hall worker
    const sec1Res = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'محمود بوابة ١',
        department: 'أمن',
        role_title: 'فرد أمن البوابة',
        emp_code: '701',
      }),
    });
    assert.equal(sec1Res.status, 201);

    const sec2Res = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'خالد رصيف الاستلام',
        department: 'أمن',
        role_title: 'فرد أمن الرصيف',
        emp_code: '702',
      }),
    });
    assert.equal(sec2Res.status, 201);

    const cctvRes = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'عمرو مراقب الكاميرات',
        department: 'مراقب كاميرات',
        role_title: 'مراقب كاميرات',
        emp_code: '703',
      }),
    });
    assert.equal(cctvRes.status, 201);

    const hallRes = await fetch(`${ctx.baseUrl}/api/employees`, {
      method: 'POST',
      headers: authHeaders(ownerToken, true),
      body: JSON.stringify({
        name: 'كريم منسق ممرات',
        department: 'منسقي ممرات',
        role_title: 'عامل صالة',
        emp_code: '704',
      }),
    });
    assert.equal(hallRes.status, 201);

    const sec1Login = await loginByPassword(ctx.baseUrl, '701');
    const sec2Login = await loginByPassword(ctx.baseUrl, '702');
    const cctvLogin = await loginByPassword(ctx.baseUrl, '703');
    const hallLogin = await loginByPassword(ctx.baseUrl, '704');

    assert.equal(sec1Login.json.user.role, 'security');
    assert.ok(sec1Login.json.permissions.includes('walkie:use'));
    assert.ok(!sec1Login.json.permissions.includes('walkie:all_channels'));
    assert.ok(cctvLogin.json.permissions.includes('walkie:use'));
    assert.ok(cctvLogin.json.permissions.includes('walkie:all_channels'));
    assert.ok(!hallLogin.json.permissions.includes('walkie:use'));

    const sec1Token = sec1Login.json.token;
    const sec2Token = sec2Login.json.token;
    const cctvToken = cctvLogin.json.token;
    const hallToken = hallLogin.json.token;

    // 2. Hall worker & Kiosk device are strictly blocked (403 FORBIDDEN) from Walkie-Talkie
    const hallPoll = await fetch(`${ctx.baseUrl}/api/walkie/poll?channel=security`, {
      headers: authHeaders(hallToken),
    });
    assert.equal(hallPoll.status, 403);

    // 3. Security Guard 1 starts holding PTT ('talking') -> Security Guard 2 sees live talking presence!
    const presTalkingRes = await fetch(`${ctx.baseUrl}/api/walkie/presence`, {
      method: 'POST',
      headers: authHeaders(sec1Token, true),
      body: JSON.stringify({ channel: 'security', status: 'talking' }),
    });
    assert.equal(presTalkingRes.status, 200);

    const sec2InitialPoll = await (
      await fetch(`${ctx.baseUrl}/api/walkie/poll?channel=security&listening=1`, {
        headers: authHeaders(sec2Token),
      })
    ).json();
    assert.equal(sec2InitialPoll.ok, true);
    assert.deepEqual(sec2InitialPoll.allowedChannels, ['security']);
    const talkingUnit = sec2InitialPoll.activeUnits.find((u) => u.display_name === 'محمود بوابة ١');
    assert.ok(talkingUnit, 'Guard 1 appears in activeUnits');
    assert.equal(talkingUnit.status, 'talking');

    // 4. Open live SSE stream for Security Guard 2 and verify instant walkie_tx push when Guard 1 transmits
    const sseController = new AbortController();
    const sseResponse = await fetch(
      `${ctx.baseUrl}/api/events?token=${encodeURIComponent(sec2Token)}`,
      { signal: sseController.signal }
    );
    assert.equal(sseResponse.status, 200);
    const reader = sseResponse.body.getReader();
    const decoder = new TextDecoder();
    // Read initial connected frame
    await reader.read();

    const sampleOpusDataUrl =
      'data:audio/webm;codecs=opus;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////';

    const txRes = await fetch(`${ctx.baseUrl}/api/walkie/transmit`, {
      method: 'POST',
      headers: authHeaders(sec1Token, true),
      body: JSON.stringify({
        channel: 'security',
        kind: 'voice',
        audio_data: sampleOpusDataUrl,
        duration_sec: 4.2,
      }),
    });
    assert.equal(txRes.status, 201);
    const txJson = await txRes.json();
    assert.equal(txJson.call.channel, 'security');
    assert.equal(txJson.call.sender_name, 'محمود بوابة ١');
    assert.equal(txJson.call.duration_sec, 4.2);

    const sseChunk = await reader.read();
    const sseText = decoder.decode(sseChunk.value);
    assert.ok(sseText.includes('event: walkie_tx'), 'SSE pushes walkie_tx immediately to Security Guard 2');
    assert.ok(sseText.includes('محمود بوابة ١'));
    sseController.abort();

    // 5. Security Guard 1 cannot transmit on 'warehouse' channel (isolated to 'security' channel!)
    const secWrongChannel = await fetch(`${ctx.baseUrl}/api/walkie/transmit`, {
      method: 'POST',
      headers: authHeaders(sec1Token, true),
      body: JSON.stringify({
        channel: 'warehouse',
        kind: 'voice',
        audio_data: sampleOpusDataUrl,
        duration_sec: 2.0,
      }),
    });
    assert.equal(secWrongChannel.status, 403);

    // 6. CCTV operator (walkie:all_channels) sends an urgent Call-Tone ping on 'emergency' -> Security Guard 2 receives it!
    const pingRes = await fetch(`${ctx.baseUrl}/api/walkie/transmit`, {
      method: 'POST',
      headers: authHeaders(cctvToken, true),
      body: JSON.stringify({
        channel: 'emergency',
        kind: 'ping',
        is_emergency: true,
      }),
    });
    assert.equal(pingRes.status, 201);

    const sec2DeltaPoll = await (
      await fetch(
        `${ctx.baseUrl}/api/walkie/poll?channel=security&since=${encodeURIComponent(txJson.call.timestamp)}`,
        { headers: authHeaders(sec2Token) }
      )
    ).json();
    assert.equal(sec2DeltaPoll.calls.length, 1);
    assert.equal(sec2DeltaPoll.calls[0].kind, 'ping');
    assert.equal(sec2DeltaPoll.calls[0].sender_name, 'عمرو مراقب الكاميرات');

    // 7. Auto-pruning keeps at most 25 calls per channel
    for (let i = 0; i < 28; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/walkie/transmit`, {
        method: 'POST',
        headers: authHeaders(sec1Token, true),
        body: JSON.stringify({
          channel: 'security',
          kind: 'voice',
          audio_data: sampleOpusDataUrl,
          duration_sec: 1.2,
        }),
      });
      assert.equal(r.status, 201);
    }
    const countRow = ctx.db
      .prepare("SELECT COUNT(*) as c FROM walkie_calls WHERE channel = 'security'")
      .get();
    assert.equal(countRow.c, 25, 'Channel history auto-pruned to max 25 clips');

    // 8. LIVE INTERCOM v2: WebRTC Mesh Signaling (/api/walkie/signal) + Simultaneous Live Audio Relay (/api/walkie/live-frame)
    const liveSseController = new AbortController();
    const liveSseRes = await fetch(
      `${ctx.baseUrl}/api/events?token=${encodeURIComponent(sec2Token)}`,
      { signal: liveSseController.signal }
    );
    const liveReader = liveSseRes.body.getReader();
    await liveReader.read(); // consume initial 'connected' frame

    // Guard 2 joins Live Channel with peer_sec2
    const joinSec2 = await fetch(`${ctx.baseUrl}/api/walkie/signal`, {
      method: 'POST',
      headers: authHeaders(sec2Token, true),
      body: JSON.stringify({
        channel: 'security',
        peer_id: 'peer_sec2',
        signal_type: 'join',
        data: { mic_mode: 'vad' },
      }),
    });
    assert.equal(joinSec2.status, 200);
    await liveReader.read(); // consume join broadcast

    // Guard 1 sends targeted WebRTC SDP offer to peer_sec2
    const offerRes = await fetch(`${ctx.baseUrl}/api/walkie/signal`, {
      method: 'POST',
      headers: authHeaders(sec1Token, true),
      body: JSON.stringify({
        channel: 'security',
        peer_id: 'peer_sec1',
        target_peer_id: 'peer_sec2',
        signal_type: 'offer',
        data: { sdp: { type: 'offer', sdp: 'v=0\r\n' } },
      }),
    });
    assert.equal(offerRes.status, 200);

    const sigSseChunk = await liveReader.read();
    const sigSseText = decoder.decode(sigSseChunk.value);
    assert.ok(sigSseText.includes('event: walkie_signal'), 'SSE delivers WebRTC offer signal in real time');
    assert.ok(sigSseText.includes('peer_sec1'));

    // Poll inbox also delivers targeted offer if a client is polling without SSE
    const sec2SignalPoll = await (
      await fetch(
        `${ctx.baseUrl}/api/walkie/poll?channel=security&listening=1&live_on=1&peer_id=peer_sec2`,
        { headers: authHeaders(sec2Token) }
      )
    ).json();
    assert.equal(sec2SignalPoll.signals.length, 1);
    assert.equal(sec2SignalPoll.signals[0].signal_type, 'offer');
    const baselineFrameSeq = sec2SignalPoll.latestFrameSeq;

    // Guard 1 & CCTV transmit live 250ms μ-law frames AT THE SAME TIME -> Guard 2 receives both simultaneously!
    const sampleMuLawFrame = Buffer.alloc(400, 0x7f).toString('base64');
    const [frame1Res, frame2Res] = await Promise.all([
      fetch(`${ctx.baseUrl}/api/walkie/live-frame`, {
        method: 'POST',
        headers: authHeaders(sec1Token, true),
        body: JSON.stringify({
          channel: 'security',
          peer_id: 'peer_sec1',
          sample_rate: 8000,
          ulaw_b64: sampleMuLawFrame,
        }),
      }),
      fetch(`${ctx.baseUrl}/api/walkie/live-frame`, {
        method: 'POST',
        headers: authHeaders(cctvToken, true),
        body: JSON.stringify({
          channel: 'security',
          peer_id: 'peer_cctv',
          sample_rate: 8000,
          ulaw_b64: sampleMuLawFrame,
        }),
      }),
    ]);
    assert.equal(frame1Res.status, 200);
    assert.equal(frame2Res.status, 200);

    const frameSseChunk = await liveReader.read();
    const frameSseText = decoder.decode(frameSseChunk.value);
    assert.ok(
      frameSseText.includes('event: walkie_live_frame'),
      'SSE streams live audio frames immediately'
    );
    liveSseController.abort();

    const sec2FramesPoll = await (
      await fetch(
        `${ctx.baseUrl}/api/walkie/poll?channel=security&listening=1&live_on=1&peer_id=peer_sec2&last_frame_seq=${baselineFrameSeq}`,
        { headers: authHeaders(sec2Token) }
      )
    ).json();
    assert.equal(
      sec2FramesPoll.liveFrames.length,
      2,
      'Both simultaneous speakers frames are delivered together without blocking each other'
    );

    // Security Guard 1 cannot stream live frames on 'warehouse' channel (RBAC isolated!)
    const secForbiddenLive = await fetch(`${ctx.baseUrl}/api/walkie/live-frame`, {
      method: 'POST',
      headers: authHeaders(sec1Token, true),
      body: JSON.stringify({
        channel: 'warehouse',
        peer_id: 'peer_sec1',
        ulaw_b64: sampleMuLawFrame,
      }),
    });
    assert.equal(secForbiddenLive.status, 403);
  } finally {
    await ctx.close();
  }
});

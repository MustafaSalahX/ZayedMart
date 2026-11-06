import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { syncEmployeeLoginAccount } from './db.js';

const SYNC_TABLES = [
  'employees',
  'suppliers',
  'product_catalog',
  'attendance_logs',
  'truck_logs',
  'shortages',
  'notes',
  'shift_handovers',
  'team_messages',
];

const dbSyncRuntime = new WeakMap();

function getRuntime(db) {
  let rt = dbSyncRuntime.get(db);
  if (!rt) {
    rt = {
      hydratedOnce: false,
      hydratingPromise: null,
      lastPullMs: 0,
      pushTimer: null,
      pushInFlight: null,
    };
    dbSyncRuntime.set(db, rt);
  }
  return rt;
}

export function getCloudConfig(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const envUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const envKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const url = (map.supabase_url || envUrl || '').trim();
  const anonKey = (map.supabase_anon_key || envKey || '').trim();
  const enabled =
    map.cloud_sync_enabled === 'true' ||
    (Boolean(url && anonKey) && map.cloud_sync_enabled !== 'false');
  return {
    url,
    anonKey,
    enabled,
    lastSync: map.last_cloud_sync || '',
  };
}

export async function testCloudConnection(url, anonKey) {
  if (!url || !anonKey) {
    return { ok: false, message: 'يرجى إدخال رابط المشروع (Supabase URL) والمفتاح (Anon Key).' };
  }
  try {
    const supabase = createClient(url.trim(), anonKey.trim(), {
      auth: { persistSession: false },
    });
    const { error } = await supabase.from('employees').select('id').limit(1);
    if (error) {
      return {
        ok: false,
        message: `تم الوصول للسحابة ولكن يلزم تشغيل كود إنشاء الجداول (SQL Schema): ${error.message}`,
      };
    }
    return { ok: true, message: 'الاتصال بالسحابة ناجح والجداول جاهزة للمزامنة الفورية!' };
  } catch (err) {
    return { ok: false, message: `تعذر الاتصال بالسحابة: ${err.message}` };
  }
}

async function uploadLocalProofIfNeeded(supabase, proofUrl, uploadsDir) {
  if (!proofUrl || !proofUrl.startsWith('/uploads/') || !uploadsDir) return proofUrl;
  const fileName = path.basename(proofUrl);
  const fullPath = path.join(uploadsDir, fileName);
  if (!fs.existsSync(fullPath)) return proofUrl;

  try {
    const fileBuffer = fs.readFileSync(fullPath);
    const ext = path.extname(fileName).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const { error } = await supabase.storage
      .from('zayed-proofs')
      .upload(fileName, fileBuffer, { contentType, upsert: true });

    if (error) return proofUrl;

    const { data } = supabase.storage.from('zayed-proofs').getPublicUrl(fileName);
    return data?.publicUrl || proofUrl;
  } catch {
    return proofUrl;
  }
}

export async function deleteCloudRecord(db, tableName, id) {
  if (!id || !tableName) return;
  const cfg = getCloudConfig(db);
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return;
  try {
    const supabase = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false },
    });
    await supabase.from(tableName).delete().eq('id', id);
  } catch {
    // Non-fatal if offline or optional table missing
  }
}

export async function ensureCloudHydratedOnBoot(db, uploadsDir, force = false) {
  const cfg = getCloudConfig(db);
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return false;

  const rt = getRuntime(db);
  const now = Date.now();
  // Re-pull at most once every 15s unless forced or never hydrated
  if (!force && rt.hydratedOnce && now - rt.lastPullMs < 15000) {
    return true;
  }
  if (rt.hydratingPromise) {
    return rt.hydratingPromise;
  }

  rt.hydratingPromise = (async () => {
    try {
      const res = await syncWithCloud(db, uploadsDir);
      if (res.ok) {
        rt.hydratedOnce = true;
        rt.lastPullMs = Date.now();
      }
      return res.ok;
    } catch {
      return false;
    } finally {
      rt.hydratingPromise = null;
    }
  })();

  return rt.hydratingPromise;
}

export function scheduleAutoCloudSync(db, uploadsDir) {
  const cfg = getCloudConfig(db);
  if (!cfg.enabled || !cfg.url || !cfg.anonKey) return null;

  const rt = getRuntime(db);
  if (rt.pushTimer) {
    clearTimeout(rt.pushTimer);
  }

  rt.pushTimer = setTimeout(() => {
    rt.pushTimer = null;
    if (!rt.pushInFlight) {
      rt.pushInFlight = syncWithCloud(db, uploadsDir)
        .catch(() => {})
        .finally(() => {
          rt.pushInFlight = null;
        });
    }
  }, 250);

  // Do not keep Node test event loop alive solely for debounce timer
  if (rt.pushTimer.unref) {
    rt.pushTimer.unref();
  }
  return rt.pushInFlight;
}

export async function syncWithCloud(db, uploadsDir) {
  const cfg = getCloudConfig(db);
  if (!cfg.url || !cfg.anonKey) {
    return { ok: false, message: 'بيانات الربط السحابي غير مكتملة.' };
  }

  try {
    const supabase = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false },
    });

    const stats = { pushed: 0, pulled: 0 };

    // -----------------------------------------------------------------------
    // A. PULL SHARED SETTINGS, POLICIES & SYSTEM USERS FIRST (CRITICAL FOR COLD START)
    // -----------------------------------------------------------------------
    try {
      const { data: remoteSettings } = await supabase.from('settings').select('*');
      if (Array.isArray(remoteSettings) && remoteSettings.length > 0) {
        const safeSharedKeys = new Set([
          'store_name',
          'branch_name',
          'max_break_minutes',
          'max_unload_minutes',
          'session_hmac_secret',
        ]);
        const setStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        for (const s of remoteSettings) {
          if (safeSharedKeys.has(s.key) && s.value) {
            setStmt.run(s.key, s.value);
          }
        }
      }
    } catch {
      // Optional table
    }

    try {
      const { data: remotePolicies } = await supabase.from('role_policies').select('*');
      if (Array.isArray(remotePolicies) && remotePolicies.length > 0) {
        const polStmt = db.prepare(`
          INSERT INTO role_policies (role, permissions_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(role) DO UPDATE SET
            permissions_json = CASE WHEN excluded.updated_at > role_policies.updated_at THEN excluded.permissions_json ELSE role_policies.permissions_json END,
            updated_at = CASE WHEN excluded.updated_at > role_policies.updated_at THEN excluded.updated_at ELSE role_policies.updated_at END
        `);
        for (const p of remotePolicies) {
          polStmt.run(p.role, p.permissions_json || '[]', p.updated_at || new Date().toISOString());
        }
      }
    } catch {
      // Optional table
    }

    try {
      const { data: remoteUsers } = await supabase.from('system_users').select('*');
      if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
        const usrStmt = db.prepare(`
          INSERT INTO system_users (
            id, username, display_name, role, pin_salt, pin_hash, pin_cipher,
            avatar_color, is_active, employee_id, custom_permissions_json, last_login_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            display_name = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.display_name ELSE system_users.display_name END,
            role = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.role ELSE system_users.role END,
            pin_salt = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.pin_salt ELSE system_users.pin_salt END,
            pin_hash = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.pin_hash ELSE system_users.pin_hash END,
            pin_cipher = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.pin_cipher ELSE system_users.pin_cipher END,
            is_active = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.is_active ELSE system_users.is_active END,
            custom_permissions_json = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.custom_permissions_json ELSE system_users.custom_permissions_json END,
            updated_at = CASE WHEN excluded.updated_at > system_users.updated_at THEN excluded.updated_at ELSE system_users.updated_at END
        `);
        for (const u of remoteUsers) {
          try {
            usrStmt.run(
              u.id,
              u.username,
              u.display_name,
              u.role,
              u.pin_salt,
              u.pin_hash,
              u.pin_cipher || '',
              u.avatar_color || '#0B57D0',
              u.is_active ?? 1,
              u.employee_id || '',
              u.custom_permissions_json || '[]',
              u.last_login_at || '',
              u.created_at || new Date().toISOString(),
              u.updated_at || new Date().toISOString()
            );
          } catch {
            // Skip username collision if any
          }
        }
      }
    } catch {
      // Optional table if older schema
    }

    // -----------------------------------------------------------------------
    // B. PUSH LOCAL MASTER & OPERATIONAL TABLES TO SUPABASE
    // -----------------------------------------------------------------------
    const employees = db.prepare('SELECT * FROM employees').all();
    if (employees.length > 0) {
      const { error } = await supabase.from('employees').upsert(employees, { onConflict: 'id' });
      if (!error) stats.pushed += employees.length;
    }

    const suppliers = db.prepare('SELECT * FROM suppliers').all();
    if (suppliers.length > 0) {
      const { error } = await supabase.from('suppliers').upsert(suppliers, { onConflict: 'id' });
      if (!error) stats.pushed += suppliers.length;
    }

    try {
      const sysUsers = db.prepare('SELECT * FROM system_users').all();
      if (sysUsers.length > 0) {
        await supabase.from('system_users').upsert(sysUsers, { onConflict: 'id' });
      }
      const rolePolicies = db.prepare('SELECT * FROM role_policies').all();
      if (rolePolicies.length > 0) {
        await supabase.from('role_policies').upsert(rolePolicies, { onConflict: 'role' });
      }
      const sharedSettings = db
        .prepare(
          "SELECT key, value FROM settings WHERE key IN ('store_name','branch_name','max_break_minutes','max_unload_minutes','session_hmac_secret')"
        )
        .all();
      if (sharedSettings.length > 0) {
        await supabase.from('settings').upsert(sharedSettings, { onConflict: 'key' });
      }
    } catch {
      // Optional if older Supabase schema
    }

    const unsyncedAttendance = db
      .prepare('SELECT * FROM attendance_logs WHERE synced = 0')
      .all();
    if (unsyncedAttendance.length > 0) {
      const payload = [];
      for (const row of unsyncedAttendance) {
        const remoteProof = await uploadLocalProofIfNeeded(supabase, row.proof_url, uploadsDir);
        payload.push({ ...row, proof_url: remoteProof, synced: 1 });
      }
      const { error } = await supabase
        .from('attendance_logs')
        .upsert(payload, { onConflict: 'id' });
      if (!error) {
        const markStmt = db.prepare('UPDATE attendance_logs SET synced = 1 WHERE id = ?');
        for (const r of unsyncedAttendance) markStmt.run(r.id);
        stats.pushed += unsyncedAttendance.length;
      }
    }

    const unsyncedTrucks = db.prepare('SELECT * FROM truck_logs WHERE synced = 0').all();
    if (unsyncedTrucks.length > 0) {
      const payload = [];
      for (const row of unsyncedTrucks) {
        const arrProof = await uploadLocalProofIfNeeded(supabase, row.arrival_proof_url, uploadsDir);
        const compProof = await uploadLocalProofIfNeeded(
          supabase,
          row.completion_proof_url,
          uploadsDir
        );
        payload.push({
          ...row,
          arrival_proof_url: arrProof,
          completion_proof_url: compProof,
          synced: 1,
        });
      }
      const { error } = await supabase.from('truck_logs').upsert(payload, { onConflict: 'id' });
      if (!error) {
        const markStmt = db.prepare('UPDATE truck_logs SET synced = 1 WHERE id = ?');
        for (const r of unsyncedTrucks) markStmt.run(r.id);
        stats.pushed += unsyncedTrucks.length;
      }
    }

    const unsyncedNotes = db.prepare('SELECT * FROM notes WHERE synced = 0').all();
    if (unsyncedNotes.length > 0) {
      const payload = [];
      for (const row of unsyncedNotes) {
        const remoteProof = await uploadLocalProofIfNeeded(supabase, row.proof_url, uploadsDir);
        payload.push({ ...row, proof_url: remoteProof, synced: 1 });
      }
      const { error } = await supabase.from('notes').upsert(payload, { onConflict: 'id' });
      if (!error) {
        const markStmt = db.prepare('UPDATE notes SET synced = 1 WHERE id = ?');
        for (const r of unsyncedNotes) markStmt.run(r.id);
        stats.pushed += unsyncedNotes.length;
      }
    }

    const unsyncedHandovers = db.prepare('SELECT * FROM shift_handovers WHERE synced = 0').all();
    if (unsyncedHandovers.length > 0) {
      const payload = unsyncedHandovers.map((r) => ({ ...r, synced: 1 }));
      const { error } = await supabase
        .from('shift_handovers')
        .upsert(payload, { onConflict: 'id' });
      if (!error) {
        const markStmt = db.prepare('UPDATE shift_handovers SET synced = 1 WHERE id = ?');
        for (const r of unsyncedHandovers) markStmt.run(r.id);
        stats.pushed += unsyncedHandovers.length;
      }
    }

    const catalogItems = db.prepare('SELECT * FROM product_catalog').all();
    if (catalogItems.length > 0) {
      const { error } = await supabase
        .from('product_catalog')
        .upsert(catalogItems, { onConflict: 'id' });
      if (!error) stats.pushed += catalogItems.length;
    }

    const unsyncedShortages = db.prepare('SELECT * FROM shortages WHERE synced = 0').all();
    if (unsyncedShortages.length > 0) {
      const payload = unsyncedShortages.map((r) => ({ ...r, synced: 1 }));
      const { error } = await supabase.from('shortages').upsert(payload, { onConflict: 'id' });
      if (!error) {
        const markStmt = db.prepare('UPDATE shortages SET synced = 1 WHERE id = ?');
        for (const r of unsyncedShortages) markStmt.run(r.id);
        stats.pushed += unsyncedShortages.length;
      }
    }

    try {
      const unsyncedChat = db.prepare('SELECT * FROM team_messages WHERE synced = 0').all();
      if (unsyncedChat.length > 0) {
        const payload = unsyncedChat.map((r) => ({ ...r, synced: 1 }));
        const { error } = await supabase
          .from('team_messages')
          .upsert(payload, { onConflict: 'id' });
        if (!error) {
          const markStmt = db.prepare('UPDATE team_messages SET synced = 1 WHERE id = ?');
          for (const r of unsyncedChat) markStmt.run(r.id);
          stats.pushed += unsyncedChat.length;
        }
      }
    } catch {
      // Optional table
    }

    try {
      const unsyncedWalkie = db
        .prepare('SELECT * FROM walkie_calls WHERE synced = 0 ORDER BY timestamp DESC LIMIT 20')
        .all();
      if (unsyncedWalkie.length > 0) {
        const payload = unsyncedWalkie.map((r) => ({ ...r, synced: 1 }));
        const { error } = await supabase
          .from('walkie_calls')
          .upsert(payload, { onConflict: 'id' });
        if (!error) {
          const markStmt = db.prepare('UPDATE walkie_calls SET synced = 1 WHERE id = ?');
          for (const r of unsyncedWalkie) markStmt.run(r.id);
          stats.pushed += unsyncedWalkie.length;
        }
      }
    } catch {
      // Optional table if older schema
    }

    // -----------------------------------------------------------------------
    // C. PULL REMOTE UPDATES FROM SUPABASE INTO LOCAL SQLITE
    // -----------------------------------------------------------------------
    const { data: remoteEmps } = await supabase.from('employees').select('*');
    if (Array.isArray(remoteEmps)) {
      const upsertEmp = db.prepare(`
        INSERT INTO employees (
          id, emp_code, name, department, role_title, system_role, login_enabled,
          shift_start, shift_end, avatar_color, phone, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          emp_code = CASE WHEN excluded.updated_at > employees.updated_at AND excluded.emp_code != '' THEN excluded.emp_code ELSE employees.emp_code END,
          name = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.name ELSE employees.name END,
          department = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.department ELSE employees.department END,
          role_title = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.role_title ELSE employees.role_title END,
          system_role = CASE WHEN excluded.updated_at > employees.updated_at AND excluded.system_role != '' THEN excluded.system_role ELSE employees.system_role END,
          login_enabled = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.login_enabled ELSE employees.login_enabled END,
          shift_start = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.shift_start ELSE employees.shift_start END,
          shift_end = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.shift_end ELSE employees.shift_end END,
          avatar_color = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.avatar_color ELSE employees.avatar_color END,
          phone = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.phone ELSE employees.phone END,
          is_active = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.is_active ELSE employees.is_active END,
          updated_at = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.updated_at ELSE employees.updated_at END
      `);
      for (const e of remoteEmps) {
        const res = upsertEmp.run(
          e.id,
          e.emp_code || '',
          e.name,
          e.department,
          e.role_title || '',
          e.system_role || '',
          e.login_enabled ?? 1,
          e.shift_start || '08:00',
          e.shift_end || '20:00',
          e.avatar_color || '#1A73E8',
          e.phone || '',
          e.is_active ?? 1,
          e.updated_at || new Date().toISOString()
        );
        if (res.changes > 0) stats.pulled += 1;
        const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(e.id);
        if (empRow) {
          syncEmployeeLoginAccount(db, empRow);
        }
      }
    }

    const { data: remoteSups } = await supabase.from('suppliers').select('*');
    if (Array.isArray(remoteSups)) {
      const upsertSup = db.prepare(`
        INSERT INTO suppliers (id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.name ELSE suppliers.name END,
          category = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.category ELSE suppliers.category END,
          has_pending_return = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.has_pending_return ELSE suppliers.has_pending_return END,
          pending_return_note = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.pending_return_note ELSE suppliers.pending_return_note END,
          phone = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.phone ELSE suppliers.phone END,
          is_active = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.is_active ELSE suppliers.is_active END,
          updated_at = CASE WHEN excluded.updated_at > suppliers.updated_at THEN excluded.updated_at ELSE suppliers.updated_at END
      `);
      for (const s of remoteSups) {
        upsertSup.run(
          s.id,
          s.name,
          s.category || 'بقالة جافة',
          s.icon || 'local_shipping',
          s.color || '#1A73E8',
          s.has_pending_return ? 1 : 0,
          s.pending_return_note || '',
          s.phone || '',
          s.is_active ?? 1,
          s.updated_at || new Date().toISOString()
        );
      }
    }

    const { data: remoteAtt } = await supabase
      .from('attendance_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(500);
    if (Array.isArray(remoteAtt)) {
      const upsertAtt = db.prepare(`
        INSERT OR IGNORE INTO attendance_logs (
          id, employee_id, employee_name, department, action_type, timestamp, date_key, shift_date_key,
          late_minutes, allowed_break_minutes, break_duration_minutes, break_reason,
          note, proof_url, recorded_by, verified_by_cctv, verified_at, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      for (const a of remoteAtt) {
        const res = upsertAtt.run(
          a.id,
          a.employee_id,
          a.employee_name,
          a.department,
          a.action_type,
          a.timestamp,
          a.date_key,
          a.shift_date_key || a.date_key,
          a.late_minutes || 0,
          a.allowed_break_minutes || 0,
          a.break_duration_minutes || 0,
          a.break_reason || '',
          a.note || '',
          a.proof_url || '',
          a.recorded_by || 'الأمن',
          a.verified_by_cctv ? 1 : 0,
          a.verified_at || ''
        );
        if (res.changes > 0) stats.pulled += 1;
      }
    }

    const { data: remoteTrucks } = await supabase
      .from('truck_logs')
      .select('*')
      .order('arrival_time', { ascending: false })
      .limit(200);
    if (Array.isArray(remoteTrucks)) {
      const upsertTruck = db.prepare(`
        INSERT INTO truck_logs (
          id, supplier_id, supplier_name, category, plate_or_driver, status, arrival_time,
          departure_time, duration_minutes, date_key, delivery_condition, invoice_number,
          notes, arrival_proof_url, completion_proof_url, recorded_by, verified_by_cctv, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          departure_time = CASE WHEN excluded.departure_time != '' THEN excluded.departure_time ELSE truck_logs.departure_time END,
          duration_minutes = CASE WHEN excluded.duration_minutes > 0 THEN excluded.duration_minutes ELSE truck_logs.duration_minutes END,
          delivery_condition = excluded.delivery_condition,
          notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE truck_logs.notes END,
          verified_by_cctv = CASE WHEN excluded.verified_by_cctv = 1 THEN 1 ELSE truck_logs.verified_by_cctv END
      `);
      for (const t of remoteTrucks) {
        upsertTruck.run(
          t.id,
          t.supplier_id || '',
          t.supplier_name,
          t.category || 'بقالة جافة',
          t.plate_or_driver || '',
          t.status || 'unloading',
          t.arrival_time,
          t.departure_time || '',
          t.duration_minutes || 0,
          t.date_key,
          t.delivery_condition || 'pending',
          t.invoice_number || '',
          t.notes || '',
          t.arrival_proof_url || '',
          t.completion_proof_url || '',
          t.recorded_by || 'الأمن',
          t.verified_by_cctv ? 1 : 0
        );
      }
    }

    const { data: remoteNotes } = await supabase
      .from('notes')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(250);
    if (Array.isArray(remoteNotes)) {
      const insertNote = db.prepare(`
        INSERT INTO notes (
          id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
          recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          is_open_handover = excluded.is_open_handover,
          resolved_by = excluded.resolved_by,
          resolved_at = excluded.resolved_at,
          content = excluded.content
      `);
      for (const n of remoteNotes) {
        const res = insertNote.run(
          n.id,
          n.location_tag,
          n.category_tag,
          n.severity || 'normal',
          n.dvr_timestamp || '00:00:00',
          n.content,
          n.proof_url || '',
          n.recorded_by || 'الإدارة',
          n.is_open_handover ? 1 : 0,
          n.resolved_by || '',
          n.resolved_at || '',
          n.timestamp,
          n.date_key
        );
        if (res.changes > 0) stats.pulled += 1;
      }
    }

    const { data: remoteShortages } = await supabase
      .from('shortages')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(350);
    if (Array.isArray(remoteShortages)) {
      const upsertShortage = db.prepare(`
        INSERT INTO shortages (
          id, product_id, item_name, category, requested_qty, unit, urgency, status, is_suggestion,
          supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
          resolved_by, resolved_at, timestamp, updated_at, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          item_name = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.item_name ELSE shortages.item_name END,
          category = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.category ELSE shortages.category END,
          requested_qty = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.requested_qty ELSE shortages.requested_qty END,
          unit = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.unit ELSE shortages.unit END,
          urgency = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.urgency ELSE shortages.urgency END,
          status = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.status ELSE shortages.status END,
          is_suggestion = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.is_suggestion ELSE shortages.is_suggestion END,
          notes = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.notes ELSE shortages.notes END,
          updated_by = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.updated_by ELSE shortages.updated_by END,
          resolved_by = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.resolved_by ELSE shortages.resolved_by END,
          resolved_at = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.resolved_at ELSE shortages.resolved_at END,
          updated_at = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.updated_at ELSE shortages.updated_at END
      `);
      for (const s of remoteShortages) {
        const qtyVal =
          s.requested_qty === null || s.requested_qty === undefined || s.requested_qty === ''
            ? null
            : Number(s.requested_qty);
        const res = upsertShortage.run(
          s.id,
          s.product_id || '',
          s.item_name,
          s.category || 'بقالة جافة',
          qtyVal,
          s.unit || '',
          s.urgency || 'out_of_stock',
          s.status || 'open',
          s.is_suggestion ? 1 : 0,
          s.supplier_id || '',
          s.supplier_name || '',
          s.notes || '',
          s.recorded_by || 'عمال الصالة',
          s.recorded_by_role || '',
          s.updated_by || '',
          s.resolved_by || '',
          s.resolved_at || '',
          s.timestamp || new Date().toISOString(),
          s.updated_at || s.timestamp || new Date().toISOString(),
          s.date_key || new Date().toISOString().slice(0, 10)
        );
        if (res.changes > 0) stats.pulled += 1;
      }
    }

    try {
      const { data: remoteChat } = await supabase
        .from('team_messages')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(150);
      if (Array.isArray(remoteChat)) {
        const upsertChat = db.prepare(`
          INSERT INTO team_messages (
            id, channel, sender_id, sender_name, sender_role, content, is_urgent, is_pinned, timestamp, date_key, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            is_pinned = excluded.is_pinned
        `);
        for (const m of remoteChat) {
          upsertChat.run(
            m.id,
            m.channel || 'general',
            m.sender_id || '',
            m.sender_name || 'النظام',
            m.sender_role || '',
            m.content || '',
            m.is_urgent ? 1 : 0,
            m.is_pinned ? 1 : 0,
            m.timestamp || new Date().toISOString(),
            m.date_key || new Date().toISOString().slice(0, 10)
          );
        }
      }
    } catch {
      // Optional table
    }

    try {
      const cutoffIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: remoteWalkie } = await supabase
        .from('walkie_calls')
        .select('*')
        .gte('timestamp', cutoffIso)
        .order('timestamp', { ascending: false })
        .limit(30);
      if (Array.isArray(remoteWalkie)) {
        const upsertWalkie = db.prepare(`
          INSERT OR IGNORE INTO walkie_calls (
            id, channel, kind, sender_id, sender_name, sender_role,
            audio_data, mime_type, duration_sec, is_emergency, timestamp, date_key, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);
        for (const w of remoteWalkie) {
          const res = upsertWalkie.run(
            w.id,
            w.channel || 'security',
            w.kind || 'voice',
            w.sender_id || '',
            w.sender_name || 'الأمن',
            w.sender_role || 'security',
            w.audio_data || '',
            w.mime_type || 'audio/webm',
            Number(w.duration_sec) || 0,
            w.is_emergency ? 1 : 0,
            w.timestamp || new Date().toISOString(),
            w.date_key || new Date().toISOString().slice(0, 10)
          );
          if (res.changes > 0) stats.pulled += 1;
        }
      }
    } catch {
      // Optional table
    }

    const syncTime = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'last_cloud_sync',
      syncTime
    );

    return {
      ok: true,
      syncedAt: syncTime,
      stats,
      message: `تمت المزامنة السحابية بنجاح (تم رفع ${stats.pushed} سجل واستقبال ${stats.pulled} جديد).`,
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export function exportFullBackup(db) {
  const backup = {
    app: 'zayed-mart-ops',
    version: '3.6.0',
    exportedAt: new Date().toISOString(),
    tables: {},
  };
  for (const tbl of SYNC_TABLES) {
    backup.tables[tbl] = db.prepare(`SELECT * FROM ${tbl}`).all();
  }
  return backup;
}

export function importFullBackup(db, payload) {
  if (!payload || !payload.tables) {
    throw new Error('ملف النسخة الاحتياطية غير صالح.');
  }
  const tables = payload.tables;

  if (Array.isArray(tables.employees)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO employees (
        id, emp_code, name, department, role_title, system_role, login_enabled,
        shift_start, shift_end, avatar_color, phone, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.employees) {
      stmt.run(
        r.id,
        r.emp_code || '',
        r.name,
        r.department,
        r.role_title || '',
        r.system_role || '',
        r.login_enabled ?? 1,
        r.shift_start || '08:00',
        r.shift_end || '20:00',
        r.avatar_color || '#1A73E8',
        r.phone || '',
        r.is_active ?? 1,
        r.updated_at || new Date().toISOString()
      );
      const empRow = db.prepare('SELECT * FROM employees WHERE id = ?').get(r.id);
      if (empRow) {
        syncEmployeeLoginAccount(db, empRow);
      }
    }
  }

  if (Array.isArray(tables.suppliers)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO suppliers (id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.suppliers) {
      stmt.run(
        r.id,
        r.name,
        r.category,
        r.icon || 'local_shipping',
        r.color || '#1A73E8',
        r.has_pending_return ? 1 : 0,
        r.pending_return_note || '',
        r.phone || '',
        r.is_active ?? 1,
        r.updated_at || new Date().toISOString()
      );
    }
  }

  if (Array.isArray(tables.attendance_logs)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO attendance_logs (
        id, employee_id, employee_name, department, action_type, timestamp, date_key, shift_date_key,
        late_minutes, allowed_break_minutes, break_duration_minutes, break_reason,
        note, proof_url, recorded_by, verified_by_cctv, verified_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.attendance_logs) {
      stmt.run(
        r.id,
        r.employee_id,
        r.employee_name,
        r.department,
        r.action_type,
        r.timestamp,
        r.date_key,
        r.shift_date_key || r.date_key,
        r.late_minutes || 0,
        r.allowed_break_minutes || 0,
        r.break_duration_minutes || 0,
        r.break_reason || '',
        r.note || '',
        r.proof_url || '',
        r.recorded_by || 'الأمن',
        r.verified_by_cctv ? 1 : 0,
        r.verified_at || '',
        r.synced ? 1 : 0
      );
    }
  }

  if (Array.isArray(tables.truck_logs)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO truck_logs (
        id, supplier_id, supplier_name, category, plate_or_driver, status, arrival_time,
        departure_time, duration_minutes, date_key, delivery_condition, invoice_number,
        notes, arrival_proof_url, completion_proof_url, recorded_by, verified_by_cctv, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.truck_logs) {
      stmt.run(
        r.id,
        r.supplier_id || '',
        r.supplier_name,
        r.category,
        r.plate_or_driver || '',
        r.status,
        r.arrival_time,
        r.departure_time || '',
        r.duration_minutes || 0,
        r.date_key,
        r.delivery_condition || 'pending',
        r.invoice_number || '',
        r.notes || '',
        r.arrival_proof_url || '',
        r.completion_proof_url || '',
        r.recorded_by || 'الأمن',
        r.verified_by_cctv ? 1 : 0,
        r.synced ? 1 : 0
      );
    }
  }

  if (Array.isArray(tables.notes)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO notes (
        id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
        recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.notes) {
      stmt.run(
        r.id,
        r.location_tag,
        r.category_tag,
        r.severity || 'normal',
        r.dvr_timestamp || '00:00:00',
        r.content,
        r.proof_url || '',
        r.recorded_by || 'مراقب الكاميرات',
        r.is_open_handover ? 1 : 0,
        r.resolved_by || '',
        r.resolved_at || '',
        r.timestamp,
        r.date_key,
        r.synced ? 1 : 0
      );
    }
  }

  if (Array.isArray(tables.shift_handovers)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO shift_handovers (
        id, from_operator, to_operator, from_role, target_role, shift_name, summary_note, open_items_json,
        open_trucks_count, open_notes_count, present_staff_count, acknowledged, acknowledged_at, timestamp, date_key, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.shift_handovers) {
      stmt.run(
        r.id,
        r.from_operator,
        r.to_operator,
        r.from_role || '',
        r.target_role || '',
        r.shift_name,
        r.summary_note || '',
        r.open_items_json || '[]',
        r.open_trucks_count || 0,
        r.open_notes_count || 0,
        r.present_staff_count || 0,
        r.acknowledged ?? 1,
        r.acknowledged_at || '',
        r.timestamp,
        r.date_key,
        r.synced ? 1 : 0
      );
    }
  }

  if (Array.isArray(tables.product_catalog)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO product_catalog (
        id, name, category, default_unit, supplier_id, usage_count, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.product_catalog) {
      stmt.run(
        r.id,
        r.name,
        r.category || 'بقالة جافة',
        r.default_unit || '',
        r.supplier_id || '',
        r.usage_count || 1,
        r.is_active ?? 1,
        r.updated_at || new Date().toISOString()
      );
    }
  }

  if (Array.isArray(tables.shortages)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO shortages (
        id, product_id, item_name, category, requested_qty, unit, urgency, status, is_suggestion,
        supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
        resolved_by, resolved_at, timestamp, updated_at, date_key, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.shortages) {
      const qtyVal =
        r.requested_qty === null || r.requested_qty === undefined || r.requested_qty === ''
          ? null
          : Number(r.requested_qty);
      stmt.run(
        r.id,
        r.product_id || '',
        r.item_name,
        r.category || 'بقالة جافة',
        qtyVal,
        r.unit || '',
        r.urgency || 'out_of_stock',
        r.status || 'open',
        r.is_suggestion ? 1 : 0,
        r.supplier_id || '',
        r.supplier_name || '',
        r.notes || '',
        r.recorded_by || 'عمال الصالة',
        r.recorded_by_role || '',
        r.updated_by || '',
        r.resolved_by || '',
        r.resolved_at || '',
        r.timestamp || new Date().toISOString(),
        r.updated_at || r.timestamp || new Date().toISOString(),
        r.date_key || new Date().toISOString().slice(0, 10),
        r.synced ? 1 : 0
      );
    }
  }

  if (Array.isArray(tables.team_messages)) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO team_messages (
        id, channel, sender_id, sender_name, sender_role, content, is_urgent, is_pinned, timestamp, date_key, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.team_messages) {
      stmt.run(
        r.id,
        r.channel || 'general',
        r.sender_id || '',
        r.sender_name || 'النظام',
        r.sender_role || '',
        r.content || r.message || '',
        r.is_urgent ? 1 : 0,
        r.is_pinned ? 1 : 0,
        r.timestamp || new Date().toISOString(),
        r.date_key || new Date().toISOString().slice(0, 10),
        r.synced ? 1 : 0
      );
    }
  }
}

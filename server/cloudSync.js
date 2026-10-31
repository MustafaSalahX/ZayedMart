import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const SYNC_TABLES = [
  'employees',
  'suppliers',
  'product_catalog',
  'attendance_logs',
  'truck_logs',
  'shortages',
  'notes',
  'shift_handovers',
];

export function getCloudConfig(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    url: (map.supabase_url || '').trim(),
    anonKey: (map.supabase_anon_key || '').trim(),
    enabled: map.cloud_sync_enabled === 'true',
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
  if (!proofUrl || !proofUrl.startsWith('/uploads/')) return proofUrl;
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

    const employees = db.prepare('SELECT * FROM employees').all();
    if (employees.length > 0) {
      const { error } = await supabase.from('employees').upsert(employees, { onConflict: 'id' });
      if (error) throw new Error(`خطأ مزامنة الموظفين: ${error.message}`);
      stats.pushed += employees.length;
    }

    const suppliers = db.prepare('SELECT * FROM suppliers').all();
    if (suppliers.length > 0) {
      const { error } = await supabase.from('suppliers').upsert(suppliers, { onConflict: 'id' });
      if (error) throw new Error(`خطأ مزامنة الموردين: ${error.message}`);
      stats.pushed += suppliers.length;
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
      if (!error) {
        stats.pushed += catalogItems.length;
      }
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

    const { data: remoteEmps } = await supabase.from('employees').select('*');
    if (Array.isArray(remoteEmps)) {
      const upsertEmp = db.prepare(`
        INSERT INTO employees (id, emp_code, name, department, role_title, shift_start, shift_end, avatar_color, phone, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          emp_code = CASE WHEN excluded.updated_at > employees.updated_at AND excluded.emp_code != '' THEN excluded.emp_code ELSE employees.emp_code END,
          name = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.name ELSE employees.name END,
          department = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.department ELSE employees.department END,
          role_title = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.role_title ELSE employees.role_title END,
          shift_start = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.shift_start ELSE employees.shift_start END,
          shift_end = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.shift_end ELSE employees.shift_end END,
          avatar_color = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.avatar_color ELSE employees.avatar_color END,
          phone = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.phone ELSE employees.phone END,
          is_active = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.is_active ELSE employees.is_active END,
          updated_at = CASE WHEN excluded.updated_at > employees.updated_at THEN excluded.updated_at ELSE employees.updated_at END
      `);
      for (const e of remoteEmps) {
        upsertEmp.run(
          e.id,
          e.emp_code || '',
          e.name,
          e.department,
          e.role_title || '',
          e.shift_start || '08:00',
          e.shift_end || '17:00',
          e.avatar_color || '#1A73E8',
          e.phone || '',
          e.is_active ?? 1,
          e.updated_at || new Date().toISOString()
        );
      }
    }

    const { data: remoteNotes } = await supabase
      .from('notes')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(200);
    if (Array.isArray(remoteNotes)) {
      const insertNote = db.prepare(`
        INSERT OR IGNORE INTO notes (
          id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
          recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
      .limit(300);
    if (Array.isArray(remoteShortages)) {
      const upsertShortage = db.prepare(`
        INSERT INTO shortages (
          id, product_id, item_name, category, requested_qty, unit, urgency, status,
          supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
          resolved_by, resolved_at, timestamp, updated_at, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          item_name = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.item_name ELSE shortages.item_name END,
          category = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.category ELSE shortages.category END,
          requested_qty = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.requested_qty ELSE shortages.requested_qty END,
          unit = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.unit ELSE shortages.unit END,
          urgency = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.urgency ELSE shortages.urgency END,
          status = CASE WHEN excluded.updated_at > shortages.updated_at THEN excluded.status ELSE shortages.status END,
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
    version: '2.0.0',
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
      INSERT OR REPLACE INTO employees (id, emp_code, name, department, role_title, shift_start, shift_end, avatar_color, phone, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.employees) {
      stmt.run(
        r.id,
        r.emp_code || '',
        r.name,
        r.department,
        r.role_title || '',
        r.shift_start || '08:00',
        r.shift_end || '17:00',
        r.avatar_color || '#1A73E8',
        r.phone || '',
        r.is_active ?? 1,
        r.updated_at || new Date().toISOString()
      );
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
        id, employee_id, employee_name, department, action_type, timestamp, date_key,
        late_minutes, note, proof_url, recorded_by, verified_by_cctv, verified_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        r.late_minutes || 0,
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
        id, from_operator, to_operator, shift_name, summary_note, open_items_json,
        open_trucks_count, open_notes_count, present_staff_count, acknowledged, acknowledged_at, timestamp, date_key, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of tables.shift_handovers) {
      stmt.run(
        r.id,
        r.from_operator,
        r.to_operator,
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
        id, product_id, item_name, category, requested_qty, unit, urgency, status,
        supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
        resolved_by, resolved_at, timestamp, updated_at, date_key, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
}

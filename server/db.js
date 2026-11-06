import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES_METADATA,
  hashPin,
  verifyPinHash,
  encryptPasswordForAdmin,
  normalizeDigits,
} from './rbac.js';
import { seedInitialStoreData, deterministicSaltHex, purgeLegacyFakeSeedData } from './seedData.js';

export function deterministicUuidFromSeed(seedStr) {
  const hash = crypto.createHash('sha256').update(String(seedStr)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function resolveWritableDataDir(subDir = '') {
  const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!isServerless) {
    try {
      const localDir = subDir
        ? path.resolve(process.cwd(), 'data', subDir)
        : path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      fs.accessSync(localDir, fs.constants.W_OK);
      return localDir;
    } catch {
      // Fall back to os.tmpdir() if local directory is read-only
    }
  }
  const tmpBase = path.join(os.tmpdir(), 'zayed-mart-data');
  const targetDir = subDir ? path.join(tmpBase, subDir) : tmpBase;
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

export function inferDefaultRoleFromDepartment(department = '', roleTitle = '') {
  const dept = String(department || '').trim();
  const title = String(roleTitle || '').trim();
  if (title.includes('كاميرات') || dept.includes('كاميرات')) return 'cctv';
  if (dept === 'نظافة' || title.includes('نظافة')) return 'none';
  if (dept.includes('أمن') || title.includes('أمن') || title.includes('حارس')) return 'security';
  if (dept === 'المدير' || title.includes('مدير')) return 'manager';
  if (dept.includes('إدارة') || dept.includes('مشرف') || title.includes('مشرف')) return 'supervisor';
  if (dept.includes('كاشير') || title.includes('كاشير')) return 'cashier';
  if (dept.includes('مخزن') || title.includes('مخزن')) return 'warehouse';
  if (dept.includes('دليفري') || title.includes('دليفري') || title.includes('توصيل') || title.includes('طيار')) return 'delivery';
  return 'hall';
}

export function syncEmployeeLoginAccount(db, emp, options = {}) {
  if (!emp || !emp.id) return null;
  const secretHex =
    db.prepare("SELECT value FROM settings WHERE key = 'session_hmac_secret'").get()?.value || '';
  const nowIso = new Date().toISOString();

  const validRoles = new Set([...Object.keys(ROLES_METADATA), 'none']);
  const explicitRole = String(options.system_role ?? emp.system_role ?? '').trim();
  const resolvedRole = validRoles.has(explicitRole)
    ? explicitRole
    : inferDefaultRoleFromDepartment(emp.department, emp.role_title);

  const loginEnabled =
    options.login_enabled !== undefined
      ? options.login_enabled
        ? 1
        : 0
      : emp.login_enabled !== undefined && emp.login_enabled !== null
      ? Number(emp.login_enabled)
      : 1;

  if (emp.system_role !== resolvedRole || emp.login_enabled !== loginEnabled) {
    db.prepare(
      'UPDATE employees SET system_role = ?, login_enabled = ? WHERE id = ?'
    ).run(resolvedRole, loginEnabled, emp.id);
  }

  const existingLinked = db
    .prepare('SELECT * FROM system_users WHERE employee_id = ? LIMIT 1')
    .get(emp.id);

  if (!emp.is_active || !loginEnabled || resolvedRole === 'none') {
    if (existingLinked) {
      db.prepare('UPDATE system_users SET is_active = 0, updated_at = ? WHERE id = ?').run(
        nowIso,
        existingLinked.id
      );
      db.prepare('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?').run(existingLinked.id);
    }
    return null;
  }

  const rawPass = normalizeDigits(
    String(options.password ?? emp.emp_code ?? '').trim()
  );

  // Check if another active user already has this password
  function hasPasswordConflict(candidatePass, excludeUserId = '') {
    if (!candidatePass) return true;
    const others = db
      .prepare('SELECT id, pin_salt, pin_hash FROM system_users WHERE id != ? AND is_active = 1')
      .all(excludeUserId);
    for (const u of others) {
      if (verifyPinHash(candidatePass, u.pin_salt, u.pin_hash)) {
        return true;
      }
    }
    return false;
  }

  if (existingLinked) {
    let saltHex = existingLinked.pin_salt;
    let hashHex = existingLinked.pin_hash;
    let cipher = existingLinked.pin_cipher || '';

    if (options.updatePassword && rawPass && !hasPasswordConflict(rawPass, existingLinked.id)) {
      const hashed = hashPin(rawPass);
      saltHex = hashed.saltHex;
      hashHex = hashed.hashHex;
      cipher = encryptPasswordForAdmin(rawPass, secretHex);
    }

    db.prepare(
      `UPDATE system_users
       SET display_name = ?, role = ?, pin_salt = ?, pin_hash = ?, pin_cipher = ?, avatar_color = ?, is_active = 1, updated_at = ?
       WHERE id = ?`
    ).run(
      emp.name.trim(),
      resolvedRole,
      saltHex,
      hashHex,
      cipher,
      emp.avatar_color || '#0B57D0',
      nowIso,
      existingLinked.id
    );
    return db.prepare('SELECT * FROM system_users WHERE id = ?').get(existingLinked.id);
  }

  // Create a new linked system_users row if password is valid and non-conflicting
  let finalPass = rawPass;
  if (!finalPass || hasPasswordConflict(finalPass)) {
    // Generate a unique 4-digit private password if emp_code is empty or conflicts
    for (let attempt = 0; attempt < 50; attempt++) {
      const candidate = String(1000 + Math.floor(Math.random() * 8999));
      if (!hasPasswordConflict(candidate)) {
        finalPass = candidate;
        break;
      }
    }
    if (!finalPass || hasPasswordConflict(finalPass)) {
      return null;
    }
  }

  const saltSeed = deterministicSaltHex(`emp-user:${emp.id}:${finalPass}`);
  const { saltHex, hashHex } = hashPin(finalPass, saltSeed);
  const cipher = encryptPasswordForAdmin(finalPass, secretHex);
  const candidateUserId = deterministicUuidFromSeed(`emp-user:${emp.id}`);
  const idCollision = db
    .prepare('SELECT id FROM system_users WHERE id = ?')
    .get(candidateUserId);
  const newUserId = idCollision ? crypto.randomUUID() : candidateUserId;
  const baseUsername = `emp_${finalPass.replace(/[^a-z0-9]/gi, '') || emp.id.slice(0, 6)}`;
  const usernameExists = db
    .prepare('SELECT id FROM system_users WHERE username = ?')
    .get(baseUsername);
  const finalUsername = usernameExists
    ? `${baseUsername}_${crypto.randomBytes(2).toString('hex')}`
    : baseUsername;

  db.prepare(
    `INSERT INTO system_users (
      id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, employee_id, custom_permissions_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '[]', ?, ?)`
  ).run(
    newUserId,
    finalUsername,
    emp.name.trim(),
    resolvedRole,
    saltHex,
    hashHex,
    cipher,
    emp.avatar_color || '#0B57D0',
    emp.id,
    nowIso,
    nowIso
  );

  return db.prepare('SELECT * FROM system_users WHERE id = ?').get(newUserId);
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPreviousDateKey(dateKeyStr) {
  if (!dateKeyStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateKeyStr)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateKey(d);
  }
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return getLocalDateKey(prev);
}

export function getNextDateKey(dateKeyStr) {
  if (!dateKeyStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateKeyStr)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getLocalDateKey(d);
  }
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return getLocalDateKey(next);
}

export function getLocalTimeHMS(date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

export function computeLateMinutes(shiftStart, checkInDate = new Date()) {
  if (!shiftStart || !/^\d{2}:\d{2}$/.test(shiftStart)) return 0;
  const [sh, sm] = shiftStart.split(':').map(Number);
  const scheduled = new Date(checkInDate);
  scheduled.setHours(sh, sm, 0, 0);
  // If shift starts in the evening (e.g. 20:00) and check-in is slightly after midnight (e.g. 00:30),
  // scheduled was the previous evening
  if (sh >= 18 && checkInDate.getHours() < 6) {
    scheduled.setDate(scheduled.getDate() - 1);
  }
  const diffMin = Math.floor((checkInDate.getTime() - scheduled.getTime()) / 60000);
  // Ignore if check-in is more than 10 hours before scheduled start
  if (diffMin < -600) return 0;
  return diffMin > 10 ? diffMin : 0;
}

function safeAddColumn(db, tableName, columnDef) {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
  } catch {
    // Column already exists
  }
}

export function createStoreDatabase(customDbPath, options = {}) {
  const isMemory = customDbPath === ':memory:';
  const dataDir = isMemory
    ? ''
    : customDbPath
    ? path.dirname(customDbPath)
    : resolveWritableDataDir();

  if (!isMemory && dataDir && !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = customDbPath || path.join(dataDir, 'zayed_mart.db');
  const db = new DatabaseSync(dbPath);

  if (!isMemory) {
    const isServerless = Boolean(
      process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
    );
    try {
      db.exec(isServerless ? 'PRAGMA journal_mode = DELETE;' : 'PRAGMA journal_mode = WAL;');
    } catch {
      // Fallback if journal_mode cannot be changed on the underlying filesystem
    }
  }
  db.exec('PRAGMA foreign_keys = OFF;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_users (
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

    CREATE TABLE IF NOT EXISTS role_policies (
      role TEXT PRIMARY KEY,
      permissions_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id, revoked);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      user_name TEXT NOT NULL,
      role TEXT DEFAULT '',
      action TEXT NOT NULL,
      details TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      severity TEXT DEFAULT 'info',
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(timestamp DESC);

    CREATE TABLE IF NOT EXISTS employees (
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

    CREATE TABLE IF NOT EXISTS attendance_logs (
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
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(date_key);
    CREATE INDEX IF NOT EXISTS idx_attendance_emp ON attendance_logs(employee_id, timestamp);

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      icon TEXT DEFAULT 'local_shipping',
      color TEXT DEFAULT '#0B57D0',
      has_pending_return INTEGER DEFAULT 0,
      pending_return_note TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS truck_logs (
      id TEXT PRIMARY KEY,
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT NOT NULL,
      category TEXT NOT NULL,
      plate_or_driver TEXT DEFAULT '',
      status TEXT NOT NULL,
      arrival_time TEXT NOT NULL,
      departure_time TEXT DEFAULT '',
      duration_minutes INTEGER DEFAULT 0,
      date_key TEXT NOT NULL,
      delivery_condition TEXT DEFAULT 'pending',
      invoice_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      arrival_proof_url TEXT DEFAULT '',
      completion_proof_url TEXT DEFAULT '',
      recorded_by TEXT NOT NULL,
      verified_by_cctv INTEGER DEFAULT 0,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_trucks_date ON truck_logs(date_key);
    CREATE INDEX IF NOT EXISTS idx_trucks_status ON truck_logs(status);

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      location_tag TEXT NOT NULL,
      category_tag TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'normal',
      dvr_timestamp TEXT NOT NULL,
      content TEXT NOT NULL,
      proof_url TEXT DEFAULT '',
      recorded_by TEXT NOT NULL,
      is_open_handover INTEGER DEFAULT 0,
      resolved_by TEXT DEFAULT '',
      resolved_at TEXT DEFAULT '',
      timestamp TEXT NOT NULL,
      date_key TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date_key);

    CREATE TABLE IF NOT EXISTS shift_handovers (
      id TEXT PRIMARY KEY,
      from_operator TEXT NOT NULL,
      to_operator TEXT NOT NULL,
      shift_name TEXT NOT NULL,
      summary_note TEXT DEFAULT '',
      open_items_json TEXT DEFAULT '[]',
      open_trucks_count INTEGER DEFAULT 0,
      open_notes_count INTEGER DEFAULT 0,
      present_staff_count INTEGER DEFAULT 0,
      acknowledged INTEGER DEFAULT 0,
      acknowledged_at TEXT DEFAULT '',
      from_role TEXT DEFAULT '',
      target_role TEXT DEFAULT '',
      timestamp TEXT NOT NULL,
      date_key TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_catalog (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'بقالة جافة',
      default_unit TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      usage_count INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_catalog_cat ON product_catalog(category, is_active);

    CREATE TABLE IF NOT EXISTS shortages (
      id TEXT PRIMARY KEY,
      product_id TEXT DEFAULT '',
      item_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'بقالة جافة',
      requested_qty REAL DEFAULT NULL,
      unit TEXT DEFAULT '',
      urgency TEXT NOT NULL DEFAULT 'out_of_stock',
      status TEXT NOT NULL DEFAULT 'open',
      is_suggestion INTEGER DEFAULT 0,
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      recorded_by TEXT NOT NULL,
      recorded_by_role TEXT DEFAULT '',
      updated_by TEXT DEFAULT '',
      resolved_by TEXT DEFAULT '',
      resolved_at TEXT DEFAULT '',
      timestamp TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      date_key TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_shortages_date ON shortages(date_key);
    CREATE INDEX IF NOT EXISTS idx_shortages_status ON shortages(status);

    CREATE TABLE IF NOT EXISTS team_messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'general',
      sender_id TEXT DEFAULT '',
      sender_name TEXT NOT NULL,
      sender_role TEXT DEFAULT '',
      content TEXT NOT NULL,
      is_urgent INTEGER DEFAULT 0,
      is_pinned INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      date_key TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_team_messages_date ON team_messages(date_key, channel);

    CREATE TABLE IF NOT EXISTS walkie_calls (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'security',
      kind TEXT NOT NULL DEFAULT 'voice',
      sender_id TEXT DEFAULT '',
      sender_name TEXT NOT NULL,
      sender_role TEXT DEFAULT '',
      audio_data TEXT DEFAULT '',
      mime_type TEXT DEFAULT 'audio/webm',
      duration_sec REAL DEFAULT 0,
      is_emergency INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      date_key TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_walkie_channel_time ON walkie_calls(channel, timestamp DESC);
  `);

  safeAddColumn(db, 'system_users', "pin_cipher TEXT DEFAULT ''");
  safeAddColumn(db, 'system_users', "employee_id TEXT DEFAULT ''");
  safeAddColumn(db, 'system_users', "custom_permissions_json TEXT DEFAULT '[]'");
  safeAddColumn(db, 'employees', "emp_code TEXT DEFAULT ''");
  safeAddColumn(db, 'employees', "system_role TEXT DEFAULT ''");
  safeAddColumn(db, 'employees', 'login_enabled INTEGER DEFAULT 1');
  safeAddColumn(db, 'attendance_logs', "shift_date_key TEXT DEFAULT ''");
  safeAddColumn(db, 'attendance_logs', 'allowed_break_minutes INTEGER DEFAULT 0');
  safeAddColumn(db, 'attendance_logs', 'break_duration_minutes INTEGER DEFAULT 0');
  safeAddColumn(db, 'attendance_logs', "break_reason TEXT DEFAULT ''");
  safeAddColumn(db, 'shortages', 'is_suggestion INTEGER DEFAULT 0');
  safeAddColumn(db, 'shift_handovers', "open_items_json TEXT DEFAULT '[]'");
  safeAddColumn(db, 'shift_handovers', "acknowledged_at TEXT DEFAULT ''");
  safeAddColumn(db, 'shift_handovers', "from_role TEXT DEFAULT ''");
  safeAddColumn(db, 'shift_handovers', "target_role TEXT DEFAULT ''");

  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_attendance_shift_date ON attendance_logs(shift_date_key);');
  } catch {
    // ignore
  }

  // Backfill shift_date_key on any legacy attendance rows
  try {
    db.exec("UPDATE attendance_logs SET shift_date_key = date_key WHERE shift_date_key = '' OR shift_date_key IS NULL;");
  } catch {
    // ignore
  }

  const envSupabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ''
  ).trim();
  const envSupabaseKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const defaultSessionSecret = crypto
    .createHash('sha256')
    .update(process.env.SESSION_SECRET || 'zayed-mart-ops-default-session-secret-v3')
    .digest('hex');

  // Seed default store settings + cryptographic HMAC secret
  const defaultSettings = {
    store_name: 'زايد مارت',
    branch_name: 'الفرع الرئيسي',
    session_hmac_secret: defaultSessionSecret,
    max_break_minutes: '30',
    max_unload_minutes: '60',
    supabase_url: envSupabaseUrl,
    supabase_anon_key: envSupabaseKey,
    cloud_sync_enabled: envSupabaseUrl && envSupabaseKey ? 'true' : 'false',
    last_cloud_sync: '',
  };

  const upsertSettingStmt = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of Object.entries(defaultSettings)) {
    upsertSettingStmt.run(k, v);
  }

  const secretHex =
    db.prepare("SELECT value FROM settings WHERE key = 'session_hmac_secret'").get()?.value || '';

  // Seed default RBAC Role Policies if missing
  const policyInsert = db.prepare(
    'INSERT OR IGNORE INTO role_policies (role, permissions_json, updated_at) VALUES (?, ?, ?)'
  );
  const nowIso = new Date().toISOString();
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    policyInsert.run(role, JSON.stringify(perms), nowIso);
  }

  // Migration v3.5: Purge all legacy fake seed data from existing DB and update role_policies
  const purgedFakeV35 = db
    .prepare("SELECT value FROM settings WHERE key = 'migration_purge_fake_v35'")
    .get()?.value;
  if (!purgedFakeV35) {
    purgeLegacyFakeSeedData(db);
    // Sync role_policies with new v3.5 permissions
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      db.prepare(
        'INSERT OR REPLACE INTO role_policies (role, permissions_json, updated_at) VALUES (?, ?, ?)'
      ).run(role, JSON.stringify(perms), nowIso);
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'migration_purge_fake_v35',
      'done'
    );
  }

  // Migration v3.7: Seed walkie:use & walkie:all_channels into existing role_policies once
  const migratedWalkieV37 = db
    .prepare("SELECT value FROM settings WHERE key = 'migration_walkie_v37'")
    .get()?.value;
  if (!migratedWalkieV37) {
    const walkieRoleAdditions = {
      manager: ['walkie:use', 'walkie:all_channels'],
      supervisor: ['walkie:use', 'walkie:all_channels'],
      cctv: ['walkie:use', 'walkie:all_channels'],
      security: ['walkie:use'],
    };
    for (const [roleId, extraPerms] of Object.entries(walkieRoleAdditions)) {
      const existingRow = db
        .prepare('SELECT permissions_json FROM role_policies WHERE role = ?')
        .get(roleId);
      if (existingRow?.permissions_json) {
        try {
          const parsed = JSON.parse(existingRow.permissions_json);
          if (Array.isArray(parsed)) {
            const merged = Array.from(new Set([...parsed, ...extraPerms]));
            db.prepare(
              'UPDATE role_policies SET permissions_json = ?, updated_at = ? WHERE role = ?'
            ).run(JSON.stringify(merged), nowIso, roleId);
          }
        } catch {
          // ignore malformed legacy policy
        }
      }
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'migration_walkie_v37',
      'done'
    );
  }

  // Ensure initial Admin (owner) account with password '123' always exists
  const ownerRow = db
    .prepare("SELECT id FROM system_users WHERE role = 'owner' AND is_active = 1 LIMIT 1")
    .get();
  if (!ownerRow) {
    seedInitialStoreData(db, secretHex);
  }

  // Sync all active employees with personal login accounts in system_users
  try {
    const activeEmployees = db
      .prepare('SELECT * FROM employees WHERE is_active = 1')
      .all();
    for (const emp of activeEmployees) {
      syncEmployeeLoginAccount(db, emp);
    }
  } catch {
    // ignore startup sync issues
  }

  return db;
}

export function generateNextEmpCode(db) {
  const rows = db.prepare('SELECT emp_code FROM employees').all();
  let maxNum = 100;
  for (const r of rows) {
    const num = parseInt(r.emp_code, 10);
    if (!Number.isNaN(num) && num > maxNum) maxNum = num;
  }
  return String(maxNum + 1);
}

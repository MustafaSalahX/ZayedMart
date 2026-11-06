import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  computeLateMinutes,
  DEFAULT_ROLE_PERMISSIONS,
  getLocalDateKey,
  getPreviousDateKey,
  inferDefaultRoleFromDepartment,
  normalizeDigits,
  ROLES_METADATA,
  ZAYED_SUPABASE_ANON_KEY,
  ZAYED_SUPABASE_URL,
} from '@zayed-mart/shared';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool, PoolClient } from 'pg';
import {
  decryptPasswordForAdmin,
  deterministicSaltHex,
  deterministicUuidFromSeed,
  encryptPasswordForAdmin,
  hashPin,
  signSessionToken,
  verifyPinHash,
  verifySignedTokenFormat,
} from '../common/crypto.util';
import { AuthContext } from '../common/decorators';

const LEGACY_FAKE_USER_IDS = [
  '34cfe3c6-ebd0-4a8a-82e8-5eec90d82753',
  'd5b46bc6-7133-478c-88e6-a7b5e1b234b1',
  'aced9496-4de6-4c96-8b77-d9c9c767b15b',
  'b72805fd-1bbc-46e4-be0b-6dfde9265fc8',
  'de78d971-c394-43da-bbbc-f192787c45d4',
];

const LEGACY_FAKE_EMPLOYEE_IDS = [
  '6c058b52-c494-4fcc-b611-055defd26ead',
  '7beb37db-3cd9-4eea-b151-4dcc89e3315f',
  'a8db792c-9fcf-4162-9291-a91d45b4794b',
  'c048a0b9-2597-4df7-b31f-b090310f54e8',
  'a02bccd7-e4ab-4177-97e2-ac876af930fa',
  '435d24f9-e1dd-4d37-9e35-80a1a81f76fd',
  '7a142940-8ce3-40bd-93aa-91d511914fc6',
  '35b9ad92-7402-49e0-8c1c-7a851d2bf883',
  'aecff9f9-9f1c-4a7a-841e-9a974be11889',
];

function convertPlaceholdersToPg(sql: string): string {
  let idx = 0;
  let inSingleQuote = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
    } else if (ch === '?' && !inSingleQuote) {
      idx += 1;
      out += `$${idx}`;
    } else {
      out += ch;
    }
  }
  return out;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pgPool: Pool | null = null;
  private sqliteDb: DatabaseSync | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  public readonly storageMode: 'supabase_postgres' | 'sqlite_local';
  public readonly dbBootId: string = crypto.randomUUID();
  public readonly isServerless: boolean;

  constructor() {
    this.isServerless = Boolean(
      process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
    );

    const testDbPath = (process.env.ZAYED_TEST_DB_PATH || '').trim();
    const pgUrl = testDbPath
      ? ''
      : (
          process.env.DATABASE_URL ||
          process.env.POSTGRES_URL ||
          process.env.POSTGRES_PRISMA_URL ||
          process.env.POSTGRES_URL_NON_POOLING ||
          ''
        ).trim();

    if (pgUrl) {
      this.storageMode = 'supabase_postgres';
      // Strip sslmode from query string if present so explicit ssl object controls TLS cleanly
      const cleanPgUrl = pgUrl.replace(/([?&])sslmode=[^&]+(&?)/i, (_m, p1, p2) =>
        p2 ? p1 : ''
      );
      this.pgPool = new Pool({
        connectionString: cleanPgUrl,
        max: this.isServerless ? 3 : 10,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 10000,
        ssl: cleanPgUrl.includes('localhost') || cleanPgUrl.includes('127.0.0.1')
          ? undefined
          : { rejectUnauthorized: false },
      });
    } else {
      this.storageMode = 'sqlite_local';
      const sqlitePath = testDbPath || this.resolveDefaultSqlitePath();
      this.sqliteDb = new DatabaseSync(sqlitePath);
      if (sqlitePath !== ':memory:') {
        try {
          this.sqliteDb.exec(
            this.isServerless ? 'PRAGMA journal_mode = DELETE;' : 'PRAGMA journal_mode = WAL;'
          );
        } catch {
          // ignore
        }
      }
      this.sqliteDb.exec('PRAGMA foreign_keys = OFF;');
    }
  }

  private resolveDefaultSqlitePath(): string {
    if (!this.isServerless) {
      try {
        const repoRoot = path.resolve(__dirname, '../../../..');
        const dataDir = path.join(repoRoot, 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        return path.join(dataDir, 'zayed_mart.db');
      } catch {
        // fallback below
      }
    }
    const tmpDir = path.join(os.tmpdir(), 'zayed-mart-data');
    fs.mkdirSync(tmpDir, { recursive: true });
    return path.join(tmpDir, 'zayed_mart.db');
  }

  async onModuleInit(): Promise<void> {
    await this.ensureInitialized();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end().catch(() => {});
      this.pgPool = null;
    }
    if (this.sqliteDb) {
      try {
        this.sqliteDb.close();
      } catch {
        // ignore
      }
      this.sqliteDb = null;
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.bootstrapSchemaAndDefaults().finally(() => {
      this.initialized = true;
    });
    return this.initPromise;
  }

  async queryAll<T = any>(sql: string, params: any[] = [], client?: PoolClient): Promise<T[]> {
    if (this.pgPool) {
      const pgSql = convertPlaceholdersToPg(sql);
      const runner = client || this.pgPool;
      const res = await runner.query(pgSql, params);
      return res.rows as T[];
    }
    const stmt = this.sqliteDb!.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async queryOne<T = any>(
    sql: string,
    params: any[] = [],
    client?: PoolClient
  ): Promise<T | null> {
    const rows = await this.queryAll<T>(sql, params, client);
    return rows.length > 0 ? rows[0] : null;
  }

  async execute(
    sql: string,
    params: any[] = [],
    client?: PoolClient
  ): Promise<{ changes: number }> {
    if (this.pgPool) {
      const pgSql = convertPlaceholdersToPg(sql);
      const runner = client || this.pgPool;
      const res = await runner.query(pgSql, params);
      return { changes: res.rowCount || 0 };
    }
    const stmt = this.sqliteDb!.prepare(sql);
    const info = stmt.run(...params);
    return { changes: Number(info.changes || 0) };
  }

  async withTransaction<T>(fn: (client?: PoolClient) => Promise<T>): Promise<T> {
    if (this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }

    this.sqliteDb!.exec('BEGIN TRANSACTION');
    try {
      const result = await fn(undefined);
      this.sqliteDb!.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.sqliteDb!.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  private async bootstrapSchemaAndDefaults(): Promise<void> {
    const ddlStatements = [
      `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS system_users (
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
      )`,
      `CREATE TABLE IF NOT EXISTS role_policies (
        role TEXT PRIMARY KEY,
        permissions_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        ip_address TEXT DEFAULT '',
        user_agent TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT '',
        user_name TEXT NOT NULL,
        role TEXT DEFAULT '',
        action TEXT NOT NULL,
        details TEXT DEFAULT '',
        ip_address TEXT DEFAULT '',
        severity TEXT DEFAULT 'info',
        timestamp TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS employees (
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
      )`,
      `CREATE TABLE IF NOT EXISTS attendance_logs (
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
      )`,
      `CREATE TABLE IF NOT EXISTS suppliers (
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
      )`,
      `CREATE TABLE IF NOT EXISTS truck_logs (
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
        synced INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS notes (
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
        synced INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS shift_handovers (
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
        synced INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS product_catalog (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'بقالة جافة',
        default_unit TEXT DEFAULT '',
        supplier_id TEXT DEFAULT '',
        usage_count INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS shortages (
        id TEXT PRIMARY KEY,
        product_id TEXT DEFAULT '',
        item_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'بقالة جافة',
        requested_qty DOUBLE PRECISION DEFAULT NULL,
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
        synced INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS team_messages (
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
        synced INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS walkie_calls (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL DEFAULT 'security',
        kind TEXT NOT NULL DEFAULT 'voice',
        sender_id TEXT DEFAULT '',
        sender_name TEXT NOT NULL,
        sender_role TEXT DEFAULT '',
        audio_data TEXT DEFAULT '',
        mime_type TEXT DEFAULT 'audio/webm',
        duration_sec DOUBLE PRECISION DEFAULT 0,
        is_emergency INTEGER DEFAULT 0,
        timestamp TEXT NOT NULL,
        date_key TEXT NOT NULL,
        synced INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS walkie_presence (
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
      )`,
    ];

    for (const stmt of ddlStatements) {
      await this.execute(stmt);
    }

    const defaultSessionSecret = crypto
      .createHash('sha256')
      .update(process.env.SESSION_SECRET || 'zayed-mart-ops-default-session-secret-v3')
      .digest('hex');

    const envSupabaseUrl = (
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      ZAYED_SUPABASE_URL
    ).trim();
    const envSupabaseKey = (
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ZAYED_SUPABASE_ANON_KEY
    ).trim();

    const defaultSettings: Record<string, string> = {
      store_name: 'زايد مارت',
      branch_name: 'الفرع الرئيسي',
      session_hmac_secret: defaultSessionSecret,
      max_break_minutes: '30',
      max_unload_minutes: '60',
      supabase_url: envSupabaseUrl,
      supabase_anon_key: envSupabaseKey,
      cloud_sync_enabled: 'true',
      last_cloud_sync: '',
    };

    for (const [k, v] of Object.entries(defaultSettings)) {
      await this.execute(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
        [k, v]
      );
    }

    const nowIso = new Date().toISOString();
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      await this.execute(
        'INSERT INTO role_policies (role, permissions_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (role) DO NOTHING',
        [role, JSON.stringify(perms), nowIso]
      );
    }

    // Ensure walkie permissions exist in existing role policies
    const migratedWalkieV37 = await this.queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'migration_walkie_v37'"
    );
    if (!migratedWalkieV37?.value) {
      const additions: Record<string, string[]> = {
        manager: ['walkie:use', 'walkie:all_channels'],
        supervisor: ['walkie:use', 'walkie:all_channels'],
        cctv: ['walkie:use', 'walkie:all_channels'],
        security: ['walkie:use'],
      };
      for (const [roleId, extraPerms] of Object.entries(additions)) {
        const row = await this.queryOne<{ permissions_json: string }>(
          'SELECT permissions_json FROM role_policies WHERE role = ?',
          [roleId]
        );
        if (row?.permissions_json) {
          try {
            const parsed = JSON.parse(row.permissions_json);
            if (Array.isArray(parsed)) {
              const merged = Array.from(new Set([...parsed, ...extraPerms]));
              await this.execute(
                'UPDATE role_policies SET permissions_json = ?, updated_at = ? WHERE role = ?',
                [JSON.stringify(merged), nowIso, roleId]
              );
            }
          } catch {
            // ignore
          }
        }
      }
      await this.upsertSetting('migration_walkie_v37', 'done');
    }

    // Ensure default Owner ('123') exists
    const ownerRow = await this.queryOne<{ id: string }>(
      "SELECT id FROM system_users WHERE role = 'owner' AND is_active = 1 LIMIT 1"
    );
    if (!ownerRow) {
      const secretHex = await this.getSessionSecret();
      const adminId = 'cabc0e04-6b8f-4f68-9d6f-8d824cfd0ae9';
      const saltHex = deterministicSaltHex(`role-user:${adminId}:123`);
      const { hashHex } = hashPin('123', saltHex);
      const cipher = encryptPasswordForAdmin('123', secretHex);
      await this.execute(
        `INSERT INTO system_users (
          id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, employee_id, custom_permissions_json, created_at, updated_at
        ) VALUES (?, 'admin', 'إدارة زايد مارت (Admin)', 'owner', ?, ?, ?, '#7627BB', 1, '', '[]', ?, ?)
        ON CONFLICT (id) DO NOTHING`,
        [adminId, saltHex, hashHex, cipher, nowIso, nowIso]
      );
    }

    // Ensure active employees have synced login accounts
    try {
      const activeEmployees = await this.queryAll('SELECT * FROM employees WHERE is_active = 1');
      for (const emp of activeEmployees) {
        await this.syncEmployeeLoginAccount(emp);
      }
    } catch {
      // ignore non-fatal startup sync
    }
  }

  async getSettingsMap(): Promise<Record<string, string>> {
    const rows = await this.queryAll<{ key: string; value: string }>(
      'SELECT key, value FROM settings'
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async upsertSetting(key: string, value: string): Promise<void> {
    await this.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }

  async getSessionSecret(): Promise<string> {
    const row = await this.queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'session_hmac_secret'"
    );
    return row?.value || '';
  }

  async getRolePermissions(role: string, customPermsJson = ''): Promise<string[]> {
    if (role === 'owner') {
      return ALL_PERMISSIONS.map((p) => p.id);
    }
    let basePerms: string[] = [];
    const row = await this.queryOne<{ permissions_json: string }>(
      'SELECT permissions_json FROM role_policies WHERE role = ?',
      [role]
    );
    if (row?.permissions_json) {
      try {
        basePerms = JSON.parse(row.permissions_json);
      } catch {
        basePerms = DEFAULT_ROLE_PERMISSIONS[role] || [];
      }
    } else {
      basePerms = DEFAULT_ROLE_PERMISSIONS[role] || [];
    }

    let customPerms: string[] = [];
    if (customPermsJson) {
      try {
        const parsed =
          typeof customPermsJson === 'string' ? JSON.parse(customPermsJson) : customPermsJson;
        if (Array.isArray(parsed)) customPerms = parsed;
      } catch {
        // ignore
      }
    }

    const extra = role !== 'kiosk' ? ['profile:view', 'chat:read', 'chat:write'] : [];
    return Array.from(new Set([...basePerms, ...customPerms, ...extra]));
  }

  async recordAuditLog({
    userId = '',
    userName = 'النظام',
    role = '',
    action,
    details = '',
    ip = '',
    severity = 'info',
  }: {
    userId?: string;
    userName?: string;
    role?: string;
    action: string;
    details?: string;
    ip?: string;
    severity?: string;
  }): Promise<void> {
    try {
      await this.execute(
        `INSERT INTO audit_logs (id, user_id, user_name, role, action, details, ip_address, severity, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          userId,
          userName,
          role,
          action,
          details,
          ip,
          severity,
          new Date().toISOString(),
        ]
      );
    } catch {
      // non-fatal
    }
  }

  async issueSessionForUser(
    user: { id: string },
    ip: string,
    userAgent: string,
    durationHours = 24 * 365 * 5
  ): Promise<string> {
    const sessionId = `${crypto.randomUUID()}:${user.id}`;
    const now = new Date();
    const expires = new Date(now.getTime() + durationHours * 3600 * 1000);
    await this.execute(
      `INSERT INTO user_sessions (id, user_id, ip_address, user_agent, created_at, expires_at, revoked)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, user.id, ip, String(userAgent || '').slice(0, 200), now.toISOString(), expires.toISOString()]
    );
    const secret = await this.getSessionSecret();
    return signSessionToken(sessionId, secret);
  }

  async resolveAuthFromToken(rawToken: string): Promise<AuthContext | null> {
    await this.ensureInitialized();
    const secret = await this.getSessionSecret();
    const sessionId = verifySignedTokenFormat(rawToken, secret);
    if (!sessionId) return null;

    let session = await this.queryOne<any>('SELECT * FROM user_sessions WHERE id = ?', [sessionId]);
    if (session) {
      if (Number(session.revoked) === 1) return null;
      if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    } else if (sessionId.includes(':')) {
      const colonIdx = sessionId.indexOf(':');
      const embeddedUserId = sessionId.slice(colonIdx + 1).trim();
      if (!embeddedUserId) return null;

      if (embeddedUserId !== '__DEVICE_KIOSK__') {
        const activeUser = await this.queryOne<{ id: string }>(
          'SELECT id FROM system_users WHERE id = ? AND is_active = 1',
          [embeddedUserId]
        );
        if (!activeUser) return null;
      }

      const now = new Date();
      const expires = new Date(now.getTime() + 24 * 365 * 5 * 3600 * 1000);
      await this.execute(
        `INSERT INTO user_sessions (id, user_id, ip_address, user_agent, created_at, expires_at, revoked)
         VALUES (?, ?, 'serverless', 'rehydrated', ?, ?, 0)
         ON CONFLICT (id) DO NOTHING`,
        [sessionId, embeddedUserId, now.toISOString(), expires.toISOString()]
      );
      session = await this.queryOne<any>(
        'SELECT * FROM user_sessions WHERE id = ? AND revoked = 0',
        [sessionId]
      );
      if (!session) return null;
    } else {
      return null;
    }

    if (session.user_id === '__DEVICE_KIOSK__') {
      const permissions = await this.getRolePermissions('kiosk');
      return {
        sessionId: session.id,
        user: {
          id: '__DEVICE_KIOSK__',
          username: 'kiosk_device',
          display_name: 'شاشة كشك حضور العمال',
          role: 'kiosk',
          role_label: ROLES_METADATA.kiosk.label,
          avatar_color: '#E37400',
        },
        permissions,
        actorLabel: 'كشك العمال',
        has(perm: string) {
          return permissions.includes(perm);
        },
      };
    }

    const user = await this.queryOne<any>(
      'SELECT * FROM system_users WHERE id = ? AND is_active = 1',
      [session.user_id]
    );
    if (!user) return null;

    const permissions = await this.getRolePermissions(user.role, user.custom_permissions_json);
    const roleMeta = ROLES_METADATA[user.role] || { shortLabel: user.role, label: user.role };
    const actorLabel =
      user.role === 'kiosk'
        ? 'كشك العمال'
        : `${user.display_name} (${roleMeta.shortLabel})`;

    return {
      sessionId: session.id,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        role_label: roleMeta.label || user.role,
        avatar_color: user.avatar_color,
        employee_id: user.employee_id || '',
      },
      permissions,
      actorLabel,
      has(perm: string) {
        return user.role === 'owner' || permissions.includes(perm);
      },
    };
  }

  async findPasswordConflict(rawPassword: string, excludeUserId = ''): Promise<any | null> {
    const clean = String(rawPassword || '').trim();
    if (!clean) return null;
    const rows = await this.queryAll<any>('SELECT * FROM system_users WHERE id != ?', [
      excludeUserId,
    ]);
    for (const u of rows) {
      if (verifyPinHash(clean, u.pin_salt, u.pin_hash)) {
        return u;
      }
    }
    return null;
  }

  async generateNextEmpCode(): Promise<string> {
    const rows = await this.queryAll<{ emp_code: string }>('SELECT emp_code FROM employees');
    let maxNum = 100;
    for (const r of rows) {
      const num = parseInt(r.emp_code, 10);
      if (!Number.isNaN(num) && num > maxNum) maxNum = num;
    }
    return String(maxNum + 1);
  }

  async syncEmployeeLoginAccount(emp: any, options: any = {}): Promise<any | null> {
    if (!emp || !emp.id) return null;
    const secretHex = await this.getSessionSecret();
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

    if (emp.system_role !== resolvedRole || Number(emp.login_enabled) !== loginEnabled) {
      await this.execute('UPDATE employees SET system_role = ?, login_enabled = ? WHERE id = ?', [
        resolvedRole,
        loginEnabled,
        emp.id,
      ]);
    }

    const existingLinked = await this.queryOne<any>(
      'SELECT * FROM system_users WHERE employee_id = ? LIMIT 1',
      [emp.id]
    );

    if (!Number(emp.is_active) || !loginEnabled || resolvedRole === 'none') {
      if (existingLinked) {
        await this.execute('UPDATE system_users SET is_active = 0, updated_at = ? WHERE id = ?', [
          nowIso,
          existingLinked.id,
        ]);
        await this.execute('UPDATE user_sessions SET revoked = 1 WHERE user_id = ?', [
          existingLinked.id,
        ]);
      }
      return null;
    }

    const rawPass = normalizeDigits(String(options.password ?? emp.emp_code ?? '').trim());

    const hasConflict = async (candidatePass: string, excludeUserId = '') => {
      if (!candidatePass) return true;
      const others = await this.queryAll<any>(
        'SELECT id, pin_salt, pin_hash FROM system_users WHERE id != ? AND is_active = 1',
        [excludeUserId]
      );
      for (const u of others) {
        if (verifyPinHash(candidatePass, u.pin_salt, u.pin_hash)) return true;
      }
      return false;
    };

    if (existingLinked) {
      let saltHex = existingLinked.pin_salt;
      let hashHex = existingLinked.pin_hash;
      let cipher = existingLinked.pin_cipher || '';

      if (
        options.updatePassword &&
        rawPass &&
        !(await hasConflict(rawPass, existingLinked.id))
      ) {
        const hashed = hashPin(rawPass);
        saltHex = hashed.saltHex;
        hashHex = hashed.hashHex;
        cipher = encryptPasswordForAdmin(rawPass, secretHex);
      }

      await this.execute(
        `UPDATE system_users
         SET display_name = ?, role = ?, pin_salt = ?, pin_hash = ?, pin_cipher = ?, avatar_color = ?, is_active = 1, updated_at = ?
         WHERE id = ?`,
        [
          emp.name.trim(),
          resolvedRole,
          saltHex,
          hashHex,
          cipher,
          emp.avatar_color || '#0B57D0',
          nowIso,
          existingLinked.id,
        ]
      );
      return this.queryOne('SELECT * FROM system_users WHERE id = ?', [existingLinked.id]);
    }

    let finalPass = rawPass;
    if (!finalPass || (await hasConflict(finalPass))) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const candidate = String(1000 + Math.floor(Math.random() * 8999));
        if (!(await hasConflict(candidate))) {
          finalPass = candidate;
          break;
        }
      }
      if (!finalPass || (await hasConflict(finalPass))) {
        return null;
      }
    }

    const saltSeed = deterministicSaltHex(`emp-user:${emp.id}:${finalPass}`);
    const { saltHex, hashHex } = hashPin(finalPass, saltSeed);
    const cipher = encryptPasswordForAdmin(finalPass, secretHex);
    const candidateUserId = deterministicUuidFromSeed(`emp-user:${emp.id}`);
    const idCollision = await this.queryOne('SELECT id FROM system_users WHERE id = ?', [
      candidateUserId,
    ]);
    const newUserId = idCollision ? crypto.randomUUID() : candidateUserId;
    const baseUsername = `emp_${finalPass.replace(/[^a-z0-9]/gi, '') || emp.id.slice(0, 6)}`;
    const usernameExists = await this.queryOne('SELECT id FROM system_users WHERE username = ?', [
      baseUsername,
    ]);
    const finalUsername = usernameExists
      ? `${baseUsername}_${crypto.randomBytes(2).toString('hex')}`
      : baseUsername;

    await this.execute(
      `INSERT INTO system_users (
        id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, employee_id, custom_permissions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '[]', ?, ?)`,
      [
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
        nowIso,
      ]
    );

    return this.queryOne('SELECT * FROM system_users WHERE id = ?', [newUserId]);
  }

  async findOpenShiftForEmployee(employeeId: string, refDate: Date = new Date()) {
    const refIso = refDate.toISOString();
    const recentLogs = await this.queryAll<any>(
      'SELECT * FROM attendance_logs WHERE employee_id = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 15',
      [employeeId, refIso]
    );

    if (recentLogs.length === 0) {
      return {
        isOpen: false,
        shiftDateKey: getLocalDateKey(refDate),
        latestLog: null,
        checkInLog: null,
      };
    }

    const latestLog = recentLogs[0];
    const elapsedHours =
      (refDate.getTime() - new Date(latestLog.timestamp).getTime()) / (3600 * 1000);

    if (latestLog.action_type !== 'check_out' && elapsedHours <= 22) {
      let checkInLog: any = null;
      for (const l of recentLogs) {
        if (l.action_type === 'check_out') break;
        if (l.action_type === 'check_in') {
          checkInLog = l;
          break;
        }
      }
      const shiftDateKey =
        checkInLog?.shift_date_key ||
        checkInLog?.date_key ||
        latestLog.shift_date_key ||
        latestLog.date_key ||
        getLocalDateKey(refDate);
      return {
        isOpen: true,
        shiftDateKey,
        latestLog,
        checkInLog,
      };
    }

    return {
      isOpen: false,
      shiftDateKey: getLocalDateKey(refDate),
      latestLog,
      checkInLog: null,
    };
  }

  async insertAttendanceLog({
    id: requestedId,
    emp,
    action_type,
    note = '',
    proof_url = '',
    recorded_by,
    autoVerified = false,
    timestamp,
    allowed_break_minutes = 0,
    break_reason = '',
    actorUser = null,
    ip = '',
  }: {
    id?: string;
    emp: any;
    action_type: string;
    note?: string;
    proof_url?: string;
    recorded_by: string;
    autoVerified?: boolean | number;
    timestamp?: string;
    allowed_break_minutes?: number | string;
    break_reason?: string;
    actorUser?: any;
    ip?: string;
  }) {
    if (requestedId) {
      const existingById = await this.queryOne(
        'SELECT * FROM attendance_logs WHERE id = ? LIMIT 1',
        [String(requestedId)]
      );
      if (existingById) return existingById;
    }

    const eventDate = timestamp ? new Date(timestamp) : new Date();
    const isoTime = eventDate.toISOString();
    const dateKey = getLocalDateKey(eventDate);
    const openShift = await this.findOpenShiftForEmployee(emp.id, eventDate);

    const shiftDateKey =
      action_type === 'check_in'
        ? dateKey
        : openShift.isOpen
        ? openShift.shiftDateKey
        : dateKey;

    let lateMinutes = 0;
    if (action_type === 'check_in') {
      const existingCheckIn = await this.queryOne(
        "SELECT id FROM attendance_logs WHERE employee_id = ? AND (date_key = ? OR shift_date_key = ?) AND action_type = 'check_in'",
        [emp.id, dateKey, shiftDateKey]
      );
      if (!existingCheckIn) {
        lateMinutes = computeLateMinutes(emp.shift_start, eventDate);
      }
    }

    const settings = await this.getSettingsMap();
    const defaultMaxBreak = Number(settings.max_break_minutes || 30);
    let finalAllowedBreak = 0;
    let finalBreakDuration = 0;
    let finalBreakReason = String(break_reason || '').trim().slice(0, 120);

    if (action_type === 'break_start') {
      const parsedAllowed = Number(normalizeDigits(String(allowed_break_minutes || '')));
      finalAllowedBreak =
        Number.isFinite(parsedAllowed) && parsedAllowed > 0 ? parsedAllowed : defaultMaxBreak;
    } else if (
      action_type === 'break_end' ||
      (action_type === 'check_out' && openShift.latestLog?.action_type === 'break_start')
    ) {
      const lastBreakStart = await this.queryOne<any>(
        `SELECT * FROM attendance_logs
         WHERE employee_id = ? AND (shift_date_key = ? OR date_key = ?) AND action_type = 'break_start'
         ORDER BY timestamp DESC LIMIT 1`,
        [emp.id, shiftDateKey, dateKey]
      );

      if (lastBreakStart) {
        finalBreakDuration = Math.max(
          1,
          Math.round(
            (eventDate.getTime() - new Date(lastBreakStart.timestamp).getTime()) / 60000
          )
        );
        finalAllowedBreak = Number(lastBreakStart.allowed_break_minutes) || defaultMaxBreak;
        if (!finalBreakReason) {
          finalBreakReason = lastBreakStart.break_reason || '';
        }
        await this.execute('UPDATE attendance_logs SET break_duration_minutes = ? WHERE id = ?', [
          finalBreakDuration,
          lastBreakStart.id,
        ]);
      }
    }

    const finalNote =
      note ||
      (action_type === 'break_start' && finalBreakReason
        ? `بريك (${finalAllowedBreak} د) - ${finalBreakReason}`
        : action_type === 'break_end' && finalBreakDuration > 0
        ? `عودة من بريك بعد ${finalBreakDuration} دقيقة (المسموح ${finalAllowedBreak} د)`
        : '');

    const attLogId = requestedId ? String(requestedId) : crypto.randomUUID();
    await this.execute(
      `INSERT INTO attendance_logs (
        id, employee_id, employee_name, department, action_type, timestamp, date_key, shift_date_key,
        late_minutes, allowed_break_minutes, break_duration_minutes, break_reason,
        note, proof_url, recorded_by, verified_by_cctv, verified_at, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        attLogId,
        emp.id,
        emp.name,
        emp.department,
        action_type,
        isoTime,
        dateKey,
        shiftDateKey,
        lateMinutes,
        finalAllowedBreak,
        finalBreakDuration,
        finalBreakReason,
        finalNote,
        proof_url,
        recorded_by,
        autoVerified ? 1 : 0,
        autoVerified ? isoTime : '',
      ]
    );

    const actionArabicMap: Record<string, string> = {
      check_in: 'حضور',
      break_start: `بدء استراحة (${finalAllowedBreak} دقيقة)`,
      break_end: `عودة من استراحة (قضى ${finalBreakDuration} دقيقة)`,
      check_out: 'انصراف',
    };

    await this.recordAuditLog({
      userId: actorUser?.id || emp.id,
      userName: actorUser?.display_name || recorded_by,
      role: actorUser?.role || '',
      action: `حركة موظف: ${actionArabicMap[action_type] || action_type}`,
      details: `الموظف "${emp.name}" (${emp.department}) — شفت ${shiftDateKey}${dateKey !== shiftDateKey ? ` [ممتد لليوم ${dateKey}]` : ''}${finalNote ? ` — ${finalNote}` : ''}`,
      ip,
      severity:
        action_type === 'break_end' &&
        finalAllowedBreak > 0 &&
        finalBreakDuration > finalAllowedBreak
          ? 'warning'
          : 'info',
    });

    return this.queryOne('SELECT * FROM attendance_logs WHERE id = ?', [attLogId]);
  }

  async ensureCatalogProduct({
    name,
    category = 'بقالة جافة',
    unit = '',
    supplier_id = '',
  }: {
    name: string;
    category?: string;
    unit?: string;
    supplier_id?: string;
  }): Promise<string> {
    const cleanName = String(name || '').trim();
    if (!cleanName) return '';
    const existing = await this.queryOne<any>(
      'SELECT * FROM product_catalog WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [cleanName]
    );
    const now = new Date().toISOString();
    if (existing) {
      await this.execute(
        `UPDATE product_catalog
         SET is_active = 1,
             usage_count = COALESCE(usage_count, 0) + 1,
             default_unit = CASE WHEN ? != '' THEN ? ELSE default_unit END,
             updated_at = ?
         WHERE id = ?`,
        [unit, unit, now, existing.id]
      );
      return existing.id;
    }
    const newId = crypto.randomUUID();
    await this.execute(
      `INSERT INTO product_catalog (id, name, category, default_unit, supplier_id, usage_count, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
      [newId, cleanName, category || 'بقالة جافة', unit || '', supplier_id || '', now]
    );
    return newId;
  }

  async buildBootstrapData(
    dateKey: string | undefined,
    auth: AuthContext | null,
    cloudRealtimeConfig?: Record<string, any>
  ) {
    const targetDate = dateKey || getLocalDateKey();
    const prevDate = getPreviousDateKey(targetDate);
    const todayKey = getLocalDateKey();
    const settings = await this.getSettingsMap();
    const isInternalSnap = !auth;

    const canAttendance =
      isInternalSnap ||
      auth!.has('attendance:read') ||
      auth!.has('attendance:write') ||
      auth!.has('attendance:kiosk') ||
      auth!.has('staff:manage') ||
      auth!.has('reports:view');

    const canReadAttendanceLogs =
      isInternalSnap || auth!.has('attendance:read') || auth!.has('reports:view');

    const canTrucks =
      isInternalSnap ||
      auth!.has('trucks:read') ||
      auth!.has('trucks:write') ||
      auth!.has('suppliers:manage') ||
      auth!.has('reports:view');

    const canShortages =
      isInternalSnap ||
      auth!.has('shortages:read') ||
      auth!.has('shortages:write') ||
      auth!.has('shortages:manage');

    const canNotes =
      isInternalSnap ||
      auth!.has('notes:read') ||
      auth!.has('notes:write') ||
      auth!.has('reports:view');

    const canHandover =
      isInternalSnap || auth!.has('handover:manage') || auth!.has('reports:view');

    const canChat = isInternalSnap || auth!.has('chat:read') || auth!.has('chat:write');

    const employees = canAttendance
      ? await this.queryAll<any>(
          'SELECT * FROM employees WHERE is_active = 1 ORDER BY department, emp_code, name'
        )
      : [];

    let attendanceLogs: any[] = [];
    if (canAttendance) {
      const directLogs = await this.queryAll<any>(
        'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp DESC',
        [targetDate, targetDate]
      );
      const prevShiftLogs = await this.queryAll<any>(
        'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp ASC',
        [prevDate, prevDate]
      );

      const prevByEmp = new Map<string, any[]>();
      for (const l of prevShiftLogs) {
        if (!prevByEmp.has(l.employee_id)) prevByEmp.set(l.employee_id, []);
        prevByEmp.get(l.employee_id)!.push(l);
      }

      const mergedById = new Map<string, any>();
      for (const l of directLogs) {
        mergedById.set(l.id, l);
      }

      const nowMs = Date.now();
      for (const [, empPrevLogs] of prevByEmp.entries()) {
        const lastPrev = empPrevLogs[empPrevLogs.length - 1];
        if (!lastPrev) continue;
        const touchedTargetDate = empPrevLogs.some((l) => l.date_key === targetDate);
        const lastPrevDateObj = new Date(lastPrev.timestamp);
        const isNightOrEveningOnPrev = lastPrevDateObj.getHours() >= 14;
        const isStillOpenFromYesterday =
          lastPrev.action_type !== 'check_out' &&
          ((targetDate === todayKey &&
            (nowMs - lastPrevDateObj.getTime()) / (3600 * 1000) <= 22) ||
            isNightOrEveningOnPrev);

        if (touchedTargetDate || isStillOpenFromYesterday) {
          const lastShiftKey = lastPrev.shift_date_key || lastPrev.date_key;
          for (const l of empPrevLogs) {
            if ((l.shift_date_key || l.date_key) === lastShiftKey) {
              mergedById.set(l.id, l);
            }
          }
        }
      }

      attendanceLogs = Array.from(mergedById.values()).sort((a, b) =>
        String(b.timestamp).localeCompare(String(a.timestamp))
      );
    }

    const logsByEmp = new Map<string, any[]>();
    for (let i = attendanceLogs.length - 1; i >= 0; i--) {
      const log = attendanceLogs[i];
      if (!logsByEmp.has(log.employee_id)) logsByEmp.set(log.employee_id, []);
      logsByEmp.get(log.employee_id)!.push(log);
    }

    let presentCount = 0;
    let onBreakCount = 0;
    let checkedOutCount = 0;
    let lateCount = 0;
    let unverifiedAttendanceCount = 0;

    if (canAttendance) {
      for (const log of attendanceLogs) {
        if (!Number(log.verified_by_cctv)) unverifiedAttendanceCount += 1;
      }
    }

    const canManageStaffOrUsers =
      isInternalSnap || Boolean(auth && (auth.has('staff:manage') || auth.has('users:manage')));
    const linkedUsersByEmpId = new Map<string, { role: string; password: string }>();
    if (canManageStaffOrUsers && employees.length > 0) {
      const secretHex = await this.getSessionSecret();
      const linkedRows = await this.queryAll<any>(
        "SELECT * FROM system_users WHERE employee_id != '' AND is_active = 1"
      );
      for (const u of linkedRows) {
        linkedUsersByEmpId.set(u.employee_id, {
          role: u.role,
          password: decryptPasswordForAdmin(u.pin_cipher, secretHex) || '',
        });
      }
    }

    const defaultMaxBreak = Number(settings.max_break_minutes || 30);

    const enrichedEmployees = employees.map((emp) => {
      const allEmpLogs = logsByEmp.get(emp.id) || [];
      const latestLog = allEmpLogs[allEmpLogs.length - 1] || null;
      const activeShiftKey = latestLog?.shift_date_key || latestLog?.date_key || targetDate;

      const empLogs = allEmpLogs.filter(
        (l) => (l.shift_date_key || l.date_key) === activeShiftKey
      );
      const firstCheckIn =
        empLogs.find((l) => l.action_type === 'check_in') ||
        allEmpLogs.find((l) => l.action_type === 'check_in');

      let currentStatus = 'absent';
      if (latestLog) {
        if (latestLog.action_type === 'check_in' || latestLog.action_type === 'break_end') {
          currentStatus = 'present';
          presentCount += 1;
        } else if (latestLog.action_type === 'break_start') {
          currentStatus = 'on_break';
          onBreakCount += 1;
        } else if (latestLog.action_type === 'check_out') {
          currentStatus = 'checked_out';
          checkedOutCount += 1;
        }
      }

      const lateMinutes = firstCheckIn ? Number(firstCheckIn.late_minutes || 0) : 0;
      if (lateMinutes > 0) lateCount += 1;

      const isCrossDayShift = Boolean(
        (firstCheckIn && firstCheckIn.date_key !== targetDate) ||
          empLogs.some((l) => l.date_key !== (l.shift_date_key || l.date_key))
      );

      const breakStarts = empLogs.filter((l) => l.action_type === 'break_start');
      const breakEnds = empLogs.filter((l) => l.action_type === 'break_end');
      let totalBreakMinutes = breakEnds.reduce(
        (sum, l) => sum + (Number(l.break_duration_minutes) || 0),
        0
      );
      if (currentStatus === 'on_break' && latestLog) {
        const currentBreakElapsed = Math.max(
          0,
          Math.round((Date.now() - new Date(latestLog.timestamp).getTime()) / 60000)
        );
        totalBreakMinutes += currentBreakElapsed;
      }

      const checkOutLog = empLogs.filter((l) => l.action_type === 'check_out').pop() || null;
      const shiftDurationMinutes = firstCheckIn
        ? Math.max(
            0,
            Math.round(
              ((checkOutLog ? new Date(checkOutLog.timestamp).getTime() : Date.now()) -
                new Date(firstCheckIn.timestamp).getTime()) /
                60000
            )
          )
        : 0;

      if (auth && !canReadAttendanceLogs && !auth.has('staff:manage')) {
        return {
          id: emp.id,
          emp_code: emp.emp_code,
          name: emp.name,
          department: emp.department,
          avatar_color: emp.avatar_color,
          currentStatus,
          isCrossDayShift,
          shiftDateKey: activeShiftKey,
        };
      }

      const linkedInfo = linkedUsersByEmpId.get(emp.id);
      const resolvedSystemRole =
        linkedInfo?.role ||
        emp.system_role ||
        inferDefaultRoleFromDepartment(emp.department, emp.role_title);

      return {
        ...emp,
        system_role: resolvedSystemRole,
        login_password: canManageStaffOrUsers
          ? linkedInfo?.password || emp.emp_code || ''
          : undefined,
        currentStatus,
        isCrossDayShift,
        shiftDateKey: activeShiftKey,
        checkInTime: firstCheckIn ? firstCheckIn.timestamp : null,
        checkOutTime: checkOutLog ? checkOutLog.timestamp : null,
        shiftDurationMinutes,
        latestActionTime: latestLog ? latestLog.timestamp : null,
        latestActionType: latestLog ? latestLog.action_type : null,
        latestRecordedBy: latestLog ? latestLog.recorded_by : null,
        latestLogId: latestLog ? latestLog.id : null,
        latestVerified: latestLog ? Boolean(Number(latestLog.verified_by_cctv)) : true,
        activeBreakStart: currentStatus === 'on_break' && latestLog ? latestLog.timestamp : null,
        allowedBreakMinutes:
          currentStatus === 'on_break' && latestLog
            ? Number(latestLog.allowed_break_minutes) || defaultMaxBreak
            : defaultMaxBreak,
        breakReason:
          currentStatus === 'on_break' && latestLog
            ? latestLog.break_reason || latestLog.note || ''
            : '',
        totalBreakMinutes,
        breaksCount: breakStarts.length,
        lateMinutes,
        todayLogsCount: empLogs.length,
      };
    });

    const isKioskOnly =
      auth &&
      auth.has('attendance:kiosk') &&
      !canReadAttendanceLogs &&
      !canTrucks &&
      !canShortages &&
      !canNotes;

    if (isKioskOnly) {
      return {
        storageMode: this.storageMode,
        cloudRealtime: cloudRealtimeConfig || null,
        dateKey: targetDate,
        serverTime: new Date().toISOString(),
        auth: {
          user: auth.user,
          permissions: auth.permissions,
        },
        settings: {
          store_name: settings.store_name || 'زايد مارت',
          branch_name: settings.branch_name || 'الفرع الرئيسي',
          max_break_minutes: Number(settings.max_break_minutes || 30),
          max_unload_minutes: Number(settings.max_unload_minutes || 60),
        },
        employees: enrichedEmployees,
        attendanceLogs: [],
        suppliers: [],
        truckLogs: [],
        shortages: [],
        productCatalog: [],
        notes: [],
        handovers: [],
        teamMessages: [],
        myProfile: null,
        pendingHandover: null,
        summary: {
          totalEmployees: employees.length,
          presentCount,
          onBreakCount,
          checkedOutCount,
          absentCount: 0,
          lateCount: 0,
          unverifiedAttendanceCount: 0,
          unloadingTrucksCount: 0,
          completedTrucksCount: 0,
          issuesTrucksCount: 0,
          openShortagesCount: 0,
          urgentShortagesCount: 0,
          orderedShortagesCount: 0,
          resolvedShortagesTodayCount: 0,
          urgentNotesCount: 0,
          openHandoverNotesCount: 0,
          pendingSupplierReturnsCount: 0,
        },
      };
    }

    const canSeeSupplierDirectory = Boolean(
      canTrucks || (auth && auth.has('shortages:manage'))
    );

    const suppliers = canSeeSupplierDirectory
      ? await this.queryAll<any>(
          'SELECT * FROM suppliers WHERE is_active = 1 ORDER BY has_pending_return DESC, name'
        )
      : [];

    const truckLogs = canTrucks
      ? await this.queryAll<any>(
          `SELECT * FROM truck_logs
           WHERE status = 'unloading' OR date_key = ?
           ORDER BY CASE WHEN status = 'unloading' THEN 0 ELSE 1 END, arrival_time DESC`,
          [targetDate]
        )
      : [];

    const unloadingTrucksCount = truckLogs.filter((t) => t.status === 'unloading').length;
    const completedTrucksCount = truckLogs.filter(
      (t) => t.status === 'completed' && t.date_key === targetDate
    ).length;
    const issuesTrucksCount = truckLogs.filter(
      (t) =>
        t.date_key === targetDate &&
        (t.delivery_condition === 'shortage' || t.delivery_condition === 'return_damaged')
    ).length;

    const shortages = canShortages
      ? await this.queryAll<any>(
          `SELECT * FROM shortages
           WHERE status IN ('open', 'ordered') OR date_key = ?
           ORDER BY
             CASE status WHEN 'open' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END,
             CASE urgency WHEN 'out_of_stock' THEN 0 ELSE 1 END,
             updated_at DESC`,
          [targetDate]
        )
      : [];

    const productCatalog = canShortages
      ? await this.queryAll<any>(
          'SELECT * FROM product_catalog WHERE is_active = 1 ORDER BY usage_count DESC, name ASC'
        )
      : [];

    const openShortagesCount = shortages.filter((s) => s.status === 'open').length;
    const orderedShortagesCount = shortages.filter((s) => s.status === 'ordered').length;
    const urgentShortagesCount = shortages.filter(
      (s) => s.status === 'open' && s.urgency === 'out_of_stock'
    ).length;
    const resolvedShortagesTodayCount = shortages.filter(
      (s) => s.status === 'resolved' && s.date_key === targetDate
    ).length;

    const notes = canNotes
      ? await this.queryAll<any>(
          `SELECT * FROM notes
           WHERE is_open_handover = 1 OR date_key = ?
           ORDER BY is_open_handover DESC, timestamp DESC`,
          [targetDate]
        )
      : [];

    const urgentNotesCount = notes.filter(
      (n) => n.severity === 'urgent' && n.date_key === targetDate
    ).length;
    const openHandoverNotesCount = notes.filter((n) => Number(n.is_open_handover) === 1).length;

    const teamMessages = canChat
      ? await this.queryAll<any>(
          'SELECT * FROM team_messages ORDER BY is_pinned DESC, timestamp DESC LIMIT 120'
        )
      : [];

    const currentRole = auth?.user?.role || '';
    const currentUserName = (auth?.user?.display_name || '').trim();
    const isAdminOrManager = !auth || currentRole === 'owner' || currentRole === 'manager';

    const rawHandovers = canHandover
      ? await this.queryAll<any>(
          'SELECT * FROM shift_handovers ORDER BY timestamp DESC LIMIT 40'
        )
      : [];

    const allHandovers = rawHandovers.map((h) => {
      let openItems = [];
      try {
        openItems = JSON.parse(h.open_items_json || '[]');
      } catch {
        openItems = [];
      }
      return { ...h, openItems };
    });

    const handovers = canHandover
      ? isAdminOrManager
        ? allHandovers.slice(0, 20)
        : allHandovers
            .filter((h) => {
              const tRole = h.target_role || h.from_role || 'cctv';
              return tRole === currentRole;
            })
            .slice(0, 20)
      : [];

    const pendingHandover = canHandover
      ? handovers.find((h) => Number(h.acknowledged) === 0) || null
      : null;

    const roleColleagues: any[] = [];
    if (canHandover && auth?.user) {
      const targetRolesSet =
        currentRole === 'owner' || currentRole === 'manager'
          ? new Set(['owner', 'manager', 'supervisor'])
          : new Set([currentRole]);

      const seenNames = new Set<string>();
      if (currentUserName) seenNames.add(currentUserName.toLowerCase());

      const activeEmpRows = await this.queryAll<any>(
        'SELECT id, name, department, role_title, system_role FROM employees WHERE is_active = 1 ORDER BY name'
      );
      for (const emp of activeEmpRows) {
        const effRole =
          emp.system_role || inferDefaultRoleFromDepartment(emp.department, emp.role_title);
        const cleanName = (emp.name || '').trim();
        if (!cleanName || seenNames.has(cleanName.toLowerCase())) continue;
        if (targetRolesSet.has(effRole)) {
          seenNames.add(cleanName.toLowerCase());
          roleColleagues.push({
            id: emp.id,
            name: cleanName,
            department: emp.department,
            role_title: emp.role_title || '',
            role: effRole,
          });
        }
      }

      const activeSysUsers = await this.queryAll<any>(
        'SELECT id, display_name, role FROM system_users WHERE is_active = 1 ORDER BY display_name'
      );
      for (const u of activeSysUsers) {
        const cleanName = (u.display_name || '').trim();
        if (!cleanName || seenNames.has(cleanName.toLowerCase())) continue;
        if (targetRolesSet.has(u.role)) {
          seenNames.add(cleanName.toLowerCase());
          roleColleagues.push({
            id: u.id,
            name: cleanName,
            department: '',
            role_title: ROLES_METADATA[u.role]?.shortLabel || u.role,
            role: u.role,
          });
        }
      }
    }

    let myProfile: any = null;
    if (auth?.user && auth.user.role !== 'kiosk') {
      const secretHex = await this.getSessionSecret();
      const userRow = await this.queryOne<any>(
        'SELECT * FROM system_users WHERE id = ? LIMIT 1',
        [auth.user.id]
      );
      const empRow = userRow?.employee_id
        ? await this.queryOne<any>('SELECT * FROM employees WHERE id = ? LIMIT 1', [
            userRow.employee_id,
          ])
        : null;
      const myPass = userRow
        ? decryptPasswordForAdmin(userRow.pin_cipher, secretHex) || empRow?.emp_code || ''
        : '';

      myProfile = {
        user_id: auth.user.id,
        username: auth.user.username,
        display_name: auth.user.display_name,
        role: auth.user.role,
        role_label: auth.user.role_label,
        avatar_color: auth.user.avatar_color,
        my_password: myPass,
        employee_id: empRow?.id || '',
        emp_code: empRow?.emp_code || '',
        department: empRow?.department || ROLES_METADATA[auth.user.role]?.shortLabel || '',
        role_title: empRow?.role_title || ROLES_METADATA[auth.user.role]?.label || '',
        shift_start: empRow?.shift_start || '08:00',
        shift_end: empRow?.shift_end || '20:00',
        phone: empRow?.phone || '',
        qr_payload: empRow ? `ZMART:EMP:${empRow.id}` : '',
      };
    }

    const canManageSettings = auth?.has('settings:manage');

    // Never trigger legacy client rehydration when connected to authoritative Supabase PostgreSQL!
    let serverColdEmpty = false;
    if (this.storageMode === 'sqlite_local') {
      const empCount = Number(
        (await this.queryOne<{ c: any }>('SELECT COUNT(*) as c FROM employees'))?.c || 0
      );
      const shCount = Number(
        (await this.queryOne<{ c: any }>('SELECT COUNT(*) as c FROM shortages'))?.c || 0
      );
      const attCount = Number(
        (await this.queryOne<{ c: any }>('SELECT COUNT(*) as c FROM attendance_logs'))?.c || 0
      );
      serverColdEmpty = empCount + shCount + attCount === 0;
    }

    return {
      dbBootId: this.dbBootId,
      storageMode: this.storageMode,
      cloudRealtime: cloudRealtimeConfig || null,
      serverColdEmpty,
      dateKey: targetDate,
      serverTime: new Date().toISOString(),
      auth: auth
        ? {
            user: auth.user,
            permissions: auth.permissions,
          }
        : null,
      myProfile,
      settings: {
        store_name: settings.store_name || 'زايد مارت',
        branch_name: settings.branch_name || 'الفرع الرئيسي',
        max_break_minutes: Number(settings.max_break_minutes || 30),
        max_unload_minutes: Number(settings.max_unload_minutes || 60),
        cloud_sync_enabled:
          this.storageMode === 'supabase_postgres' || settings.cloud_sync_enabled === 'true',
        supabase_url: canManageSettings
          ? settings.supabase_url || ZAYED_SUPABASE_URL
          : '',
        has_supabase_key: canManageSettings
          ? Boolean(settings.supabase_anon_key || ZAYED_SUPABASE_ANON_KEY)
          : false,
        last_cloud_sync:
          this.storageMode === 'supabase_postgres'
            ? new Date().toISOString()
            : settings.last_cloud_sync || '',
      },
      employees: enrichedEmployees,
      attendanceLogs: canReadAttendanceLogs ? attendanceLogs : [],
      suppliers: canTrucks ? suppliers : canSeeSupplierDirectory ? suppliers : [],
      truckLogs,
      shortages,
      productCatalog,
      notes,
      handovers,
      teamMessages,
      pendingHandover,
      roleColleagues,
      summary: {
        totalEmployees: canAttendance ? employees.length : 0,
        presentCount: canAttendance ? presentCount : 0,
        onBreakCount: canAttendance ? onBreakCount : 0,
        checkedOutCount: canAttendance ? checkedOutCount : 0,
        absentCount: canAttendance
          ? Math.max(0, employees.length - presentCount - onBreakCount - checkedOutCount)
          : 0,
        lateCount: canReadAttendanceLogs ? lateCount : 0,
        unverifiedAttendanceCount: canReadAttendanceLogs ? unverifiedAttendanceCount : 0,
        unloadingTrucksCount: canTrucks ? unloadingTrucksCount : 0,
        completedTrucksCount: canTrucks ? completedTrucksCount : 0,
        issuesTrucksCount: canTrucks ? issuesTrucksCount : 0,
        openShortagesCount: canShortages ? openShortagesCount : 0,
        urgentShortagesCount: canShortages ? urgentShortagesCount : 0,
        orderedShortagesCount: canShortages ? orderedShortagesCount : 0,
        resolvedShortagesTodayCount: canShortages ? resolvedShortagesTodayCount : 0,
        urgentNotesCount: canNotes ? urgentNotesCount : 0,
        openHandoverNotesCount: canNotes ? openHandoverNotesCount : 0,
        pendingSupplierReturnsCount: canTrucks
          ? suppliers.filter((s) => Number(s.has_pending_return) === 1).length
          : 0,
      },
    };
  }

  async purgeLegacyFakeSeedData(): Promise<void> {
    for (const id of LEGACY_FAKE_USER_IDS) {
      await this.execute('DELETE FROM system_users WHERE id = ?', [id]);
    }
    for (const empId of LEGACY_FAKE_EMPLOYEE_IDS) {
      await this.execute('DELETE FROM system_users WHERE employee_id = ?', [empId]);
      await this.execute('DELETE FROM attendance_logs WHERE employee_id = ?', [empId]);
      await this.execute('DELETE FROM employees WHERE id = ?', [empId]);
    }
  }

  async exportFullBackup() {
    const tables = [
      'settings',
      'system_users',
      'role_policies',
      'employees',
      'attendance_logs',
      'suppliers',
      'truck_logs',
      'notes',
      'shift_handovers',
      'product_catalog',
      'shortages',
      'team_messages',
      'walkie_calls',
    ];
    const data: Record<string, any[]> = {};
    for (const tbl of tables) {
      data[tbl] = await this.queryAll(`SELECT * FROM ${tbl}`);
    }
    // Redact session_hmac_secret from exported settings if needed? Keepsettings intact except supabase_anon_key safe
    return {
      app: 'zayed-mart-ops',
      version: '4.0.0',
      storageMode: this.storageMode,
      exportedAt: new Date().toISOString(),
      tables: data,
    };
  }

  async importFullBackup(backupJson: any): Promise<void> {
    const tables = backupJson?.tables || {};
    const upsertRows = async (
      tableName: string,
      pk: string,
      rows: any[],
      columns: string[]
    ) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const placeholders = columns.map(() => '?').join(', ');
      const updateSet = columns
        .filter((c) => c !== pk)
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(', ');
      const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pk}) DO UPDATE SET ${updateSet}`;
      for (const row of rows) {
        if (!row || row[pk] === undefined) continue;
        const vals = columns.map((c) => (row[c] !== undefined ? row[c] : null));
        await this.execute(sql, vals);
      }
    };

    await this.withTransaction(async () => {
      await upsertRows('employees', 'id', tables.employees, [
        'id',
        'emp_code',
        'name',
        'department',
        'role_title',
        'shift_start',
        'shift_end',
        'avatar_color',
        'phone',
        'is_active',
        'system_role',
        'login_enabled',
        'updated_at',
      ]);
      await upsertRows('suppliers', 'id', tables.suppliers, [
        'id',
        'name',
        'category',
        'icon',
        'color',
        'has_pending_return',
        'pending_return_note',
        'phone',
        'is_active',
        'updated_at',
      ]);
      await upsertRows('product_catalog', 'id', tables.product_catalog, [
        'id',
        'name',
        'category',
        'default_unit',
        'supplier_id',
        'usage_count',
        'is_active',
        'updated_at',
      ]);
      await upsertRows('shortages', 'id', tables.shortages, [
        'id',
        'product_id',
        'item_name',
        'category',
        'requested_qty',
        'unit',
        'urgency',
        'status',
        'is_suggestion',
        'supplier_id',
        'supplier_name',
        'notes',
        'recorded_by',
        'recorded_by_role',
        'updated_by',
        'resolved_by',
        'resolved_at',
        'timestamp',
        'updated_at',
        'date_key',
        'synced',
      ]);
      await upsertRows('attendance_logs', 'id', tables.attendance_logs, [
        'id',
        'employee_id',
        'employee_name',
        'department',
        'action_type',
        'timestamp',
        'date_key',
        'shift_date_key',
        'late_minutes',
        'allowed_break_minutes',
        'break_duration_minutes',
        'break_reason',
        'note',
        'proof_url',
        'recorded_by',
        'verified_by_cctv',
        'verified_at',
        'synced',
      ]);
      await upsertRows('truck_logs', 'id', tables.truck_logs, [
        'id',
        'supplier_id',
        'supplier_name',
        'category',
        'plate_or_driver',
        'status',
        'arrival_time',
        'departure_time',
        'duration_minutes',
        'date_key',
        'delivery_condition',
        'invoice_number',
        'notes',
        'arrival_proof_url',
        'completion_proof_url',
        'recorded_by',
        'verified_by_cctv',
        'synced',
      ]);
      await upsertRows('notes', 'id', tables.notes, [
        'id',
        'location_tag',
        'category_tag',
        'severity',
        'dvr_timestamp',
        'content',
        'proof_url',
        'recorded_by',
        'is_open_handover',
        'resolved_by',
        'resolved_at',
        'timestamp',
        'date_key',
        'synced',
      ]);
      await upsertRows('team_messages', 'id', tables.team_messages, [
        'id',
        'channel',
        'sender_id',
        'sender_name',
        'sender_role',
        'content',
        'is_urgent',
        'is_pinned',
        'timestamp',
        'date_key',
        'synced',
      ]);
    });

    const activeEmps = await this.queryAll('SELECT * FROM employees WHERE is_active = 1');
    for (const emp of activeEmps) {
      await this.syncEmployeeLoginAccount(emp);
    }
  }
}

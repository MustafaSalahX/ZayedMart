import { createClient } from '@supabase/supabase-js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  inferDefaultRoleFromDepartment,
  ROLES_METADATA,
  ZAYED_SUPABASE_ANON_KEY,
  ZAYED_SUPABASE_URL,
} from '@zayed-mart/shared';
import {
  saveBootstrapToLocalDb,
  loadSnapshotFromLocalDb,
  loadFullLocalDatasetForRehydrate,
  clearLocalUserCacheOnLogout,
  getOutboxSyncMirror,
  loadOutboxItems,
  saveOutboxItems,
  enqueueOutboxMutation,
  applyOptimisticOutboxToSnapshot,
  updateSyncState,
} from './localDb.js';
import {
  broadcastGlobalStoreChange,
  configureCloudRealtimeFromBootstrap,
} from './supabaseRealtime.js';

const DIRECT_CLOUD_KEY = 'zayed_mart_direct_cloud_v1';
const API_BASE_URL_KEY = 'zayed_mart_api_base_url_v1';
const LITE_MODE_KEY = 'zayed_mart_lite_mode_v1';
const DEFAULT_CLOUD_API_BASE_URL = 'https://zayedmart.vercel.app';
const DEFAULT_RPC_BRIDGE_KEY =
  'zm_cloud_rpc_bridge_v2_efeioijgxjyyqplfusub_91a8f3c4e7b2d605';
const AUTH_TOKEN_KEY = 'zayed_auth_token_v3';
const AUTH_SESSION_KEY = 'zayed_auth_session_v3';
const SNAPSHOT_CACHE_KEY = 'zayed_mart_last_snapshot';

const authInvalidListeners = new Set();
let activeFlushPromise = null;

export function isNativeAndroidOrCapacitor() {
  if (typeof window === 'undefined') return false;
  if (window.Capacitor?.isNativePlatform?.()) return true;
  const proto = window.location?.protocol || '';
  if (proto === 'capacitor:' || proto === 'file:') return true;
  const host = window.location?.hostname || '';
  const port = window.location?.port || '';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if ((host === 'localhost' || host === '127.0.0.1') && !port && /Android|wv/i.test(ua)) {
    return true;
  }
  return false;
}

export function detectLowEndDevice() {
  if (typeof navigator === 'undefined') return false;
  const mem = Number(navigator.deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  const ua = navigator.userAgent || '';
  if (mem > 0 && mem <= 2) return true;
  if (cores > 0 && cores <= 4 && /Android [56789]\.|Android 10|Go Edition|; wv\)/i.test(ua)) {
    return true;
  }
  return false;
}

export function getLiteModeEnabled() {
  if (typeof window === 'undefined') return false;
  const saved = localStorage.getItem(LITE_MODE_KEY);
  if (saved === 'true') return true;
  if (saved === 'false') return false;
  return detectLowEndDevice();
}

export function setLiteModeEnabled(enabled) {
  if (typeof window === 'undefined') return;
  const flag = Boolean(enabled);
  localStorage.setItem(LITE_MODE_KEY, String(flag));
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('lite-mode', flag);
  }
}

export function getConfiguredApiBaseUrl() {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(API_BASE_URL_KEY) || '').trim().replace(/\/+$/, '');
}

export function setConfiguredApiBaseUrl(rawUrl) {
  if (typeof window === 'undefined') return '';
  const clean = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!clean) {
    localStorage.removeItem(API_BASE_URL_KEY);
    return '';
  }
  const normalized = /^https?:\/\//i.test(clean) ? clean : `http://${clean}`;
  localStorage.setItem(API_BASE_URL_KEY, normalized);
  return normalized;
}

export function resolveApiUrl(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return endpoint;
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const customBase = getConfiguredApiBaseUrl();
  if (customBase) return `${customBase}${path}`;
  const envBase = (import.meta.env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (envBase) return `${envBase}${path}`;
  if (isNativeAndroidOrCapacitor()) {
    return `${DEFAULT_CLOUD_API_BASE_URL}${path}`;
  }
  return path;
}

export function isDirectCloudToken(token) {
  if (!token) return false;
  return token === 'DIRECT_CLOUD_OWNER' || String(token).startsWith('DIRECT_CLOUD_');
}

export const ALL_PERMISSION_IDS = [
  'attendance:self',
  'attendance:kiosk',
  'attendance:read',
  'attendance:write',
  'attendance:verify',
  'trucks:read',
  'trucks:write',
  'suppliers:clear_return',
  'shortages:read',
  'shortages:write',
  'shortages:manage',
  'notes:read',
  'notes:write',
  'notes:resolve',
  'handover:manage',
  'chat:read',
  'chat:write',
  'walkie:use',
  'walkie:all_channels',
  'profile:view',
  'reports:view',
  'reports:export',
  'staff:manage',
  'suppliers:manage',
  'audit:view',
  'settings:manage',
  'backup:manage',
  'users:manage',
  'records:manage',
];

export function computeShiftDurationHoursClient(shiftStart, shiftEnd) {
  if (!shiftStart || !shiftEnd || !/^\d{2}:\d{2}$/.test(shiftStart) || !/^\d{2}:\d{2}$/.test(shiftEnd)) {
    return 12;
  }
  const [sh, sm] = shiftStart.split(':').map(Number);
  const [eh, em] = shiftEnd.split(':').map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  const hours = (endMin - startMin) / 60;
  if (hours <= 0 || hours >= 24) return 12;
  return Math.round(hours * 10) / 10;
}

export function formatShiftDurationArabicClient(hours) {
  const h = Number.isFinite(hours) && hours > 0 ? hours : 12;
  if (h >= 3 && h <= 10 && Number.isInteger(h)) {
    return `${h} ساعات`;
  }
  return `${h} ساعة`;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigitsClient(raw) {
  if (raw === null || raw === undefined) return '';
  let str = String(raw);
  for (let i = 0; i < 10; i++) {
    str = str.replaceAll(ARABIC_INDIC[i], String(i)).replaceAll(EXTENDED_ARABIC_INDIC[i], String(i));
  }
  return str;
}

export function formatRequestedQty(qty, unit = '') {
  if (qty === null || qty === undefined || qty === '') {
    return 'بدون تحديد كمية';
  }
  const num = Number(qty);
  if (Number.isNaN(num)) return 'بدون تحديد كمية';
  if (num === 0) {
    return unit ? `0 ${unit}` : 'الكمية: 0';
  }
  return unit ? `${num} ${unit}` : `${num}`;
}

function makeClientUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `zm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Check if URL hash contains a one-click cloud connection link (#cloud=base64)
function checkUrlCloudBootstrap() {
  if (typeof window === 'undefined') return;
  try {
    const hash = window.location.hash || '';
    if (hash.startsWith('#cloud=')) {
      const encoded = hash.slice('#cloud='.length);
      const decoded = JSON.parse(atob(decodeURIComponent(encoded)));
      if (decoded.url && decoded.anonKey) {
        localStorage.setItem(DIRECT_CLOUD_KEY, JSON.stringify(decoded));
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  } catch {
    // Ignore malformed hash
  }
}

checkUrlCloudBootstrap();

export function getAuthToken() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function getCachedAuthSession() {
  if (typeof window === 'undefined') return null;
  try {
    const token = getAuthToken();
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!token || !raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.user?.id) return null;
    return { token, user: parsed.user, permissions: parsed.permissions || [] };
  } catch {
    return null;
  }
}

export function setAuthSession(token, user, permissions = []) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ user, permissions }));
}

export function clearAuthSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.removeItem(SNAPSHOT_CACHE_KEY);
  clearLocalUserCacheOnLogout().catch(() => {});
}

export function onAuthInvalidated(listener) {
  authInvalidListeners.add(listener);
  return () => authInvalidListeners.delete(listener);
}

function notifyAuthInvalidated() {
  clearAuthSession();
  for (const fn of authInvalidListeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

export function hasPermission(permissions, role, perm) {
  if (role === 'owner') return true;
  return Array.isArray(permissions) && permissions.includes(perm);
}

export function hasAnyPermission(permissions, role, perms = []) {
  if (role === 'owner') return true;
  return Array.isArray(permissions) && perms.some((p) => permissions.includes(p));
}

function buildHeaders(includeJson = false) {
  const headers = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getAuthToken();
  if (token && !isDirectCloudToken(token)) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5500) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Device is currently offline');
  }
  const resolvedUrl = resolveApiUrl(url);
  if (typeof AbortController === 'undefined') {
    return fetch(resolvedUrl, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resolvedUrl, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStorePublicInfo() {
  try {
    const res = await fetchWithTimeout('/api/auth/store-info', {}, 4500);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    throw new Error('Local server unavailable');
  } catch (err) {
    const creds = getDirectCloudCredentials();
    if (creds) {
      return {
        directCloudOnly: true,
        store_name: creds.storeName || 'زايد مارت (سحابي)',
        branch_name: 'متابعة سحابية عن بُعد',
      };
    }
    const localSnap = await loadSnapshotFromLocalDb();
    if (localSnap?.settings) {
      return {
        offlineMode: true,
        store_name: localSnap.settings.store_name || 'زايد مارت',
        branch_name: localSnap.settings.branch_name || 'نسخة الهاتف المحلية (أوفلاين)',
      };
    }
    throw err;
  }
}

export async function loginWithPassword(password) {
  const normalizedPassword = normalizeDigitsClient(password).trim();
  try {
    const res = await fetchWithTimeout(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: normalizedPassword }),
      },
      6000
    );
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const serverErr = new Error(json.error || 'كلمة المرور غير صحيحة');
        serverErr.status = res.status;
        throw serverErr;
      }
      setAuthSession(json.token, json.user, json.permissions);
      return json;
    }
    throw new Error('Local server unavailable');
  } catch (err) {
    if (err.status) throw err;
    // Direct Cloud fallback when phone or browser operates without local Node server
    if (getDirectCloudCredentials()) {
      if (normalizedPassword === '123') {
        const cloudUser = {
          id: 'cloud_owner',
          username: 'admin',
          display_name: 'إدارة زايد مارت (سحابي)',
          role: 'owner',
          role_label: 'المالك / المدير العام',
          avatar_color: '#7627BB',
        };
        setAuthSession('DIRECT_CLOUD_OWNER', cloudUser, ALL_PERMISSION_IDS);
        return { ok: true, token: 'DIRECT_CLOUD_OWNER', user: cloudUser, permissions: ALL_PERMISSION_IDS };
      }

      // Check active employees in Supabase Cloud via RPC bridge or local cached snapshot!
      let matchedEmp = null;
      try {
        const rpcRows = await execDirectCloudSql(
          "SELECT * FROM employees WHERE is_active = 1 AND emp_code = ? AND COALESCE(login_enabled, 1) = 1 AND COALESCE(system_role, '') != 'none' LIMIT 1",
          [normalizedPassword]
        );
        if (rpcRows.length > 0) {
          matchedEmp = rpcRows[0];
        }
      } catch {
        // Fallback to local IndexedDB snapshot if offline
      }

      if (!matchedEmp) {
        const localSnap = await loadSnapshotFromLocalDb().catch(() => null);
        const cachedEmps = localSnap?.employees || [];
        matchedEmp = cachedEmps.find(
          (e) =>
            Number(e.is_active ?? 1) === 1 &&
            String(e.emp_code || '').trim() === normalizedPassword &&
            Number(e.login_enabled ?? 1) !== 0 &&
            e.system_role !== 'none'
        );
      }

      if (matchedEmp) {
        const resolvedRole =
          matchedEmp.system_role && ROLES_METADATA[matchedEmp.system_role]
            ? matchedEmp.system_role
            : inferDefaultRoleFromDepartment(matchedEmp.department, matchedEmp.role_title);
        const roleMeta = ROLES_METADATA[resolvedRole] || { label: resolvedRole };
        const perms =
          resolvedRole === 'owner'
            ? ALL_PERMISSION_IDS
            : DEFAULT_ROLE_PERMISSIONS[resolvedRole] || [];
        const empUser = {
          id: matchedEmp.id,
          username: `emp_${matchedEmp.emp_code}`,
          display_name: matchedEmp.name,
          role: resolvedRole,
          role_label: roleMeta.label,
          avatar_color: matchedEmp.avatar_color || '#0B57D0',
          employee_id: matchedEmp.id,
        };
        const token = `DIRECT_CLOUD_EMP_${matchedEmp.id}`;
        setAuthSession(token, empUser, perms);
        return { ok: true, token, user: empUser, permissions: perms };
      }

      throw new Error('كلمة المرور غير صحيحة');
    }
    throw new Error('تعذر الاتصال بخادم زايد مارت — تحقق من اتصال الإنترنت لتسجيل الدخول لأول مرة');
  }
}

export async function logoutSession() {
  try {
    const token = getAuthToken();
    if (token && !isDirectCloudToken(token)) {
      await fetchWithTimeout(
        '/api/auth/logout',
        {
          method: 'POST',
          headers: buildHeaders(false),
        },
        3500
      );
    }
  } catch {
    // Ignore offline logout error
  } finally {
    clearAuthSession();
  }
}

export async function lockDeviceToKiosk() {
  try {
    const res = await fetchWithTimeout(
      '/api/auth/lock-to-kiosk',
      {
        method: 'POST',
        headers: buildHeaders(false),
      },
      4500
    );
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (res.status === 401) notifyAuthInvalidated();
        throw new Error(json.error || 'تعذر قفل الجهاز على وضع الكشك');
      }
      setAuthSession(json.token, json.user, json.permissions);
      return json;
    }
  } catch (err) {
    if (err.message && err.message.includes('تعذر قفل')) throw err;
  }

  // Fallback for Direct Cloud / Offline Android Kiosk Lock
  const kioskUser = {
    id: '__DEVICE_KIOSK__',
    username: 'kiosk_device',
    display_name: 'شاشة كشك حضور العمال',
    role: 'kiosk',
    role_label: ROLES_METADATA.kiosk?.label || 'كشك حضور العمال',
    avatar_color: '#E37400',
  };
  const kioskPerms = DEFAULT_ROLE_PERMISSIONS.kiosk || ['attendance:kiosk'];
  const kioskToken = 'DIRECT_CLOUD_KIOSK';
  setAuthSession(kioskToken, kioskUser, kioskPerms);
  return { ok: true, token: kioskToken, user: kioskUser, permissions: kioskPerms };
}

export function getDirectCloudCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(DIRECT_CLOUD_KEY) || 'null');
    if (saved?.url && saved?.anonKey) return saved;
  } catch {
    // Ignore
  }
  const envUrl = import.meta.env?.VITE_SUPABASE_URL || ZAYED_SUPABASE_URL;
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ZAYED_SUPABASE_ANON_KEY;
  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey, storeName: 'زايد مارت' };
  }
  return null;
}

export function saveDirectCloudCredentials(creds) {
  if (!creds || !creds.url || !creds.anonKey) {
    localStorage.removeItem(DIRECT_CLOUD_KEY);
    return;
  }
  localStorage.setItem(DIRECT_CLOUD_KEY, JSON.stringify(creds));
}

export function buildMagicCloudShareUrl(url, anonKey, storeName = 'زايد مارت') {
  const payload = btoa(JSON.stringify({ url, anonKey, storeName }));
  return `${window.location.origin}/#cloud=${encodeURIComponent(payload)}`;
}

export function getOfflineQueue() {
  return getOutboxSyncMirror();
}

function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getSupabaseDirectClient() {
  const creds = getDirectCloudCredentials();
  if (!creds) return null;
  return createClient(creds.url, creds.anonKey, { auth: { persistSession: false } });
}

async function execDirectCloudSql(sql, params = []) {
  const creds = getDirectCloudCredentials();
  if (!creds?.url || !creds?.anonKey) {
    throw new Error('لا يوجد اتصال سحابي');
  }
  const cleanUrl = creds.url.trim().replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/rest/v1/rpc/zayed_rpc_exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: creds.anonKey,
      Authorization: `Bearer ${creds.anonKey}`,
    },
    body: JSON.stringify({
      p_key: DEFAULT_RPC_BRIDGE_KEY,
      p_sql: sql,
      p_params: params.map((p) => (p === undefined ? null : p)),
    }),
  });
  if (!res.ok) {
    throw new Error(`Supabase RPC HTTP ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json?.rows) ? json.rows : [];
}

// Build bootstrap state directly from Supabase when app runs remotely without local server
async function fetchBootstrapFromDirectCloud(dateKey) {
  const creds = getDirectCloudCredentials();
  if (!creds) throw new Error('لا يوجد اتصال بالخادم المحلي أو السحابة');

  const targetDate = dateKey || getLocalDateKey();
  let employees = [];
  let attendanceLogs = [];
  let suppliers = [];
  let truckLogs = [];
  let notes = [];
  let handovers = [];
  let shortages = [];
  let productCatalog = [];
  let teamMessages = [];

  try {
    const [empRows, attRows, supRows, truckRows, notesRows, handRows, shortRows, catRows, chatRows] =
      await Promise.all([
        execDirectCloudSql('SELECT * FROM employees WHERE is_active = 1 ORDER BY department ASC'),
        execDirectCloudSql(
          'SELECT * FROM attendance_logs WHERE date_key = ? OR shift_date_key = ? ORDER BY timestamp DESC',
          [targetDate, targetDate]
        ),
        execDirectCloudSql(
          'SELECT * FROM suppliers WHERE is_active = 1 ORDER BY has_pending_return DESC'
        ),
        execDirectCloudSql(
          "SELECT * FROM truck_logs WHERE status = 'unloading' OR date_key = ? ORDER BY arrival_time DESC",
          [targetDate]
        ),
        execDirectCloudSql(
          'SELECT * FROM notes WHERE is_open_handover = 1 OR date_key = ? ORDER BY timestamp DESC',
          [targetDate]
        ),
        execDirectCloudSql('SELECT * FROM shift_handovers ORDER BY timestamp DESC LIMIT 20'),
        execDirectCloudSql(
          "SELECT * FROM shortages WHERE status != 'resolved' OR date_key = ? ORDER BY updated_at DESC",
          [targetDate]
        ),
        execDirectCloudSql(
          'SELECT * FROM product_catalog WHERE is_active = 1 ORDER BY usage_count DESC'
        ),
        execDirectCloudSql('SELECT * FROM team_messages ORDER BY timestamp DESC LIMIT 80'),
      ]);
    employees = empRows;
    attendanceLogs = attRows;
    suppliers = supRows;
    truckLogs = truckRows;
    notes = notesRows;
    handovers = handRows;
    shortages = shortRows;
    productCatalog = catRows;
    teamMessages = chatRows;
  } catch {
    const supabase = getSupabaseDirectClient();
    if (!supabase) throw new Error('لا يوجد اتصال بالخادم المحلي أو السحابة');
    const [empRes, attRes, supRes, truckRes, notesRes, handRes, shortRes, catRes, chatRes] =
      await Promise.all([
        supabase.from('employees').select('*').eq('is_active', 1).order('department'),
        supabase
          .from('attendance_logs')
          .select('*')
          .or(`date_key.eq.${targetDate},shift_date_key.eq.${targetDate}`)
          .order('timestamp', { ascending: false }),
        supabase
          .from('suppliers')
          .select('*')
          .eq('is_active', 1)
          .order('has_pending_return', { ascending: false }),
        supabase
          .from('truck_logs')
          .select('*')
          .or(`status.eq.unloading,date_key.eq.${targetDate}`)
          .order('arrival_time', { ascending: false }),
        supabase
          .from('notes')
          .select('*')
          .or(`is_open_handover.eq.1,date_key.eq.${targetDate}`)
          .order('timestamp', { ascending: false }),
        supabase
          .from('shift_handovers')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(20),
        supabase
          .from('shortages')
          .select('*')
          .or(`status.neq.resolved,date_key.eq.${targetDate}`)
          .order('updated_at', { ascending: false }),
        supabase
          .from('product_catalog')
          .select('*')
          .eq('is_active', 1)
          .order('usage_count', { ascending: false }),
        supabase
          .from('team_messages')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(80),
      ]);

    if (empRes.error) throw new Error(empRes.error.message);
    employees = empRes.data || [];
    attendanceLogs = attRes.data || [];
    suppliers = supRes.data || [];
    truckLogs = truckRes.data || [];
    notes = notesRes.data || [];
    handovers = handRes.data || [];
    shortages = shortRes?.error ? [] : shortRes?.data || [];
    productCatalog = catRes?.error ? [] : catRes?.data || [];
    teamMessages = chatRes?.error ? [] : chatRes?.data || [];
  }

  const logsByEmp = new Map();
  for (let i = attendanceLogs.length - 1; i >= 0; i--) {
    const l = attendanceLogs[i];
    if (!logsByEmp.has(l.employee_id)) logsByEmp.set(l.employee_id, []);
    logsByEmp.get(l.employee_id).push(l);
  }

  let presentCount = 0;
  let onBreakCount = 0;
  let checkedOutCount = 0;
  let lateCount = 0;

  const enrichedEmployees = employees.map((emp) => {
    const empLogs = logsByEmp.get(emp.id) || [];
    const firstCheckIn = empLogs.find((l) => l.action_type === 'check_in');
    const latestLog = empLogs[empLogs.length - 1] || null;
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
    const lateMinutes = firstCheckIn ? firstCheckIn.late_minutes || 0 : 0;
    if (lateMinutes > 0) lateCount += 1;

    return {
      ...emp,
      currentStatus,
      shiftDateKey: latestLog?.shift_date_key || latestLog?.date_key || targetDate,
      checkInTime: firstCheckIn ? firstCheckIn.timestamp : null,
      latestActionTime: latestLog ? latestLog.timestamp : null,
      latestLogId: latestLog ? latestLog.id : null,
      latestVerified: latestLog ? Boolean(latestLog.verified_by_cctv) : false,
      lateMinutes,
      todayLogsCount: empLogs.length,
    };
  });

  const cachedAuth = getCachedAuthSession();

  const snap = {
    connectionMode: 'direct_cloud',
    dateKey: targetDate,
    serverTime: new Date().toISOString(),
    auth: cachedAuth
      ? { user: cachedAuth.user, permissions: cachedAuth.permissions }
      : {
          user: {
            id: 'cloud_owner',
            username: 'owner',
            display_name: 'إدارة زايد مارت (سحابي)',
            role: 'owner',
            role_label: 'المالك / المدير العام',
            avatar_color: '#7627BB',
          },
          permissions: ALL_PERMISSION_IDS,
        },
    settings: {
      store_name: creds?.storeName || 'زايد مارت',
      branch_name: 'متابعة سحابية عن بُعد',
      max_break_minutes: 30,
      max_unload_minutes: 60,
      cloud_sync_enabled: true,
      supabase_url: creds?.url || '',
      has_supabase_key: true,
      last_cloud_sync: new Date().toISOString(),
    },
    employees: enrichedEmployees,
    attendanceLogs,
    suppliers,
    truckLogs,
    shortages,
    productCatalog,
    notes,
    handovers,
    teamMessages,
    summary: {
      totalEmployees: employees.length,
      presentCount,
      onBreakCount,
      checkedOutCount,
      absentCount: Math.max(0, employees.length - presentCount - onBreakCount - checkedOutCount),
      lateCount,
      unverifiedAttendanceCount: attendanceLogs.filter((l) => !l.verified_by_cctv).length,
      unloadingTrucksCount: truckLogs.filter((t) => t.status === 'unloading').length,
      completedTrucksCount: truckLogs.filter(
        (t) => t.status === 'completed' && t.date_key === targetDate
      ).length,
      issuesTrucksCount: truckLogs.filter(
        (t) =>
          t.date_key === targetDate &&
          (t.delivery_condition === 'shortage' || t.delivery_condition === 'return_damaged')
      ).length,
      openShortagesCount: shortages.filter((s) => s.status === 'open').length,
      orderedShortagesCount: shortages.filter((s) => s.status === 'ordered').length,
      resolvedTodayShortagesCount: shortages.filter(
        (s) => s.status === 'resolved' && s.date_key === targetDate
      ).length,
      outOfStockShortagesCount: shortages.filter(
        (s) => s.status !== 'resolved' && s.urgency === 'out_of_stock'
      ).length,
      urgentNotesCount: notes.filter((n) => n.severity === 'urgent' && n.date_key === targetDate)
        .length,
      openHandoverNotesCount: notes.filter((n) => n.is_open_handover === 1).length,
    },
  };

  await saveBootstrapToLocalDb(snap);
  updateSyncState({
    online: true,
    connectionMode: 'direct_cloud',
    lastSyncedAt: new Date().toISOString(),
  });
  return snap;
}

export async function flushOfflineQueue() {
  if (activeFlushPromise) return activeFlushPromise;

  activeFlushPromise = (async () => {
    const queue = await loadOutboxItems();
    if (queue.length === 0) {
      updateSyncState({ syncing: false, pendingCount: 0 });
      return 0;
    }
    if (!getAuthToken()) return 0;

    updateSyncState({ syncing: true, pendingCount: queue.length });

    const remaining = [];
    let flushed = 0;

    for (const item of queue) {
      try {
        let body = { ...item.body };
        if (body._offlineDataUrl) {
          const upRes = await fetchWithTimeout(
            '/api/upload',
            {
              method: 'POST',
              headers: buildHeaders(true),
              body: JSON.stringify({ dataUrl: body._offlineDataUrl, prefix: 'offline' }),
            },
            8000
          );
          if (upRes.ok) {
            const upJson = await upRes.json();
            if (body._proofField) {
              body[body._proofField] = upJson.url;
            }
          }
          delete body._offlineDataUrl;
          delete body._proofField;
        }

        const res = await fetchWithTimeout(
          item.endpoint,
          {
            method: item.method || 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify(body),
          },
          6000
        );

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          flushed += 1;
        } else if (getDirectCloudCredentials() && !contentType.includes('application/json')) {
          await executeDirectCloudMutation(item.endpoint, body);
          flushed += 1;
        } else if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 404) {
          // Drop invalid/unauthorized items so they never block the queue forever
          if (res.status === 401) notifyAuthInvalidated();
        } else {
          remaining.push(item);
        }
      } catch {
        remaining.push(item);
      }
    }

    await saveOutboxItems(remaining);
    updateSyncState({
      syncing: false,
      pendingCount: remaining.length,
      lastSyncedAt: flushed > 0 ? new Date().toISOString() : undefined,
    });
    if (flushed > 0) {
      broadcastGlobalStoreChange('offline_flush');
    }
    return flushed;
  })();

  try {
    return await activeFlushPromise;
  } finally {
    activeFlushPromise = null;
  }
}

export async function fetchBootstrap(dateKey) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Offline mode active');
    }

    // 1. Flush any offline mutations first when online
    await flushOfflineQueue();

    const qs = dateKey ? `?date=${encodeURIComponent(dateKey)}` : '';
    const res = await fetchWithTimeout(
      `/api/bootstrap${qs}`,
      {
        headers: buildHeaders(false),
      },
      6000
    );
    const contentType = res.headers.get('content-type') || '';

    if (res.status === 401 && contentType.includes('application/json')) {
      notifyAuthInvalidated();
      const errJson = await res.json();
      const authErr = new Error(errJson.error || 'يلزم تسجيل الدخول');
      authErr.code = 'UNAUTHENTICATED';
      authErr.isServerResponse = true;
      throw authErr;
    }

    if (res.ok && contentType.includes('application/json')) {
      const json = await res.json();
      if (json.auth?.user) {
        setAuthSession(getAuthToken(), json.auth.user, json.auth.permissions || []);
      }
      if (json.cloudRealtime) {
        configureCloudRealtimeFromBootstrap(json.cloudRealtime);
      }

      const resolvedConnMode =
        json.storageMode === 'supabase_postgres' ? 'cloud_postgres' : 'local_server';
      const pendingOutbox = await loadOutboxItems();
      const merged = applyOptimisticOutboxToSnapshot(
        { ...json, connectionMode: resolvedConnMode },
        pendingOutbox
      );

      await saveBootstrapToLocalDb(merged);
      updateSyncState({
        online: true,
        connectionMode: resolvedConnMode,
        pendingCount: pendingOutbox.length,
        lastSyncedAt: new Date().toISOString(),
      });
      return merged;
    }
    throw new Error('Local server unavailable');
  } catch (err) {
    if (err.code === 'UNAUTHENTICATED' || err.isServerResponse) {
      throw err;
    }
    // Fallback 1: Direct Cloud mode if configured (e.g. Owner's phone outside branch)
    if (getDirectCloudCredentials() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      try {
        const cloudSnap = await fetchBootstrapFromDirectCloud(dateKey);
        const pendingOutbox = await loadOutboxItems();
        return applyOptimisticOutboxToSnapshot(cloudSnap, pendingOutbox);
      } catch {
        // Fall through to IndexedDB offline snapshot if internet is also down!
      }
    }

    // Fallback 2: Full Local-First IndexedDB Snapshot + Optimistic Outbox!
    if (getAuthToken()) {
      const localSnap = await loadSnapshotFromLocalDb(dateKey);
      if (localSnap) {
        const pendingOutbox = await loadOutboxItems();
        updateSyncState({
          online: false,
          connectionMode: 'offline_cached',
          pendingCount: pendingOutbox.length,
        });
        return applyOptimisticOutboxToSnapshot(
          { ...localSnap, connectionMode: 'offline_cached' },
          pendingOutbox
        );
      }
    }
    throw err;
  }
}

export async function uploadProofImage(dataUrl, prefix = 'proof') {
  if (!dataUrl) return '';
  try {
    const res = await fetchWithTimeout(
      '/api/upload',
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({ dataUrl, prefix }),
      },
      9000
    );
    if (res.status === 401) {
      notifyAuthInvalidated();
      return '';
    }
    if (res.ok) {
      const json = await res.json();
      return json.url;
    }
  } catch {
    const supabase = getSupabaseDirectClient();
    if (supabase) {
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const fileName = `${prefix}_${Date.now()}.jpg`;
        const { error } = await supabase.storage
          .from('zayed-proofs')
          .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
        if (!error) {
          const { data } = supabase.storage.from('zayed-proofs').getPublicUrl(fileName);
          return data?.publicUrl || dataUrl;
        }
      } catch {
        // Fallback to inline dataUrl
      }
    }
  }
  return dataUrl;
}

// Resolve QR / Employee Quick-Scan offline using IndexedDB cached employees!
async function enqueueOfflineQuickScan(body, actorSession) {
  const localSnap = await loadSnapshotFromLocalDb();
  const employees = localSnap?.employees || [];
  const raw = normalizeDigitsClient(String(body?.code_or_qr || '').trim());
  let emp = null;
  if (raw.toUpperCase().startsWith('ZMART:EMP:')) {
    const empId = raw.slice('ZMART:EMP:'.length).trim();
    emp = employees.find((e) => e.id === empId);
  } else {
    emp = employees.find((e) => String(e.emp_code || '').trim() === raw);
  }

  if (!emp) {
    throw new Error('لم يتم العثور على الموظف محلياً — تأكد من الكود أو اتصل بالإنترنت لتحديث القائمة');
  }

  let nextAction = body.preferred_action || '';
  if (!nextAction) {
    if (emp.currentStatus === 'present') nextAction = 'check_out';
    else if (emp.currentStatus === 'on_break') nextAction = 'break_end';
    else nextAction = 'check_in';
  }

  const nowIso = new Date().toISOString();
  await enqueueOutboxMutation({
    endpoint: '/api/attendance',
    method: 'POST',
    body: {
      id: makeClientUuid(),
      employee_id: emp.id,
      employee_name: emp.name,
      action_type: nextAction,
      timestamp: nowIso,
      note: 'مسح بطاقة سريع (مسجل أوفلاين)',
    },
    actorName: actorSession?.user?.display_name || 'جهاز الموبايل',
    actorRole: actorSession?.user?.role || '',
  });

  return {
    ok: true,
    queuedOffline: true,
    employee: emp,
    nextAction,
    log: {
      employee_id: emp.id,
      employee_name: emp.name,
      action_type: nextAction,
      timestamp: nowIso,
    },
  };
}

const OFFLINE_QUEUEABLE_ENDPOINTS = [
  '/api/attendance',
  '/api/attendance/quick-scan',
  '/api/trucks/arrive',
  '/api/notes',
  '/api/shortages',
  '/api/shortages/clear-resolved',
  '/api/team-messages',
  '/api/employees',
  '/api/suppliers',
  '/api/handovers',
];

function isEndpointQueueableOffline(endpoint, method = 'POST') {
  if (OFFLINE_QUEUEABLE_ENDPOINTS.includes(endpoint) && method === 'POST') return true;
  if (endpoint.startsWith('/api/attendance/') && (method === 'POST' || method === 'DELETE'))
    return true;
  if (
    endpoint.startsWith('/api/shortages/') &&
    (method === 'PUT' || method === 'POST' || method === 'DELETE')
  )
    return true;
  if (
    endpoint.startsWith('/api/trucks/') &&
    (method === 'POST' || method === 'DELETE')
  )
    return true;
  if (endpoint.startsWith('/api/notes/') && (method === 'POST' || method === 'DELETE'))
    return true;
  if (
    endpoint.startsWith('/api/employees/') &&
    (method === 'PUT' || method === 'DELETE')
  )
    return true;
  if (
    endpoint.startsWith('/api/suppliers/') &&
    (method === 'PUT' || method === 'POST' || method === 'DELETE')
  )
    return true;
  if (endpoint.startsWith('/api/handovers/') && method === 'POST') return true;
  if (
    endpoint.startsWith('/api/team-messages/') &&
    (method === 'POST' || method === 'DELETE')
  )
    return true;
  return false;
}

export async function postActionWithOfflineSupport(endpoint, body, options = {}) {
  const { rawDataUrl, proofField } = options;
  const recordId = body?.id || makeClientUuid();

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Device is currently offline');
    }

    let finalBody = { ...body, id: recordId };
    if (rawDataUrl && proofField) {
      finalBody[proofField] = await uploadProofImage(rawDataUrl, proofField);
    }

    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(finalBody),
      },
      5500
    );

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const result = await res.json();
      broadcastGlobalStoreChange(endpoint);
      return result;
    }

    // Direct Cloud Mode when running without backend API
    if (getDirectCloudCredentials() && !contentType.includes('application/json')) {
      return await executeDirectCloudMutation(endpoint, finalBody);
    }

    const errJson = contentType.includes('application/json') ? await res.json() : {};
    if (res.status === 401) {
      notifyAuthInvalidated();
    }
    const serverErr = new Error(errJson.error || 'تعذر تنفيذ العملية');
    serverErr.isServerResponse = true;
    serverErr.status = res.status;
    throw serverErr;
  } catch (err) {
    if (err.isServerResponse) {
      throw err;
    }

    const session = getCachedAuthSession();

    // Try Direct Cloud RPC if device is online but local LAN server is unreachable
    if (
      getDirectCloudCredentials() &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    ) {
      try {
        const directRes = await executeDirectCloudMutation(endpoint, { ...body, id: recordId });
        broadcastGlobalStoreChange(endpoint);
        return directRes;
      } catch {
        // Fall through to offline outbox queue
      }
    }

    // Special local resolution for QR / Quick-Scan while offline!
    if (endpoint === '/api/attendance/quick-scan') {
      return await enqueueOfflineQuickScan(body, session);
    }

    // Queue any operational mutation into IndexedDB outbox when internet is down!
    if (isEndpointQueueableOffline(endpoint, 'POST')) {
      const offlineBody = { ...body, id: recordId, timestamp: body?.timestamp || new Date().toISOString() };
      if (rawDataUrl && proofField) {
        offlineBody._offlineDataUrl = rawDataUrl;
        offlineBody._proofField = proofField;
      }
      await enqueueOutboxMutation({
        endpoint,
        method: 'POST',
        body: offlineBody,
        actorName: session?.user?.display_name || '',
        actorRole: session?.user?.role || '',
      });
      return { ok: true, queuedOffline: true, id: recordId };
    }
    throw err;
  }
}

async function executeDirectCloudMutation(endpoint, body) {
  const creds = getDirectCloudCredentials();
  if (!creds) throw new Error('لا يوجد اتصال سحابي');

  const session = getCachedAuthSession();
  const actorName = body.recorded_by || session?.user?.display_name || 'جهاز الموبايل (سحابي)';
  const actorRole = session?.user?.role || 'owner';
  const now = new Date();
  const iso = body.timestamp || now.toISOString();
  const dateKey = getLocalDateKey(new Date(iso));
  const id = body.id || makeClientUuid();

  if (endpoint === '/api/attendance') {
    const row = {
      id,
      employee_id: body.employee_id,
      employee_name: body.employee_name || 'موظف',
      department: body.department || '',
      action_type: body.action_type,
      timestamp: iso,
      date_key: dateKey,
      shift_date_key: dateKey,
      late_minutes: 0,
      allowed_break_minutes: Number(body.allowed_break_minutes) || 0,
      break_duration_minutes: 0,
      break_reason: body.break_reason || '',
      note: body.note || '',
      proof_url: body.proof_url || '',
      recorded_by: actorName,
      verified_by_cctv: 0,
      synced: 1,
    };
    try {
      await execDirectCloudSql(
        `INSERT INTO attendance_logs (
          id, employee_id, employee_name, department, action_type, timestamp, date_key, shift_date_key,
          late_minutes, allowed_break_minutes, break_duration_minutes, break_reason, note, proof_url,
          recorded_by, verified_by_cctv, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.employee_id,
          row.employee_name,
          row.department,
          row.action_type,
          row.timestamp,
          row.date_key,
          row.shift_date_key,
          row.late_minutes,
          row.allowed_break_minutes,
          row.break_duration_minutes,
          row.break_reason,
          row.note,
          row.proof_url,
          row.recorded_by,
          row.verified_by_cctv,
        ]
      );
    } catch {
      const supabase = getSupabaseDirectClient();
      const { error } = await supabase.from('attendance_logs').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    return { ok: true, log: row };
  }

  if (endpoint === '/api/trucks/arrive') {
    const row = {
      id,
      supplier_id: body.supplier_id || '',
      supplier_name: body.supplier_name || 'مورد',
      category: body.category || 'بقالة جافة',
      plate_or_driver: body.plate_or_driver || '',
      status: 'unloading',
      arrival_time: iso,
      departure_time: '',
      duration_minutes: 0,
      date_key: dateKey,
      delivery_condition: 'pending',
      invoice_number: body.invoice_number || '',
      notes: body.notes || '',
      arrival_proof_url: body.arrival_proof_url || '',
      completion_proof_url: '',
      recorded_by: actorName,
      verified_by_cctv: 0,
      synced: 1,
    };
    await execDirectCloudSql(
      `INSERT INTO truck_logs (
        id, supplier_id, supplier_name, category, plate_or_driver, status, arrival_time,
        departure_time, duration_minutes, date_key, delivery_condition, invoice_number, notes,
        arrival_proof_url, completion_proof_url, recorded_by, verified_by_cctv, synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 0, ?, 'pending', ?, ?, ?, '', ?, 0, 1)
      ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.supplier_id,
        row.supplier_name,
        row.category,
        row.plate_or_driver,
        row.status,
        row.arrival_time,
        row.date_key,
        row.invoice_number,
        row.notes,
        row.arrival_proof_url,
        row.recorded_by,
      ]
    );
    return { ok: true, log: row };
  }

  if (endpoint === '/api/notes') {
    const row = {
      id,
      location_tag: body.location_tag || 'الإدارة عن بُعد',
      category_tag: body.category_tag || 'ملاحظة عامة',
      severity: body.severity || 'normal',
      dvr_timestamp: body.dvr_timestamp || now.toTimeString().slice(0, 8),
      content: body.content || 'ملاحظة إدارية',
      proof_url: body.proof_url || '',
      recorded_by: actorName,
      is_open_handover: body.is_open_handover ? 1 : 0,
      resolved_by: '',
      resolved_at: '',
      timestamp: iso,
      date_key: dateKey,
      synced: 1,
    };
    try {
      await execDirectCloudSql(
        `INSERT INTO notes (
          id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
          recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, 1)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.location_tag,
          row.category_tag,
          row.severity,
          row.dvr_timestamp,
          row.content,
          row.proof_url,
          row.recorded_by,
          row.is_open_handover,
          row.timestamp,
          row.date_key,
        ]
      );
    } catch {
      const supabase = getSupabaseDirectClient();
      const { error } = await supabase.from('notes').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    return { ok: true, note: row };
  }

  if (endpoint === '/api/shortages') {
    const rawQty = body.requested_qty;
    let parsedQty = null;
    if (rawQty !== null && rawQty !== undefined && String(rawQty).trim() !== '') {
      const n = Number(normalizeDigitsClient(rawQty));
      if (!Number.isNaN(n) && n >= 0) parsedQty = n;
    }
    const row = {
      id,
      product_id: body.product_id || '',
      item_name: body.item_name || 'صنف ناقص',
      category: body.category || 'بقالة جافة',
      requested_qty: parsedQty,
      unit: body.unit || '',
      urgency: body.urgency || 'out_of_stock',
      status: 'open',
      is_suggestion: body.is_suggestion ? 1 : 0,
      supplier_id: body.supplier_id || '',
      supplier_name: body.supplier_name || '',
      notes: body.notes || '',
      recorded_by: actorName,
      recorded_by_role: actorRole,
      updated_by: '',
      resolved_by: '',
      resolved_at: '',
      timestamp: iso,
      updated_at: iso,
      date_key: dateKey,
      synced: 1,
    };
    try {
      await execDirectCloudSql(
        `INSERT INTO shortages (
          id, product_id, item_name, category, requested_qty, unit, urgency, status, is_suggestion,
          supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by, resolved_by,
          resolved_at, timestamp, updated_at, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, 1)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.product_id,
          row.item_name,
          row.category,
          row.requested_qty,
          row.unit,
          row.urgency,
          row.is_suggestion,
          row.supplier_id,
          row.supplier_name,
          row.notes,
          row.recorded_by,
          row.recorded_by_role,
          row.timestamp,
          row.updated_at,
          row.date_key,
        ]
      );
    } catch {
      const supabase = getSupabaseDirectClient();
      const { error } = await supabase.from('shortages').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    return { ok: true, shortage: row };
  }

  if (endpoint === '/api/team-messages') {
    const row = {
      id,
      channel: body.channel || 'general',
      sender_id: session?.user?.id || 'cloud_owner',
      sender_name: body.sender_name || actorName,
      sender_role: actorRole,
      content: body.content || body.message || '',
      is_urgent: body.is_urgent || body.priority === 'urgent' ? 1 : 0,
      is_pinned: body.is_pinned ? 1 : 0,
      timestamp: iso,
      date_key: dateKey,
      synced: 1,
    };
    try {
      await execDirectCloudSql(
        `INSERT INTO team_messages (
          id, channel, sender_id, sender_name, sender_role, content, is_urgent, is_pinned, timestamp, date_key, synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.channel,
          row.sender_id,
          row.sender_name,
          row.sender_role,
          row.content,
          row.is_urgent,
          row.is_pinned,
          row.timestamp,
          row.date_key,
        ]
      );
    } catch {
      const supabase = getSupabaseDirectClient();
      const { error } = await supabase.from('team_messages').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    return { ok: true, message: row };
  }

  if (endpoint === '/api/employees') {
    const row = {
      id,
      emp_code: body.emp_code || '',
      name: body.name,
      department: body.department || 'كاشير',
      role_title: body.role_title || '',
      shift_start: body.shift_start || '08:00',
      shift_end: body.shift_end || '20:00',
      avatar_color: body.avatar_color || '#1A73E8',
      phone: body.phone || '',
      is_active: 1,
      updated_at: iso,
    };
    try {
      await execDirectCloudSql(
        `INSERT INTO employees (
          id, emp_code, name, department, role_title, shift_start, shift_end, avatar_color, phone, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          department = EXCLUDED.department,
          role_title = EXCLUDED.role_title,
          shift_start = EXCLUDED.shift_start,
          shift_end = EXCLUDED.shift_end,
          phone = EXCLUDED.phone,
          updated_at = EXCLUDED.updated_at`,
        [
          row.id,
          row.emp_code,
          row.name,
          row.department,
          row.role_title,
          row.shift_start,
          row.shift_end,
          row.avatar_color,
          row.phone,
          row.updated_at,
        ]
      );
    } catch {
      const supabase = getSupabaseDirectClient();
      const { error } = await supabase.from('employees').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    }
    return { ok: true, employee: row };
  }

  throw new Error('هذه العملية تتطلب الاتصال بخادم الماركت أو لوحة السحابة');
}

export async function apiRequest(endpoint, method = 'GET', body) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Device is currently offline');
    }

    const res = await fetchWithTimeout(
      endpoint,
      {
        method,
        headers: buildHeaders(Boolean(body)),
        body: body ? JSON.stringify(body) : undefined,
      },
      5500
    );
    const contentType = res.headers.get('content-type') || '';
    const json = contentType.includes('application/json') ? await res.json() : {};
    if (!res.ok) {
      if (res.status === 401) {
        notifyAuthInvalidated();
      }
      const serverErr = new Error(json.error || 'حدث خطأ غير متوقع');
      serverErr.isServerResponse = contentType.includes('application/json');
      serverErr.status = res.status;
      throw serverErr;
    }
    if (method !== 'GET' && !endpoint.startsWith('/api/walkie/')) {
      broadcastGlobalStoreChange(endpoint);
    }
    return json;
  } catch (err) {
    if (err.isServerResponse) throw err;

    // Queue operational updates/creates into IndexedDB outbox when offline!
    if (method !== 'GET' && isEndpointQueueableOffline(endpoint, method)) {
      const session = getCachedAuthSession();
      const recordId = body?.id || makeClientUuid();
      await enqueueOutboxMutation({
        endpoint,
        method,
        body: { ...(body || {}), id: recordId },
        actorName: session?.user?.display_name || '',
        actorRole: session?.user?.role || '',
      });
      return { ok: true, queuedOffline: true, id: recordId };
    }
    throw err;
  }
}

export async function fetchMyProfile() {
  return apiRequest('/api/profile/me', 'GET');
}

export async function fetchPersonLog(personId) {
  return apiRequest(`/api/logs/person/${encodeURIComponent(personId)}`, 'GET');
}

export async function fetchMasterAuditLogs(params = {}) {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.action) searchParams.set('action', params.action);
  if (params.role) searchParams.set('role', params.role);
  if (params.q) searchParams.set('q', params.q);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  const qs = searchParams.toString();
  return apiRequest(`/api/audit-logs${qs ? `?${qs}` : ''}`, 'GET');
}

export async function clearMasterAuditLogs() {
  return apiRequest('/api/audit-logs', 'DELETE');
}

export async function purgeFakeData() {
  return apiRequest('/api/system/purge-fake-data', 'POST');
}

export async function fetchTeamMessages(channel = 'all') {
  const qs = channel && channel !== 'all' ? `?channel=${encodeURIComponent(channel)}` : '';
  return apiRequest(`/api/team-messages${qs}`, 'GET');
}

export async function sendTeamMessage(payload) {
  return postActionWithOfflineSupport('/api/team-messages', payload);
}

export async function togglePinTeamMessage(id) {
  return apiRequest(`/api/team-messages/${encodeURIComponent(id)}/pin`, 'POST');
}

export async function deleteTeamMessage(id) {
  return apiRequest(`/api/team-messages/${encodeURIComponent(id)}`, 'DELETE');
}

// ============================================================================
// WALKIE-TALKIE (PUSH-TO-TALK RADIO API & DIRECT CLOUD REALTIME)
// ============================================================================

export function createWalkieRealtimeChannel(channelName = 'zayed_walkie_live_v1') {
  const supabase = getSupabaseDirectClient();
  if (!supabase) return null;
  try {
    return {
      supabase,
      channel: supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      }),
    };
  } catch {
    return null;
  }
}

export async function updateWalkiePresence(payload) {
  try {
    const res = await fetchWithTimeout(
      '/api/walkie/presence',
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(payload || {}),
      },
      4500
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    if (res.status === 404) {
      return { ok: false, routeMissing: true, activeUnits: [] };
    }
    if (res.status === 401 && contentType.includes('application/json')) {
      notifyAuthInvalidated();
    }
    return { ok: false, activeUnits: [] };
  } catch {
    return { ok: false, activeUnits: [] };
  }
}

export async function sendWalkieSignal(payload) {
  try {
    const res = await fetchWithTimeout(
      '/api/walkie/signal',
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(payload || {}),
      },
      4500
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    if (res.status === 404) {
      return { ok: false, routeMissing: true };
    }
    if (res.status === 401 && contentType.includes('application/json')) {
      notifyAuthInvalidated();
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function sendWalkieLiveFrame(payload) {
  try {
    const res = await fetchWithTimeout(
      '/api/walkie/live-frame',
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(payload || {}),
      },
      3500
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    if (res.status === 404) {
      return { ok: false, routeMissing: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function transmitWalkieCall(payload) {
  const callId = payload?.id || makeClientUuid();
  const finalPayload = { ...payload, id: callId };
  try {
    const res = await fetchWithTimeout(
      '/api/walkie/transmit',
      {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(finalPayload),
      },
      7500
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    if (getDirectCloudCredentials() && !contentType.includes('application/json')) {
      const session = getCachedAuthSession();
      const now = new Date();
      const row = {
        id: callId,
        channel: finalPayload.channel || 'security',
        kind: finalPayload.kind || 'voice',
        sender_id: session?.user?.id || 'cloud_owner',
        sender_name: session?.user?.display_name || 'الأمن',
        sender_role: session?.user?.role || 'security',
        audio_data: finalPayload.audio_data || '',
        mime_type: finalPayload.mime_type || 'audio/webm',
        duration_sec: Number(finalPayload.duration_sec) || 0,
        is_emergency: finalPayload.is_emergency ? 1 : 0,
        timestamp: now.toISOString(),
        date_key: getLocalDateKey(now),
        synced: 1,
      };
      try {
        await execDirectCloudSql(
          `INSERT INTO walkie_calls (
            id, channel, kind, sender_id, sender_name, sender_role, audio_data, mime_type, duration_sec, is_emergency, timestamp, date_key, synced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            row.channel,
            row.kind,
            row.sender_id,
            row.sender_name,
            row.sender_role,
            row.audio_data,
            row.mime_type,
            row.duration_sec,
            row.is_emergency,
            row.timestamp,
            row.date_key,
          ]
        );
      } catch {
        const supabase = getSupabaseDirectClient();
        await supabase?.from('walkie_calls').upsert(row, { onConflict: 'id' });
      }
      return { ok: true, call: row, activeUnits: [] };
    }
    const errJson = contentType.includes('application/json') ? await res.json() : {};
    if (res.status === 401) notifyAuthInvalidated();
    throw new Error(errJson.error || 'تعذر إرسال النداء اللاسلكي');
  } catch (err) {
    throw new Error(err.message || 'تعذر إرسال النداء — تحقق من الاتصال بالشبكة');
  }
}

export async function pollWalkieChannel({
  channel = 'security',
  since = '',
  listening = true,
  peerId = '',
  liveOn = false,
  lastFrameSeq = undefined,
} = {}) {
  const params = new URLSearchParams();
  params.set('channel', channel);
  if (since) params.set('since', since);
  if (listening) params.set('listening', '1');
  if (peerId) params.set('peer_id', peerId);
  if (liveOn) params.set('live_on', '1');
  if (lastFrameSeq !== undefined && lastFrameSeq !== null && lastFrameSeq !== '') {
    params.set('last_frame_seq', String(lastFrameSeq));
  }

  try {
    const res = await fetchWithTimeout(
      `/api/walkie/poll?${params.toString()}`,
      {
        headers: buildHeaders(false),
      },
      4500
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }
    if (res.status === 404) {
      return {
        ok: false,
        routeMissing: true,
        calls: [],
        signals: [],
        liveFrames: [],
        activeUnits: [],
      };
    }
    if (res.status === 401 && contentType.includes('application/json')) {
      notifyAuthInvalidated();
      return { ok: false, calls: [], signals: [], liveFrames: [], activeUnits: [] };
    }
    if (getDirectCloudCredentials() && !contentType.includes('application/json')) {
      try {
        const rows = since
          ? await execDirectCloudSql(
              "SELECT * FROM walkie_calls WHERE (channel = ? OR channel = 'emergency') AND timestamp > ? ORDER BY timestamp ASC LIMIT 20",
              [channel, since]
            )
          : await execDirectCloudSql(
              "SELECT * FROM walkie_calls WHERE (channel = ? OR channel = 'emergency') ORDER BY timestamp DESC LIMIT 20",
              [channel]
            );
        return {
          ok: true,
          serverTime: new Date().toISOString(),
          channel,
          allowedChannels: ['security', 'warehouse', 'floor', 'emergency'],
          calls: rows || [],
          signals: [],
          liveFrames: [],
          activeUnits: [],
        };
      } catch {
        // ignore
      }
    }
    return { ok: false, calls: [], signals: [], liveFrames: [], activeUnits: [] };
  } catch {
    return { ok: false, calls: [], signals: [], liveFrames: [], activeUnits: [] };
  }
}

export async function deleteWalkieCall(id) {
  return apiRequest(`/api/walkie/calls/${encodeURIComponent(id)}`, 'DELETE');
}

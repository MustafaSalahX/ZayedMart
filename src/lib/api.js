import { createClient } from '@supabase/supabase-js';

const OFFLINE_QUEUE_KEY = 'zayed_mart_offline_queue_v1';
const DIRECT_CLOUD_KEY = 'zayed_mart_direct_cloud_v1';
const AUTH_TOKEN_KEY = 'zayed_auth_token_v3';
const AUTH_SESSION_KEY = 'zayed_auth_session_v3';
const SNAPSHOT_CACHE_KEY = 'zayed_mart_last_snapshot';

const authInvalidListeners = new Set();

export const ALL_PERMISSION_IDS = [
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
  if (token && token !== 'DIRECT_CLOUD_OWNER') {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function fetchStorePublicInfo() {
  try {
    const res = await fetch('/api/auth/store-info');
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
    throw err;
  }
}

export async function loginWithPassword(password) {
  const normalizedPassword = normalizeDigitsClient(password).trim();
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: normalizedPassword }),
    });
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
    // Direct Cloud fallback when owner opens remote link on phone without LAN server
    if (getDirectCloudCredentials()) {
      if (normalizedPassword !== '123') {
        throw new Error('كلمة المرور غير صحيحة');
      }
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
    throw new Error('تعذر الاتصال بخادم زايد مارت');
  }
}

export async function logoutSession() {
  try {
    const token = getAuthToken();
    if (token && token !== 'DIRECT_CLOUD_OWNER') {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: buildHeaders(false),
      });
    }
  } catch {
    // Ignore offline logout error
  } finally {
    clearAuthSession();
  }
}

export async function lockDeviceToKiosk() {
  const res = await fetch('/api/auth/lock-to-kiosk', {
    method: 'POST',
    headers: buildHeaders(false),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    if (res.status === 401) notifyAuthInvalidated();
    throw new Error(json.error || 'تعذر قفل الجهاز على وضع الكشك');
  }
  setAuthSession(json.token, json.user, json.permissions);
  return json;
}

export function getDirectCloudCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(DIRECT_CLOUD_KEY) || 'null');
    if (saved?.url && saved?.anonKey) return saved;
  } catch {
    // Ignore
  }
  const envUrl = import.meta.env?.VITE_SUPABASE_URL;
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey, storeName: 'زايد مارت (سحابي)' };
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
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function setOfflineQueue(items) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

function enqueueOfflineRequest(endpoint, method, body) {
  const q = getOfflineQueue();
  q.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    endpoint,
    method,
    body,
    queuedAt: new Date().toISOString(),
  });
  setOfflineQueue(q);
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

// Build bootstrap state directly from Supabase when owner opens app remotely without local server
async function fetchBootstrapFromDirectCloud(dateKey) {
  const supabase = getSupabaseDirectClient();
  if (!supabase) throw new Error('لا يوجد اتصال بالخادم المحلي أو السحابة');

  const targetDate = dateKey || getLocalDateKey();

  const [empRes, attRes, supRes, truckRes, notesRes, handRes, shortRes, catRes] = await Promise.all([
    supabase.from('employees').select('*').eq('is_active', 1).order('department'),
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('date_key', targetDate)
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
    supabase.from('shift_handovers').select('*').order('timestamp', { ascending: false }).limit(20),
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
  ]);

  if (empRes.error) throw new Error(empRes.error.message);

  const employees = empRes.data || [];
  const attendanceLogs = attRes.data || [];
  const suppliers = supRes.data || [];
  const truckLogs = truckRes.data || [];
  const notes = notesRes.data || [];
  const handovers = handRes.data || [];
  const shortages = shortRes?.error ? [] : shortRes?.data || [];
  const productCatalog = catRes?.error ? [] : catRes?.data || [];

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
      checkInTime: firstCheckIn ? firstCheckIn.timestamp : null,
      latestActionTime: latestLog ? latestLog.timestamp : null,
      latestLogId: latestLog ? latestLog.id : null,
      latestVerified: latestLog ? Boolean(latestLog.verified_by_cctv) : false,
      lateMinutes,
      todayLogsCount: empLogs.length,
    };
  });

  const creds = getDirectCloudCredentials();
  const cachedAuth = getCachedAuthSession();

  return {
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
}

export async function flushOfflineQueue() {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;
  if (!getAuthToken()) return 0;

  const remaining = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      let body = { ...item.body };
      if (body._offlineDataUrl) {
        const upRes = await fetch('/api/upload', {
          method: 'POST',
          headers: buildHeaders(true),
          body: JSON.stringify({ dataUrl: body._offlineDataUrl, prefix: 'offline' }),
        });
        if (upRes.ok) {
          const upJson = await upRes.json();
          if (body._proofField) {
            body[body._proofField] = upJson.url;
          }
        }
        delete body._offlineDataUrl;
        delete body._proofField;
      }

      const res = await fetch(item.endpoint, {
        method: item.method,
        headers: buildHeaders(true),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        flushed += 1;
      } else if (res.status === 401 || res.status === 403 || res.status === 400) {
        // Drop forbidden/invalid queued items so they don't loop forever
        if (res.status === 401) notifyAuthInvalidated();
      } else {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  setOfflineQueue(remaining);
  return flushed;
}

export async function fetchBootstrap(dateKey) {
  try {
    await flushOfflineQueue();
    const qs = dateKey ? `?date=${encodeURIComponent(dateKey)}` : '';
    const res = await fetch(`/api/bootstrap${qs}`, {
      headers: buildHeaders(false),
    });
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
      localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(json));
      return { ...json, connectionMode: 'local_server' };
    }
    throw new Error('Local server unavailable');
  } catch (err) {
    if (err.code === 'UNAUTHENTICATED' || err.isServerResponse) {
      throw err;
    }
    // Fallback 1: Direct Cloud mode if configured (e.g. Owner's phone outside branch / Vercel)
    if (getDirectCloudCredentials()) {
      return await fetchBootstrapFromDirectCloud(dateKey);
    }
    // Fallback 2: Cached offline snapshot (only when user already has an active session token)
    const cached = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    if (cached && getAuthToken()) {
      return { ...JSON.parse(cached), connectionMode: 'offline_cached' };
    }
    throw err;
  }
}

export async function uploadProofImage(dataUrl, prefix = 'proof') {
  if (!dataUrl) return '';
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify({ dataUrl, prefix }),
    });
    if (res.status === 401) {
      notifyAuthInvalidated();
      return '';
    }
    if (res.ok) {
      const json = await res.json();
      return json.url;
    }
  } catch {
    // If direct cloud is active, upload straight to Supabase Storage
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

export async function postActionWithOfflineSupport(endpoint, body, options = {}) {
  const { rawDataUrl, proofField } = options;

  try {
    let finalBody = { ...body };
    if (rawDataUrl && proofField) {
      finalBody[proofField] = await uploadProofImage(rawDataUrl, proofField);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(true),
      body: JSON.stringify(finalBody),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return await res.json();
    }

    // If running in Direct Cloud Mode without local server, write directly to Supabase!
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
    // Network failure on local Wi-Fi: queue offline if queueable operational endpoint
    const queueable = ['/api/attendance', '/api/trucks/arrive', '/api/notes', '/api/shortages'];
    if (queueable.includes(endpoint) && !getDirectCloudCredentials()) {
      const offlineBody = { ...body };
      if (rawDataUrl && proofField) {
        offlineBody._offlineDataUrl = rawDataUrl;
        offlineBody._proofField = proofField;
      }
      enqueueOfflineRequest(endpoint, 'POST', offlineBody);
      return { ok: true, queuedOffline: true };
    }
    throw err;
  }
}

async function executeDirectCloudMutation(endpoint, body) {
  const supabase = getSupabaseDirectClient();
  if (!supabase) throw new Error('لا يوجد اتصال سحابي');

  const now = new Date();
  const iso = now.toISOString();
  const dateKey = getLocalDateKey(now);
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());

  if (endpoint === '/api/notes') {
    const row = {
      id,
      location_tag: body.location_tag || 'الإدارة عن بُعد',
      category_tag: body.category_tag || 'ملاحظة عامة',
      severity: body.severity || 'normal',
      dvr_timestamp: body.dvr_timestamp || now.toTimeString().slice(0, 8),
      content: body.content || 'ملاحظة إدارية',
      proof_url: body.proof_url || '',
      recorded_by: body.recorded_by || 'الإدارة (عن بُعد)',
      is_open_handover: body.is_open_handover ? 1 : 0,
      resolved_by: '',
      resolved_at: '',
      timestamp: iso,
      date_key: dateKey,
      synced: 1,
    };
    const { error } = await supabase.from('notes').insert(row);
    if (error) throw new Error(error.message);
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
      catalog_item_id: body.catalog_item_id || '',
      item_name: body.item_name || 'صنف ناقص',
      category: body.category || 'بقالة جافة',
      requested_qty: parsedQty,
      unit: body.unit || '',
      urgency: body.urgency || 'out_of_stock',
      status: 'open',
      supplier_id: body.supplier_id || '',
      supplier_name: body.supplier_name || '',
      notes: body.notes || '',
      recorded_by: body.recorded_by || 'الإدارة (عن بُعد)',
      resolved_by: '',
      resolved_at: '',
      created_at: iso,
      updated_at: iso,
      date_key: dateKey,
      synced: 1,
    };
    const { error } = await supabase.from('shortages').insert(row);
    if (error) throw new Error(error.message);
    return { ok: true, shortage: row };
  }

  if (endpoint === '/api/employees') {
    const row = {
      id,
      name: body.name,
      department: body.department || 'منسقي ممرات',
      role_title: body.role_title || '',
      shift_start: body.shift_start || '08:00',
      shift_end: body.shift_end || '17:00',
      avatar_color: body.avatar_color || '#1A73E8',
      phone: body.phone || '',
      is_active: 1,
      updated_at: iso,
    };
    const { error } = await supabase.from('employees').insert(row);
    if (error) throw new Error(error.message);
    return { ok: true, employee: row };
  }

  throw new Error('هذه العملية تتطلب الاتصال بخادم الماركت أو لوحة السحابة');
}

export async function apiRequest(endpoint, method = 'GET', body) {
  const res = await fetch(endpoint, {
    method,
    headers: buildHeaders(Boolean(body)),
    body: body ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get('content-type') || '';
  const json = contentType.includes('application/json') ? await res.json() : {};
  if (!res.ok) {
    if (res.status === 401) {
      notifyAuthInvalidated();
    }
    throw new Error(json.error || 'حدث خطأ غير متوقع');
  }
  return json;
}

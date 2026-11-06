// Zayed Mart Local-First Engine (IndexedDB + Optimistic Offline Outbox + Android PWA Manager)

const IDB_NAME = 'zayed_mart_local_db_v1';
const IDB_VERSION = 1;
const LEGACY_QUEUE_KEY = 'zayed_mart_offline_queue_v1';
const LEGACY_SNAPSHOT_KEY = 'zayed_mart_last_snapshot';
const OUTBOX_MIRROR_KEY = 'zayed_mart_outbox_mirror_v2';

let dbPromise = null;
let deferredInstallPrompt = null;
let isAppInstalled = false;
let storagePersisted = false;

const pwaListeners = new Set();
const syncListeners = new Set();

const syncState = {
  online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  syncing: false,
  pendingCount: 0,
  lastSyncedAt: '',
  storagePersisted: false,
  connectionMode: 'online', // 'local_server' | 'direct_cloud' | 'offline_cached'
};

function notifyPwaListeners() {
  const state = getPwaInstallState();
  for (const fn of pwaListeners) {
    try {
      fn(state);
    } catch {
      // ignore
    }
  }
}

function notifySyncListeners() {
  const snap = { ...syncState };
  for (const fn of syncListeners) {
    try {
      fn(snap);
    } catch {
      // ignore
    }
  }
}

export function updateSyncState(partial) {
  Object.assign(syncState, partial);
  notifySyncListeners();
}

export function getSyncState() {
  return { ...syncState };
}

export function subscribeSyncState(listener) {
  syncListeners.add(listener);
  listener({ ...syncState });
  return () => syncListeners.delete(listener);
}

// ============================================================================
// 1. PWA INSTALL & PERSISTENT STORAGE MANAGER (ANDROID CHROME WEBAPK)
// ============================================================================

export function isStandaloneMode() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      window.navigator?.standalone === true
  );
}

export function getPwaInstallState() {
  const isAndroid =
    typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
  const isIOS =
    typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  const standalone = isAppInstalled || isStandaloneMode();
  return {
    canPromptInstall: Boolean(deferredInstallPrompt) && !standalone,
    isStandalone: standalone,
    isAndroid,
    isIOS,
    storagePersisted,
  };
}

export function subscribePwaInstallState(listener) {
  pwaListeners.add(listener);
  listener(getPwaInstallState());
  return () => pwaListeners.delete(listener);
}

export async function triggerPwaInstall() {
  if (!deferredInstallPrompt) {
    return { outcome: 'unavailable' };
  }
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notifyPwaListeners();
  try {
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      isAppInstalled = true;
      await ensurePersistentStorage();
    }
    notifyPwaListeners();
    return choice || { outcome: 'dismissed' };
  } catch {
    return { outcome: 'error' };
  }
}

export async function ensurePersistentStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage) return false;
  try {
    if (navigator.storage.persisted) {
      const already = await navigator.storage.persisted();
      if (already) {
        storagePersisted = true;
        updateSyncState({ storagePersisted: true });
        return true;
      }
    }
    if (navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      storagePersisted = Boolean(granted);
      updateSyncState({ storagePersisted });
      return storagePersisted;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function requestBackgroundOutboxSync() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg && 'sync' in reg) {
      await reg.sync.register('zayed-outbox-sync');
    }
  } catch {
    // Fallback handled by window 'online' + interval timer
  }
}

export function initPwaAndServiceWorker(onSwFlushRequested) {
  if (typeof window === 'undefined') return;

  isAppInstalled = isStandaloneMode();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    notifyPwaListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    isAppInstalled = true;
    ensurePersistentStorage();
    notifyPwaListeners();
  });

  window.addEventListener('online', () => {
    updateSyncState({ online: true });
  });

  window.addEventListener('offline', () => {
    updateSyncState({ online: false, connectionMode: 'offline_cached' });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          ensurePersistentStorage();
          try {
            reg.update();
          } catch {
            // ignore
          }
        })
        .catch(() => {
          // ignore SW registration failure in non-HTTPS dev if any
        });
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'ZAYED_FLUSH_OUTBOX' && typeof onSwFlushRequested === 'function') {
        onSwFlushRequested();
      }
    });
  }

  ensurePersistentStorage();
}

// Capture beforeinstallprompt immediately at module load time so early events are never missed!
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    notifyPwaListeners();
  });
}

// ============================================================================
// 2. INDEXEDDB CORE WRAPPER (WITH SAFE FALLBACK TO LOCALSTORAGE)
// ============================================================================

function openLocalDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('daily_snapshots')) {
          db.createObjectStore('daily_snapshots', { keyPath: 'dateKey' });
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function idbGet(storeName, key) {
  const db = await openLocalDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(storeName, value) {
  const db = await openLocalDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbGetAll(storeName) {
  const db = await openLocalDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbClearAndPutAll(storeName, items) {
  const db = await openLocalDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ============================================================================
// 3. SNAPSHOTS & MASTER ENTITIES PERSISTENCE
// ============================================================================

export async function saveBootstrapToLocalDb(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const dateKey = snapshot.dateKey || new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const existingMaster = (await idbGet('kv', 'master_entities'))?.value || {};
  const isAuthoritativeServerSnap =
    snapshot.connectionMode === 'cloud_postgres' ||
    snapshot.connectionMode === 'local_server' ||
    snapshot.connectionMode === 'direct_cloud';

  // If the server's cacheEpoch changed (e.g. after clearing logs or deleting fake data),
  // wipe all stale daily_snapshots in IndexedDB so deleted records never reappear!
  if (
    isAuthoritativeServerSnap &&
    snapshot.cacheEpoch &&
    existingMaster.cacheEpoch !== snapshot.cacheEpoch
  ) {
    const db = await openLocalDb();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction('daily_snapshots', 'readwrite');
          tx.objectStore('daily_snapshots').clear();
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
    }
  }

  // Save compact mirror in localStorage for synchronous boot fallback
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LEGACY_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
      // Quota exceeded on localStorage — IndexedDB handles large data!
    }
  }

  await idbPut('daily_snapshots', {
    dateKey,
    snapshot,
    savedAt: nowIso,
  });

  await idbPut('kv', {
    key: 'latest_snapshot',
    snapshot,
    savedAt: nowIso,
  });

  // When online, server arrays are authoritative (even when empty [] after deleting the last record!)
  const nextMaster = {
    employees: isAuthoritativeServerSnap
      ? Array.isArray(snapshot.employees)
        ? snapshot.employees
        : []
      : Array.isArray(snapshot.employees) && snapshot.employees.length > 0
        ? snapshot.employees
        : existingMaster.employees || [],
    suppliers: isAuthoritativeServerSnap
      ? Array.isArray(snapshot.suppliers)
        ? snapshot.suppliers
        : []
      : Array.isArray(snapshot.suppliers) && snapshot.suppliers.length > 0
        ? snapshot.suppliers
        : existingMaster.suppliers || [],
    productCatalog: isAuthoritativeServerSnap
      ? Array.isArray(snapshot.productCatalog)
        ? snapshot.productCatalog
        : []
      : Array.isArray(snapshot.productCatalog) && snapshot.productCatalog.length > 0
        ? snapshot.productCatalog
        : existingMaster.productCatalog || [],
    settings: snapshot.settings || existingMaster.settings || {},
    dbBootId: snapshot.dbBootId || existingMaster.dbBootId || '',
    cacheEpoch: snapshot.cacheEpoch || existingMaster.cacheEpoch || '',
    updatedAt: nowIso,
  };

  await idbPut('kv', {
    key: 'master_entities',
    value: nextMaster,
  });
}

export async function loadSnapshotFromLocalDb(dateKey) {
  if (dateKey) {
    const byDate = await idbGet('daily_snapshots', dateKey);
    if (byDate?.snapshot) return byDate.snapshot;
  }
  const latest = await idbGet('kv', 'latest_snapshot');
  if (latest?.snapshot) {
    if (!dateKey || latest.snapshot.dateKey === dateKey) {
      return latest.snapshot;
    }
    // Synthesize a clean view for another date using master_entities!
    const master = (await idbGet('kv', 'master_entities'))?.value;
    if (master) {
      return {
        ...latest.snapshot,
        dateKey,
        employees: (master.employees || []).map((e) => ({
          ...e,
          currentStatus: 'absent',
          todayLogsCount: 0,
        })),
        attendanceLogs: [],
      };
    }
    return latest.snapshot;
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(LEGACY_SNAPSHOT_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
  }
  return null;
}

export async function loadFullLocalDatasetForRehydrate() {
  const master = (await idbGet('kv', 'master_entities'))?.value || {};
  const allDaily = await idbGetAll('daily_snapshots');

  const attendanceMap = new Map();
  const truckMap = new Map();
  const shortageMap = new Map();
  const noteMap = new Map();
  const handoverMap = new Map();
  const chatMap = new Map();

  for (const entry of allDaily) {
    const snap = entry?.snapshot;
    if (!snap) continue;
    for (const r of snap.attendanceLogs || []) if (r?.id) attendanceMap.set(r.id, r);
    for (const r of snap.truckLogs || []) if (r?.id) truckMap.set(r.id, r);
    for (const r of snap.shortages || []) if (r?.id) shortageMap.set(r.id, r);
    for (const r of snap.notes || []) if (r?.id) noteMap.set(r.id, r);
    for (const r of snap.handovers || []) if (r?.id) handoverMap.set(r.id, r);
    for (const r of snap.teamMessages || []) if (r?.id) chatMap.set(r.id, r);
  }

  // Fallback to legacy localStorage snapshot if IndexedDB was just initialized
  if ((master.employees || []).length === 0 && typeof localStorage !== 'undefined') {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_SNAPSHOT_KEY) || 'null');
      if (legacy) {
        master.employees = legacy.employees || [];
        master.suppliers = legacy.suppliers || [];
        master.productCatalog = legacy.productCatalog || [];
        for (const r of legacy.attendanceLogs || []) if (r?.id) attendanceMap.set(r.id, r);
        for (const r of legacy.truckLogs || []) if (r?.id) truckMap.set(r.id, r);
        for (const r of legacy.shortages || []) if (r?.id) shortageMap.set(r.id, r);
        for (const r of legacy.notes || []) if (r?.id) noteMap.set(r.id, r);
        for (const r of legacy.handovers || []) if (r?.id) handoverMap.set(r.id, r);
        for (const r of legacy.teamMessages || []) if (r?.id) chatMap.set(r.id, r);
      }
    } catch {
      // ignore
    }
  }

  const payload = {
    employees: master.employees || [],
    suppliers: master.suppliers || [],
    product_catalog: master.productCatalog || [],
    attendance_logs: Array.from(attendanceMap.values()),
    truck_logs: Array.from(truckMap.values()),
    shortages: Array.from(shortageMap.values()),
    notes: Array.from(noteMap.values()),
    shift_handovers: Array.from(handoverMap.values()),
    team_messages: Array.from(chatMap.values()),
  };

  const totalCount =
    payload.employees.length +
    payload.suppliers.length +
    payload.attendance_logs.length +
    payload.shortages.length +
    payload.notes.length +
    payload.truck_logs.length +
    payload.team_messages.length;

  return { payload, totalCount };
}

export async function clearLocalUserCacheOnLogout() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LEGACY_SNAPSHOT_KEY);
  }
  const db = await openLocalDb();
  if (!db) return;
  try {
    const tx = db.transaction(['kv', 'daily_snapshots'], 'readwrite');
    tx.objectStore('kv').delete('latest_snapshot');
    tx.objectStore('daily_snapshots').clear();
  } catch {
    // ignore
  }
}

// ============================================================================
// 4. OFFLINE MUTATION OUTBOX (SYNC MIRROR + INDEXEDDB)
// ============================================================================

function readMirrorOutbox() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const v2 = localStorage.getItem(OUTBOX_MIRROR_KEY);
    if (v2) return JSON.parse(v2);
    const legacy = localStorage.getItem(LEGACY_QUEUE_KEY);
    if (legacy) return JSON.parse(legacy);
  } catch {
    // ignore
  }
  return [];
}

function writeMirrorOutbox(items) {
  if (typeof localStorage !== 'undefined') {
    try {
      // Strip heavy base64 images from localStorage mirror if needed, full payload stays in IDB
      const light = items.map((it) => {
        if (it?.body?._offlineDataUrl && it.body._offlineDataUrl.length > 60000) {
          return { ...it, _hasIdbImage: true, body: { ...it.body, _offlineDataUrl: '' } };
        }
        return it;
      });
      localStorage.setItem(OUTBOX_MIRROR_KEY, JSON.stringify(light));
      localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(light));
    } catch {
      // ignore quota errors; IndexedDB stores full queue
    }
  }
  updateSyncState({ pendingCount: items.length });
}

export function getOutboxSyncMirror() {
  const list = readMirrorOutbox();
  return Array.isArray(list) ? list : [];
}

export async function loadOutboxItems() {
  const idbItems = await idbGetAll('outbox');
  if (idbItems.length > 0) {
    idbItems.sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
    writeMirrorOutbox(idbItems);
    return idbItems;
  }
  const mirror = getOutboxSyncMirror();
  if (mirror.length > 0) {
    await idbClearAndPutAll('outbox', mirror);
  }
  updateSyncState({ pendingCount: mirror.length });
  return mirror;
}

export async function saveOutboxItems(items) {
  const sorted = [...items].sort((a, b) =>
    String(a.queuedAt || '').localeCompare(String(b.queuedAt || ''))
  );
  writeMirrorOutbox(sorted);
  await idbClearAndPutAll('outbox', sorted);
}

export async function enqueueOutboxMutation({ endpoint, method = 'POST', body = {}, actorName = '', actorRole = '' }) {
  const current = await loadOutboxItems();
  const recordId =
    body.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const queuedAt = body.timestamp || new Date().toISOString();

  const item = {
    id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    endpoint,
    method,
    body: {
      ...body,
      id: recordId,
      timestamp: body.timestamp || queuedAt,
    },
    actorName,
    actorRole,
    queuedAt,
  };

  current.push(item);
  await saveOutboxItems(current);
  requestBackgroundOutboxSync();
  return item;
}

// ============================================================================
// 5. OPTIMISTIC UI ENGINE: APPLY PENDING OUTBOX ON TOP OF CACHED SNAPSHOT
// ============================================================================

export function applyOptimisticOutboxToSnapshot(baseSnapshot, outboxItems = []) {
  if (!baseSnapshot || !Array.isArray(outboxItems) || outboxItems.length === 0) {
    return baseSnapshot;
  }

  const snap = {
    ...baseSnapshot,
    employees: Array.isArray(baseSnapshot.employees)
      ? baseSnapshot.employees.map((e) => ({ ...e }))
      : [],
    attendanceLogs: Array.isArray(baseSnapshot.attendanceLogs)
      ? [...baseSnapshot.attendanceLogs]
      : [],
    shortages: Array.isArray(baseSnapshot.shortages)
      ? baseSnapshot.shortages.map((s) => ({ ...s }))
      : [],
    notes: Array.isArray(baseSnapshot.notes) ? baseSnapshot.notes.map((n) => ({ ...n })) : [],
    truckLogs: Array.isArray(baseSnapshot.truckLogs)
      ? baseSnapshot.truckLogs.map((t) => ({ ...t }))
      : [],
    teamMessages: Array.isArray(baseSnapshot.teamMessages)
      ? [...baseSnapshot.teamMessages]
      : [],
    suppliers: Array.isArray(baseSnapshot.suppliers) ? [...baseSnapshot.suppliers] : [],
    summary: { ...(baseSnapshot.summary || {}) },
  };

  for (const item of outboxItems) {
    const { endpoint, method, body = {}, actorName, actorRole, queuedAt } = item;
    const actor = actorName || snap.auth?.user?.display_name || 'محلي (أوفلاين)';
    const role = actorRole || snap.auth?.user?.role || '';
    const dateKey = (queuedAt || new Date().toISOString()).slice(0, 10);

    // 1. Attendance check-in / break / check-out / verify / delete
    if (endpoint === '/api/attendance' && method === 'POST') {
      if (!snap.attendanceLogs.some((l) => l.id === body.id)) {
        const emp = snap.employees.find((e) => e.id === body.employee_id);
        const logRow = {
          id: body.id,
          employee_id: body.employee_id,
          employee_name: emp?.name || body.employee_name || 'موظف',
          department: emp?.department || '',
          action_type: body.action_type,
          timestamp: body.timestamp || queuedAt,
          date_key: dateKey,
          shift_date_key: emp?.shiftDateKey || dateKey,
          late_minutes: 0,
          allowed_break_minutes: Number(body.allowed_break_minutes) || 0,
          break_duration_minutes: 0,
          break_reason: body.break_reason || '',
          note: body.note || '',
          proof_url: body.proof_url || body._offlineDataUrl || '',
          recorded_by: `${actor} (⏳ أوفلاين)`,
          verified_by_cctv: 0,
          _pendingSync: true,
        };
        snap.attendanceLogs.unshift(logRow);
        if (emp) {
          if (body.action_type === 'check_in' || body.action_type === 'break_end') {
            emp.currentStatus = 'present';
            if (body.action_type === 'check_in' && !emp.checkInTime) {
              emp.checkInTime = logRow.timestamp;
            }
          } else if (body.action_type === 'break_start') {
            emp.currentStatus = 'on_break';
            emp.activeBreakStart = logRow.timestamp;
            emp.allowedBreakMinutes = Number(body.allowed_break_minutes) || 30;
            emp.breakReason = body.break_reason || '';
          } else if (body.action_type === 'check_out') {
            emp.currentStatus = 'checked_out';
            emp.checkOutTime = logRow.timestamp;
          }
          emp.latestActionTime = logRow.timestamp;
          emp.latestActionType = body.action_type;
          emp._pendingSync = true;
        }
      }
    } else if (
      endpoint.startsWith('/api/attendance/') &&
      endpoint.endsWith('/verify') &&
      method === 'POST'
    ) {
      const logId = decodeURIComponent(endpoint.split('/')[3] || '');
      const targetLog = snap.attendanceLogs.find((l) => l.id === logId);
      if (targetLog) {
        targetLog.verified_by_cctv = 1;
        targetLog._pendingSync = true;
      }
    } else if (endpoint.startsWith('/api/attendance/') && method === 'DELETE') {
      const logId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.attendanceLogs = snap.attendanceLogs.filter((l) => l.id !== logId);
    }

    // 2. Shortages create / update / status / delete / clear-resolved
    if (endpoint === '/api/shortages' && method === 'POST') {
      if (!snap.shortages.some((s) => s.id === body.id)) {
        snap.shortages.unshift({
          id: body.id,
          item_name: body.item_name,
          category: body.category || 'بقالة جافة',
          requested_qty: body.requested_qty ?? null,
          unit: body.unit || '',
          urgency: body.urgency || 'out_of_stock',
          status: 'open',
          is_suggestion: body.is_suggestion ? 1 : 0,
          supplier_id: body.supplier_id || '',
          supplier_name: body.supplier_name || '',
          notes: body.notes || '',
          recorded_by: `${actor} (⏳ أوفلاين)`,
          recorded_by_role: role,
          timestamp: queuedAt,
          updated_at: queuedAt,
          date_key: dateKey,
          _pendingSync: true,
        });
      }
    } else if (endpoint === '/api/shortages/clear-resolved' && method === 'POST') {
      snap.shortages = snap.shortages.filter((s) => s.status !== 'resolved');
    } else if (endpoint.startsWith('/api/shortages/') && method === 'DELETE') {
      const shId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.shortages = snap.shortages.filter((s) => s.id !== shId);
    } else if (endpoint.startsWith('/api/shortages/') && (method === 'PUT' || method === 'POST')) {
      const parts = endpoint.split('/');
      const shId = decodeURIComponent(parts[3] || '');
      const target = snap.shortages.find((s) => s.id === shId);
      if (target) {
        Object.assign(target, body, { updated_at: queuedAt, _pendingSync: true });
      }
    }

    // 3. CCTV / Cashier Notes & Shift Handovers
    if (endpoint === '/api/notes' && method === 'POST') {
      if (!snap.notes.some((n) => n.id === body.id)) {
        snap.notes.unshift({
          id: body.id,
          location_tag: body.location_tag || 'الصالة',
          category_tag: body.category_tag || 'ملاحظة عامة',
          severity: body.severity || 'normal',
          dvr_timestamp: body.dvr_timestamp || '00:00:00',
          content: body.content || '',
          proof_url: body.proof_url || body._offlineDataUrl || '',
          recorded_by: `${actor} (⏳ أوفلاين)`,
          is_open_handover: body.is_open_handover ? 1 : 0,
          timestamp: queuedAt,
          date_key: dateKey,
          _pendingSync: true,
        });
      }
    } else if (
      endpoint.startsWith('/api/notes/') &&
      endpoint.endsWith('/resolve') &&
      method === 'POST'
    ) {
      const noteId = decodeURIComponent(endpoint.split('/')[3] || '');
      const note = snap.notes.find((n) => n.id === noteId);
      if (note) {
        note.is_open_handover = 0;
        note.resolved_by = actor;
        note.resolved_at = queuedAt;
        note._pendingSync = true;
      }
    } else if (endpoint.startsWith('/api/notes/') && method === 'DELETE') {
      const noteId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.notes = snap.notes.filter((n) => n.id !== noteId);
    }

    // 4. Supplier Trucks
    if (endpoint === '/api/trucks/arrive' && method === 'POST') {
      if (!snap.truckLogs.some((t) => t.id === body.id)) {
        const sup = snap.suppliers.find((s) => s.id === body.supplier_id);
        snap.truckLogs.unshift({
          id: body.id,
          supplier_id: body.supplier_id || '',
          supplier_name: body.supplier_name || sup?.name || 'مورد',
          category: body.category || sup?.category || 'بقالة جافة',
          plate_or_driver: body.plate_or_driver || '',
          status: 'unloading',
          arrival_time: queuedAt,
          date_key: dateKey,
          delivery_condition: 'pending',
          notes: body.notes || '',
          recorded_by: `${actor} (⏳ أوفلاين)`,
          _pendingSync: true,
        });
      }
    } else if (endpoint.startsWith('/api/trucks/') && endpoint.endsWith('/complete')) {
      const trkId = decodeURIComponent(endpoint.split('/')[3] || '');
      const trk = snap.truckLogs.find((t) => t.id === trkId);
      if (trk) {
        trk.status = 'completed';
        trk.departure_time = queuedAt;
        trk.delivery_condition = body.delivery_condition || 'complete';
        trk._pendingSync = true;
      }
    } else if (endpoint.startsWith('/api/trucks/') && method === 'DELETE') {
      const trkId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.truckLogs = snap.truckLogs.filter((t) => t.id !== trkId);
    }

    // 5. Team Chat Messages
    if (endpoint === '/api/team-messages' && method === 'POST') {
      if (!snap.teamMessages.some((m) => m.id === body.id)) {
        snap.teamMessages.unshift({
          id: body.id,
          channel: body.channel || 'general',
          sender_name: actor,
          sender_role: role,
          content: body.content || body.message || '',
          is_urgent: body.is_urgent || body.priority === 'urgent' ? 1 : 0,
          is_pinned: body.is_pinned ? 1 : 0,
          timestamp: queuedAt,
          date_key: dateKey,
          _pendingSync: true,
        });
      }
    } else if (
      endpoint.startsWith('/api/team-messages/') &&
      endpoint.endsWith('/pin') &&
      method === 'POST'
    ) {
      const msgId = decodeURIComponent(endpoint.split('/')[3] || '');
      const msg = snap.teamMessages.find((m) => m.id === msgId);
      if (msg) {
        msg.is_pinned = msg.is_pinned ? 0 : 1;
        msg._pendingSync = true;
      }
    } else if (endpoint.startsWith('/api/team-messages/') && method === 'DELETE') {
      const msgId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.teamMessages = snap.teamMessages.filter((m) => m.id !== msgId);
    }

    // 6. Employees & Suppliers added / edited / deleted while offline
    if (endpoint === '/api/employees' && method === 'POST') {
      if (!snap.employees.some((e) => e.id === body.id)) {
        snap.employees.push({
          id: body.id,
          emp_code: body.emp_code || '',
          name: body.name || '',
          department: body.department || 'كاشير',
          role_title: body.role_title || '',
          shift_start: body.shift_start || '08:00',
          shift_end: body.shift_end || '20:00',
          avatar_color: body.avatar_color || '#1A73E8',
          phone: body.phone || '',
          currentStatus: 'absent',
          _pendingSync: true,
        });
      }
    } else if (endpoint.startsWith('/api/employees/') && method === 'PUT') {
      const empId = decodeURIComponent(endpoint.split('/')[3] || '');
      const emp = snap.employees.find((e) => e.id === empId);
      if (emp) {
        Object.assign(emp, body, { _pendingSync: true });
      }
    } else if (endpoint.startsWith('/api/employees/') && method === 'DELETE') {
      const empId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.employees = snap.employees.filter((e) => e.id !== empId);
    }

    if (endpoint === '/api/suppliers' && method === 'POST') {
      if (!snap.suppliers.some((s) => s.id === body.id)) {
        snap.suppliers.push({
          id: body.id,
          name: body.name || '',
          category: body.category || 'بقالة جافة',
          color: body.color || '#0B57D0',
          phone: body.phone || '',
          is_active: 1,
          _pendingSync: true,
        });
      }
    } else if (endpoint.startsWith('/api/suppliers/') && method === 'PUT') {
      const supId = decodeURIComponent(endpoint.split('/')[3] || '');
      const sup = snap.suppliers.find((s) => s.id === supId);
      if (sup) {
        Object.assign(sup, body, { _pendingSync: true });
      }
    } else if (
      endpoint.startsWith('/api/suppliers/') &&
      endpoint.endsWith('/clear-return') &&
      method === 'POST'
    ) {
      const supId = decodeURIComponent(endpoint.split('/')[3] || '');
      const sup = snap.suppliers.find((s) => s.id === supId);
      if (sup) {
        sup.has_pending_return = 0;
        sup.pending_return_note = '';
        sup._pendingSync = true;
      }
    } else if (endpoint.startsWith('/api/suppliers/') && method === 'DELETE') {
      const supId = decodeURIComponent(endpoint.split('/')[3] || '');
      snap.suppliers = snap.suppliers.filter((s) => s.id !== supId);
    }
  }

  // Recompute summary counts accurately
  let presentCount = 0;
  let onBreakCount = 0;
  let checkedOutCount = 0;
  for (const e of snap.employees) {
    if (e.currentStatus === 'present') presentCount += 1;
    else if (e.currentStatus === 'on_break') onBreakCount += 1;
    else if (e.currentStatus === 'checked_out') checkedOutCount += 1;
  }
  snap.summary = {
    ...snap.summary,
    totalEmployees: snap.employees.length,
    presentCount,
    onBreakCount,
    checkedOutCount,
    absentCount: Math.max(0, snap.employees.length - presentCount - onBreakCount - checkedOutCount),
    openShortagesCount: snap.shortages.filter((s) => s.status === 'open').length,
    unloadingTrucksCount: snap.truckLogs.filter((t) => t.status === 'unloading').length,
  };

  return snap;
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import BottomNav from './components/BottomNav.jsx';
import SmartAlertsAndHandoverBar from './components/SmartAlertsAndHandoverBar.jsx';
import QrQuickModal from './components/QrQuickModal.jsx';
import AttendanceView from './components/AttendanceView.jsx';
import TrucksView from './components/TrucksView.jsx';
import ShortagesView from './components/ShortagesView.jsx';
import CctvNotesView from './components/CctvNotesView.jsx';
import TeamChatView from './components/TeamChatView.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import KioskLockView from './components/KioskLockView.jsx';
import AuthLoginScreen from './components/AuthLoginScreen.jsx';
import ProfileModal from './components/ProfileModal.jsx';
import PersonLogModal from './components/PersonLogModal.jsx';
import WalkieFloatingDock from './components/WalkieFloatingDock.jsx';
import WalkieTalkieConsole from './components/WalkieTalkieConsole.jsx';
import {
  SkeletonKpiStrip,
  SkeletonList,
  SmartFab,
} from './components/ui/index.js';
import {
  fetchBootstrap,
  fetchBootstrapIfNeeded,
  flushOfflineQueue,
  getOfflineQueue,
  getCachedAuthSession,
  onAuthInvalidated,
  logoutSession,
  lockDeviceToKiosk,
  hasPermission,
  hasAnyPermission,
  resolveApiUrl,
  isDirectCloudToken,
  getLiteModeEnabled,
  setLiteModeEnabled,
} from './lib/api.js';
import { subscribeSyncState } from './lib/localDb.js';
import { subscribeGlobalStoreSync } from './lib/supabaseRealtime.js';
import { emitWalkieSseEvent, useWalkieTalkie } from './lib/useWalkieTalkie.js';

function getTodayLocalKey() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function getPreferredAllowedTab(role, perms = []) {
  const canAtt = hasAnyPermission(perms, role, [
    'attendance:self',
    'attendance:read',
    'attendance:write',
    'attendance:kiosk',
  ]);
  const canSht = hasAnyPermission(perms, role, [
    'shortages:read',
    'shortages:write',
    'shortages:manage',
  ]);
  const canTrk = hasAnyPermission(perms, role, ['trucks:read', 'trucks:write']);
  const canNot = hasAnyPermission(perms, role, ['notes:read', 'notes:write']);
  const canDash = hasAnyPermission(perms, role, [
    'reports:view',
    'staff:manage',
    'suppliers:manage',
    'users:manage',
    'audit:view',
    'settings:manage',
    'backup:manage',
  ]);

  if (role === 'owner' && canDash) return 'dashboard';
  if (role === 'hall' && canSht) return 'shortages';
  if (canAtt) return 'attendance';
  if (canSht) return 'shortages';
  if (canTrk) return 'trucks';
  if (canNot) return 'notes';
  if (canDash) return 'dashboard';
  return 'shortages';
}

export default function App() {
  const todayKey = getTodayLocalKey();
  const [authSession, setAuthSessionState] = useState(() => getCachedAuthSession());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const requestedTab = new URLSearchParams(window.location.search).get('tab');
      if (['attendance', 'shortages', 'trucks', 'notes', 'chat', 'dashboard'].includes(requestedTab)) {
        return requestedTab;
      }
    }
    const cached = getCachedAuthSession();
    return getPreferredAllowedTab(cached?.user?.role || '', cached?.permissions || []);
  });
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('zayed_dark_mode') === 'true'
  );
  const [fontScale, setFontScale] = useState(
    () => localStorage.getItem('zayed_font_scale') || 'scale-normal'
  );
  const [fontFamily, setFontFamily] = useState(
    () => localStorage.getItem('zayed_font_family_v2') || 'cairo'
  );
  const [voiceConfirmEnabled, setVoiceConfirmEnabled] = useState(
    () => localStorage.getItem('zayed_voice_confirm') !== 'false'
  );
  const [liteMode, setLiteMode] = useState(() => getLiteModeEnabled());
  const lastBackPressRef = useRef(0);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [liveConnectionMode, setLiveConnectionMode] = useState('local_server');
  const [toast, setToast] = useState(null);
  const [previewModal, setPreviewModal] = useState(null);

  // Global Modals: QR / Quick Code + Shift Handover + Profile + Person Log
  const [qrModalTab, setQrModalTab] = useState(null);
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [personLogTarget, setPersonLogTarget] = useState(null);
  const [dashboardSubTab, setDashboardSubTab] = useState(null);
  const [attendanceFilterRequest, setAttendanceFilterRequest] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 3400);
  }, []);

  // Listen for 401 session expiration / remote session revocation
  useEffect(() => {
    return onAuthInvalidated(() => {
      setAuthSessionState(null);
      setData(null);
    });
  }, []);

  // Subscribe to IndexedDB outbox & network sync status
  useEffect(() => {
    return subscribeSyncState((st) => {
      setOfflineQueueCount(st.pendingCount || 0);
      setIsSyncing(Boolean(st.syncing));
      if (!st.online) {
        setLiveConnectionMode('offline_cached');
      } else if (st.connectionMode) {
        setLiveConnectionMode(st.connectionMode);
      }
    });
  }, []);

  const applyBootstrapSnapshot = useCallback((snap) => {
    if (!snap) return;
    setData(snap);
    if (snap.auth?.user) {
      setAuthSessionState((prev) =>
        prev
          ? {
              ...prev,
              user: snap.auth.user,
              permissions: snap.auth.permissions || [],
            }
          : prev
      );
    }
    setOfflineQueueCount(getOfflineQueue().length);
  }, []);

  const loadData = useCallback(async () => {
    if (!authSession?.token) {
      setLoading(false);
      return;
    }
    try {
      const snap = await fetchBootstrap(selectedDate);
      applyBootstrapSnapshot(snap);
    } catch (err) {
      if (err.code !== 'UNAUTHENTICATED') {
        showToast(err.message || 'تعذر تحميل البيانات', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [authSession?.token, selectedDate, showToast, applyBootstrapSnapshot]);

  const loadDataIfChanged = useCallback(async () => {
    if (!authSession?.token) return;
    try {
      const snap = await fetchBootstrapIfNeeded(selectedDate);
      if (snap) {
        applyBootstrapSnapshot(snap);
      }
    } catch {
      // Background digest poll errors stay silent until next SSE/manual reload
    }
  }, [authSession?.token, selectedDate, applyBootstrapSnapshot]);

  useEffect(() => {
    if (authSession?.token) {
      setLoading(true);
      loadData();
    } else {
      setLoading(false);
    }
  }, [authSession?.token, loadData]);

  // Real-time SSE subscription + online recovery listener
  useEffect(() => {
    if (!authSession?.token) return undefined;

    let es = null;
    if (!isDirectCloudToken(authSession.token)) {
      try {
        es = new EventSource(
          resolveApiUrl(`/api/events?token=${encodeURIComponent(authSession.token)}`)
        );
        es.addEventListener('update', () => {
          loadData();
        });
        es.addEventListener('walkie_tx', (ev) => {
          try {
            emitWalkieSseEvent('walkie_tx', JSON.parse(ev.data));
          } catch {
            // ignore
          }
        });
        es.addEventListener('walkie_presence', (ev) => {
          try {
            emitWalkieSseEvent('walkie_presence', JSON.parse(ev.data));
          } catch {
            // ignore
          }
        });
        es.addEventListener('walkie_signal', (ev) => {
          try {
            emitWalkieSseEvent('walkie_signal', JSON.parse(ev.data));
          } catch {
            // ignore
          }
        });
        es.addEventListener('walkie_live_frame', (ev) => {
          try {
            emitWalkieSseEvent('walkie_live_frame', JSON.parse(ev.data));
          } catch {
            // ignore
          }
        });
        es.addEventListener('walkie_dispatch', (ev) => {
          try {
            emitWalkieSseEvent('walkie_dispatch', JSON.parse(ev.data));
          } catch {
            // ignore
          }
        });
      } catch {
        // Fallback polling
      }
    }

    // Global Multi-Network Cloud Realtime Sync (< 100ms across 4G/5G/Wi-Fi anywhere)
    let cloudSyncDebounce = null;
    const unsubscribeGlobalCloudSync = subscribeGlobalStoreSync(() => {
      if (cloudSyncDebounce) clearTimeout(cloudSyncDebounce);
      cloudSyncDebounce = setTimeout(() => {
        loadData();
      }, 120);
    });

    const pollInterval = setInterval(() => {
      loadDataIfChanged();
    }, 15000);

    // Fast 5-second auto-reconnect probe whenever Phone is in Offline Mode or has pending offline items to upload
    const fastRecoveryInterval = setInterval(async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const pendingCount = getOfflineQueue().length;
      if (liveConnectionMode === 'offline_cached' || pendingCount > 0) {
        try {
          const flushed = await flushOfflineQueue();
          await loadData();
          if (flushed > 0) {
            showToast(`تم استعادة الاتصال — تم رفع (${flushed}) حركات وتحديث البيانات تلقائياً ✓`);
          } else if (liveConnectionMode === 'offline_cached') {
            showToast('تم استعادة الاتصال وتحديث البيانات من السيرفر تلقائياً ✓');
          }
        } catch {
          // Still offline
        }
      }
    }, 5000);

    const handleOnline = async () => {
      try {
        const flushed = await flushOfflineQueue();
        await loadData();
        if (flushed > 0) {
          showToast(`تم استعادة الاتصال — تم رفع (${flushed}) حركات وتحديث البيانات تلقائياً ✓`);
        } else {
          showToast('تم استعادة الاتصال وتحديث أحدث البيانات تلقائياً ✓');
        }
      } catch {
        // ignore
      }
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      flushOfflineQueue()
        .then((flushed) => {
          if (flushed > 0) {
            showToast(`تمت مزامنة (${flushed}) حركات محفوظة على الهاتف تلقائياً ✓`);
          }
          loadData();
        })
        .catch(() => {
          loadData();
        });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      es?.close();
      if (cloudSyncDebounce) clearTimeout(cloudSyncDebounce);
      unsubscribeGlobalCloudSync();
      clearInterval(pollInterval);
      clearInterval(fastRecoveryInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [authSession?.token, liveConnectionMode, loadData, showToast]);

  const handleManualFlushSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      showToast('الهاتف في وضع الأوفلاين حالياً — جميع حركاتك محفوظة بأمان على الجهاز وسيتم رفعها فور عودة الإنترنت', 'error');
      return;
    }
    const flushed = await flushOfflineQueue();
    await loadData();
    if (flushed > 0) {
      showToast(`تم رفع ومزامنة (${flushed}) حركات مع السيرفر بنجاح ✓`);
    } else {
      showToast('جميع البيانات محدثة ومتزامنة بالفعل ✓');
    }
  }, [loadData, showToast]);

  const authUser = data?.auth?.user || authSession?.user || null;
  const permissions = data?.auth?.permissions || authSession?.permissions || [];
  const role = authUser?.role || '';

  const walkie = useWalkieTalkie({
    authUser: authSession?.token ? authUser : null,
    permissions,
    onToast: showToast,
  });

  // Dark Mode applies to staff/admin, while Worker Kiosk ALWAYS stays in bright Daylight mode!
  useEffect(() => {
    const shouldBeDark = darkMode && role !== 'kiosk';
    document.body.classList.toggle('dark-theme', shouldBeDark);
    localStorage.setItem('zayed_dark_mode', String(darkMode));
  }, [darkMode, role]);

  useEffect(() => {
    document.body.classList.remove('font-cairo', 'font-tajawal', 'font-readex');
    if (fontFamily === 'tajawal') {
      document.body.classList.add('font-tajawal');
    } else if (fontFamily === 'readex') {
      document.body.classList.add('font-readex');
    } else {
      document.body.classList.add('font-cairo');
    }
    localStorage.setItem('zayed_font_family_v2', fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('scale-normal', 'scale-large', 'scale-xlarge');
    html.classList.add(fontScale);
    localStorage.setItem('zayed_font_scale', fontScale);
  }, [fontScale]);

  useEffect(() => {
    setLiteModeEnabled(liteMode);
  }, [liteMode]);

  // Native Android Hardware Back Button handler (closes open sheets/modals before exiting)
  useEffect(() => {
    const handleAndroidBack = (ev) => {
      if (previewModal) {
        ev?.preventDefault?.();
        setPreviewModal(null);
        return;
      }
      if (walkie.consoleOpen) {
        ev?.preventDefault?.();
        walkie.setConsoleOpen(false);
        return;
      }
      if (qrModalTab) {
        ev?.preventDefault?.();
        setQrModalTab(null);
        return;
      }
      if (showHandoverModal) {
        ev?.preventDefault?.();
        setShowHandoverModal(false);
        return;
      }
      if (showProfileModal) {
        ev?.preventDefault?.();
        setShowProfileModal(false);
        return;
      }
      if (personLogTarget) {
        ev?.preventDefault?.();
        setPersonLogTarget(null);
        return;
      }
      if (role === 'kiosk') {
        ev?.preventDefault?.();
        showToast('وضع الكشك المقيد مفعّل — استخدم زر الخروج العلوي لتغيير الحساب');
        return;
      }
      const homeTab = getPreferredAllowedTab(role, permissions);
      if (authSession?.token && activeTab !== homeTab) {
        ev?.preventDefault?.();
        setActiveTab(homeTab);
        return;
      }
      const now = Date.now();
      if (now - lastBackPressRef.current < 2200) {
        window.ZayedAndroidBridge?.exitApp?.();
        window.Capacitor?.Plugins?.App?.exitApp?.();
      } else {
        ev?.preventDefault?.();
        lastBackPressRef.current = now;
        showToast('اضغط زر الرجوع مرة أخرى للخروج من التطبيق');
      }
    };

    window.addEventListener('zayed:android-back', handleAndroidBack);
    let capListener = null;
    try {
      const capApp = window.Capacitor?.Plugins?.App;
      if (capApp?.addListener) {
        capListener = capApp.addListener('backButton', () => handleAndroidBack());
      }
    } catch {
      // ignore
    }
    return () => {
      window.removeEventListener('zayed:android-back', handleAndroidBack);
      try {
        capListener?.remove?.();
      } catch {
        // ignore
      }
    };
  }, [
    previewModal,
    walkie,
    qrModalTab,
    showHandoverModal,
    showProfileModal,
    personLogTarget,
    role,
    permissions,
    authSession?.token,
    activeTab,
    showToast,
  ]);

  const canAttendance = hasAnyPermission(permissions, role, [
    'attendance:self',
    'attendance:read',
    'attendance:write',
    'attendance:kiosk',
  ]);
  const canShortages = hasAnyPermission(permissions, role, [
    'shortages:read',
    'shortages:write',
    'shortages:manage',
  ]);
  const canTrucks = hasAnyPermission(permissions, role, ['trucks:read', 'trucks:write']);
  const canNotes = hasAnyPermission(permissions, role, ['notes:read', 'notes:write']);
  const canChat = hasAnyPermission(permissions, role, ['chat:read', 'chat:write']);
  const canDashboard = hasAnyPermission(permissions, role, [
    'reports:view',
    'staff:manage',
    'suppliers:manage',
    'users:manage',
    'audit:view',
    'settings:manage',
    'backup:manage',
  ]);

  // Strict RBAC tab guard: never allow any role to view an unpermitted tab
  useEffect(() => {
    if (!authSession?.token || role === 'kiosk') return;
    const tabAllowed =
      (activeTab === 'attendance' && canAttendance) ||
      (activeTab === 'shortages' && canShortages) ||
      (activeTab === 'trucks' && canTrucks) ||
      (activeTab === 'notes' && canNotes) ||
      (activeTab === 'chat' && canChat) ||
      (activeTab === 'dashboard' && canDashboard);

    if (!tabAllowed) {
      setActiveTab(getPreferredAllowedTab(role, permissions));
    }
  }, [
    authSession?.token,
    role,
    permissions,
    activeTab,
    canAttendance,
    canShortages,
    canTrucks,
    canNotes,
    canChat,
    canDashboard,
  ]);

  function cycleFontScale() {
    setFontScale((prev) =>
      prev === 'scale-normal'
        ? 'scale-large'
        : prev === 'scale-large'
        ? 'scale-xlarge'
        : 'scale-normal'
    );
  }

  async function handleLogout() {
    await logoutSession();
    setQrModalTab(null);
    setShowHandoverModal(false);
    setAuthSessionState(null);
    setData(null);
  }

  async function handleLockToKiosk() {
    try {
      const nextSession = await lockDeviceToKiosk();
      setQrModalTab(null);
      setShowHandoverModal(false);
      setAuthSessionState(nextSession);
      showToast('تم قفل الجهاز بأمان على وضع كشك حضور العمال ✓');
    } catch (err) {
      showToast(err.message || 'تعذر تفعيل وضع الكشك', 'error');
    }
  }

  // 1. Unauthenticated Gate -> Password Pad
  if (!authSession?.token) {
    return (
      <AuthLoginScreen
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        liteMode={liteMode}
        onToggleLiteMode={() => {
          setLiteMode((l) => {
            const next = !l;
            showToast(
              next
                ? 'تم تفعيل وضع الأداء الخفيف للهواتف الاقتصادية ⚡'
                : 'تم تفعيل الوضع البصري الكامل'
            );
            return next;
          });
        }}
        onLoginSuccess={(session) => {
          setAuthSessionState(session);
          setActiveTab(getPreferredAllowedTab(session.user?.role || '', session.permissions || []));
        }}
      />
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-[100dvh] bg-[var(--g-bg)] px-3 sm:px-6 py-4 space-y-5 max-w-7xl mx-auto">
        <div className="h-14 rounded-2xl bg-[var(--g-surface)] border border-[var(--g-border)] px-4 flex items-center gap-3">
          <img
            src="/Logo.png"
            onError={(e) => {
              if (e.currentTarget.src.endsWith('/Logo.png')) {
                e.currentTarget.src = '/logo.jpeg';
              }
            }}
            alt="زايد مارت"
            className="w-9 h-9 rounded-xl object-cover border border-[var(--g-border)] bg-white"
          />
          <div className="font-extrabold text-sm sm:text-base text-[var(--g-text)]">
            جاري تجهيز لوحة زايد مارت...
          </div>
        </div>
        <SkeletonKpiStrip count={4} />
        <SkeletonList rows={5} />
      </div>
    );
  }

  // 2. Dedicated Least-Privilege Bright-Daylight Worker Kiosk Mode
  if (role === 'kiosk') {
    return (
      <>
        <KioskLockView
          storeName={data?.settings?.store_name || 'زايد مارت'}
          employees={data?.employees || []}
          onOpenQrModal={(tab) => setQrModalTab(tab || 'scan')}
          onRefresh={loadData}
          onExitKiosk={handleLogout}
        />
        <QrQuickModal
          open={Boolean(qrModalTab)}
          initialTab={qrModalTab || 'scan'}
          onClose={() => setQrModalTab(null)}
          employees={data?.employees || []}
          storeName={data?.settings?.store_name || 'زايد مارت'}
          actorName="كشك العمال"
          voiceConfirmEnabled={voiceConfirmEnabled}
          canPrintCards={false}
          onRefresh={loadData}
          onToast={showToast}
        />
      </>
    );
  }

  const actorName = authUser?.display_name || 'المستخدم';
  const canVerify = hasPermission(permissions, role, 'attendance:verify');
  const canWriteAttendance = hasAnyPermission(permissions, role, [
    'attendance:write',
    'attendance:kiosk',
  ]);
  const canSelfAttendance = hasPermission(permissions, role, 'attendance:self');
  const canReadAttendance = hasPermission(permissions, role, 'attendance:read');
  const canPrintCards = hasAnyPermission(permissions, role, [
    'staff:manage',
    'attendance:read',
  ]);
  const canWriteShortages = hasPermission(permissions, role, 'shortages:write');
  const canManageShortages = hasPermission(permissions, role, 'shortages:manage');
  const canWriteTrucks = hasPermission(permissions, role, 'trucks:write');
  const canClearReturn = hasPermission(permissions, role, 'suppliers:clear_return');
  const canWriteNotes = hasPermission(permissions, role, 'notes:write');
  const canResolveNotes = hasPermission(permissions, role, 'notes:resolve');
  const canHandover = hasPermission(permissions, role, 'handover:manage');
  const canManageStaff = hasPermission(permissions, role, 'staff:manage');
  const canManageSuppliers = hasPermission(permissions, role, 'suppliers:manage');
  const canExportReports = hasPermission(permissions, role, 'reports:export');
  const canManageRecords = hasPermission(permissions, role, 'records:manage');

  const permittedTabsCount = [
    canAttendance,
    canShortages,
    canTrucks,
    canNotes,
    canChat,
    canDashboard,
  ].filter(Boolean).length;

  function handleJumpToRealData(subTabId = 'staff') {
    setDashboardSubTab(subTabId);
    setActiveTab('dashboard');
  }

  function handleSmartJumpTab(tabId, filterOpts = null) {
    setActiveTab(tabId);
    if (tabId === 'attendance' && filterOpts?.status) {
      setAttendanceFilterRequest({
        status: filterOpts.status,
        ts: Date.now(),
      });
    }
  }

  return (
    <div
      className={`min-h-[100dvh] w-full flex flex-col overflow-x-hidden ${
        permittedTabsCount > 1
          ? walkie.canUseWalkie
            ? 'pb-38 md:pb-24'
            : 'pb-24 md:pb-6'
          : walkie.canUseWalkie
          ? 'pb-24'
          : 'pb-6'
      }`}
    >
      <TopBar
        storeName={data?.settings?.store_name}
        branchName={data?.settings?.branch_name}
        authUser={authUser}
        permissions={permissions}
        onLockToKiosk={handleLockToKiosk}
        onLogout={handleLogout}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        summary={data?.summary}
        connectionMode={liveConnectionMode === 'offline_cached' ? 'offline_cached' : data?.connectionMode}
        offlineQueueCount={offlineQueueCount}
        isSyncing={isSyncing}
        onFlushOfflineQueue={handleManualFlushSync}
        onToast={showToast}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        liteMode={liteMode}
        onToggleLiteMode={() => {
          setLiteMode((l) => {
            const next = !l;
            showToast(
              next
                ? 'تم تفعيل وضع الأداء الخفيف للهواتف الاقتصادية ⚡'
                : 'تم تفعيل الوضع البصري الكامل'
            );
            return next;
          });
        }}
        fontScale={fontScale}
        onCycleFontScale={cycleFontScale}
        fontFamily={fontFamily}
        onToggleFontFamily={() =>
          setFontFamily((f) =>
            f === 'cairo' ? 'tajawal' : f === 'tajawal' ? 'readex' : 'cairo'
          )
        }
        selectedDate={selectedDate}
        onChangeDate={setSelectedDate}
        todayKey={todayKey}
        onOpenQrModal={() => setQrModalTab('code')}
        onOpenHandoverModal={() => setShowHandoverModal(true)}
        onOpenProfileModal={() => setShowProfileModal(true)}
        canUseWalkie={walkie.canUseWalkie}
        walkieActive={walkie.radioEnabled}
        onOpenWalkieModal={() => walkie.setConsoleOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-5">
        {/* Live Shift Handover + Smart Timers + Buddy-Punching Verification Strip (Strictly Filtered by Role!) */}
        <SmartAlertsAndHandoverBar
          data={data}
          canAttendance={canAttendance}
          canTrucks={canTrucks}
          canHandover={canHandover}
          canVerify={canVerify}
          actorName={actorName}
          actorRole={role}
          showHandoverModal={showHandoverModal}
          onCloseHandoverModal={() => setShowHandoverModal(false)}
          onJumpTab={handleSmartJumpTab}
          onRefresh={loadData}
          onToast={showToast}
        />

        {activeTab === 'attendance' && canAttendance && (
          <AttendanceView
            employees={data?.employees || []}
            attendanceLogs={data?.attendanceLogs || []}
            maxBreakMinutes={data?.settings?.max_break_minutes || 30}
            actorName={actorName}
            actorRole={role}
            myProfile={data?.myProfile}
            filterRequest={attendanceFilterRequest}
            canWrite={canWriteAttendance}
            canSelfAttendance={canSelfAttendance}
            canVerify={canVerify}
            canReadLogs={canReadAttendance}
            canPrintCards={canPrintCards}
            canManageStaff={canManageStaff}
            canManageRecords={canManageRecords}
            onJumpToRealData={handleJumpToRealData}
            voiceConfirmEnabled={voiceConfirmEnabled}
            onOpenQrModal={(tab) => setQrModalTab(tab || 'code')}
            onOpenPersonLog={(id, name) => setPersonLogTarget({ id, name })}
            onRefresh={loadData}
            onToast={showToast}
            onPreviewImage={(url, title) => setPreviewModal({ url, title })}
          />
        )}

        {activeTab === 'shortages' && canShortages && (
          <ShortagesView
            shortages={data?.shortages || []}
            productCatalog={data?.productCatalog || []}
            suppliers={data?.suppliers || []}
            storeName={data?.settings?.store_name || 'زايد مارت'}
            dateKey={data?.dateKey || selectedDate}
            voiceEnabled={voiceConfirmEnabled}
            canWrite={canWriteShortages}
            canManageShortages={canManageShortages}
            canManageRecords={canManageRecords}
            canExport={canExportReports}
            canHandover={canHandover}
            onOpenHandoverModal={() => setShowHandoverModal(true)}
            onRefresh={loadData}
            onToast={showToast}
          />
        )}

        {activeTab === 'trucks' && canTrucks && (
          <TrucksView
            suppliers={data?.suppliers || []}
            truckLogs={data?.truckLogs || []}
            maxUnloadMinutes={data?.settings?.max_unload_minutes || 60}
            actorName={actorName}
            actorRole={role}
            canWrite={canWriteTrucks}
            canClearReturn={canClearReturn}
            canManageSuppliers={canManageSuppliers}
            canManageRecords={canManageRecords}
            onJumpToRealData={handleJumpToRealData}
            voiceConfirmEnabled={voiceConfirmEnabled}
            onRefresh={loadData}
            onToast={showToast}
            onPreviewImage={(url, title) => setPreviewModal({ url, title })}
          />
        )}

        {activeTab === 'notes' && canNotes && (
          <CctvNotesView
            notes={data?.notes || []}
            handovers={data?.handovers || []}
            summary={data?.summary || {}}
            actorName={actorName}
            actorRole={role}
            canWrite={canWriteNotes}
            canResolveNotes={canResolveNotes}
            canHandover={canHandover}
            canManageRecords={canManageRecords}
            onOpenHandoverModal={() => setShowHandoverModal(true)}
            onRefresh={loadData}
            onToast={showToast}
            onPreviewImage={(url, title) => setPreviewModal({ url, title })}
          />
        )}

        {activeTab === 'chat' && canChat && (
          <TeamChatView
            teamMessages={data?.teamMessages || []}
            authUser={authUser}
            permissions={permissions}
            walkie={walkie}
            onRefresh={loadData}
            onToast={showToast}
          />
        )}

        {activeTab === 'dashboard' && canDashboard && data && (
          <AdminDashboard
            data={data}
            authUser={authUser}
            permissions={permissions}
            requestedSubTab={dashboardSubTab}
            onClearRequestedSubTab={() => setDashboardSubTab(null)}
            voiceConfirmEnabled={voiceConfirmEnabled}
            onToggleVoiceConfirm={() => {
              setVoiceConfirmEnabled((v) => {
                localStorage.setItem('zayed_voice_confirm', String(!v));
                return !v;
              });
            }}
            onOpenQrModal={(tab) => setQrModalTab(tab || 'cards')}
            onOpenPersonLog={(id, name) => setPersonLogTarget({ id, name })}
            onRefresh={loadData}
            onToast={showToast}
            onPreviewImage={(url, title) => setPreviewModal({ url, title })}
          />
        )}
      </main>

      {/* Mobile Google Material 3 Bottom Navigation Bar */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        authUser={authUser}
        permissions={permissions}
        summary={data?.summary}
        onOpenQrModal={() => setQrModalTab('code')}
        onOpenHandoverModal={() => setShowHandoverModal(true)}
        onOpenWalkieModal={() => walkie.setConsoleOpen(true)}
        canUseWalkie={walkie.canUseWalkie}
      />

      {/* Context-Aware Smart FAB + Quick Dial (right thumb-zone, opposite WalkieFloatingDock) */}
      <SmartFab
        activeTab={activeTab}
        hasBottomNav={permittedTabsCount > 1}
        canWriteAttendance={canWriteAttendance}
        canQr={canWriteAttendance || canSelfAttendance || canPrintCards}
        canWriteShortages={canWriteShortages}
        canWriteTrucks={canWriteTrucks}
        canWriteNotes={canWriteNotes}
        canHandover={canHandover}
        onOpenQr={() => setQrModalTab('code')}
        onOpenHandover={() => setShowHandoverModal(true)}
        onPrimaryAction={(action) => {
          const tabMap = {
            shortage_add: 'shortages',
            truck_arrive: 'trucks',
            note_add: 'notes',
          };
          const targetTab = tabMap[action];
          if (targetTab && activeTab !== targetTab) {
            setActiveTab(targetTab);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('zayed:open-composer', { detail: { action } }));
            }, 60);
          } else if (action) {
            window.dispatchEvent(new CustomEvent('zayed:open-composer', { detail: { action } }));
          }
        }}
      />

      {/* Floating Tactical Walkie-Talkie Quick-PTT Dock */}
      <WalkieFloatingDock
        walkie={walkie}
        hasBottomNav={permittedTabsCount > 1}
      />

      {/* Full Walkie-Talkie Tactical Console Modal */}
      <WalkieTalkieConsole
        open={walkie.consoleOpen}
        onClose={() => walkie.setConsoleOpen(false)}
        walkie={walkie}
        authUser={authUser}
        canManageRecords={canManageRecords}
      />

      {/* QR Card & Quick Code Modal */}
      <QrQuickModal
        open={Boolean(qrModalTab)}
        initialTab={qrModalTab || 'code'}
        onClose={() => setQrModalTab(null)}
        employees={data?.employees || []}
        storeName={data?.settings?.store_name || 'زايد مارت'}
        actorName={actorName}
        voiceConfirmEnabled={voiceConfirmEnabled}
        canPrintCards={canPrintCards}
        onRefresh={loadData}
        onToast={showToast}
      />

      {/* Personal Profile Modal (Password, Personal QR & Personal Activity Log) */}
      <ProfileModal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        authUser={authUser}
        onToast={showToast}
      />

      {/* Individual Employee / User Full Log Modal */}
      <PersonLogModal
        open={Boolean(personLogTarget)}
        personId={personLogTarget?.id}
        personName={personLogTarget?.name}
        onClose={() => setPersonLogTarget(null)}
        onToast={showToast}
      />

      {/* Lightbox Image Preview Modal */}
      {previewModal && (
        <div onClick={() => setPreviewModal(null)} className="g-modal-overlay">
          <div
            onClick={(e) => e.stopPropagation()}
            className="g-dialog-sheet max-w-3xl p-0 overflow-hidden animate-pop"
          >
            <div className="p-4 flex items-center justify-between border-b border-[var(--g-border)]">
              <h3 className="text-sm sm:text-base font-extrabold m-0 truncate">
                {previewModal.title}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="w-9 h-9 rounded-full bg-[var(--g-surface-variant)] flex items-center justify-center shrink-0"
              >
                <span className="ms-icon">close</span>
              </button>
            </div>
            <div className="p-3 sm:p-4 bg-black/95 flex items-center justify-center">
              <img
                src={previewModal.url}
                alt={previewModal.title}
                className="max-h-[72dvh] w-auto object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {/* Google Material Snackbar Toast */}
      {toast && (
        <div
          className={`fixed ${
            permittedTabsCount > 1 ? 'bottom-20 md:bottom-6' : 'bottom-6'
          } left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-md px-4 py-3.5 rounded-2xl shadow-lg flex items-center gap-2.5 text-xs sm:text-sm font-bold animate-pop bg-[#1F1F1F] text-white`}
        >
          <span
            className={`ms-icon filled text-lg shrink-0 ${
              toast.type === 'error' ? 'text-[#F28B82]' : 'text-[#81C995]'
            }`}
          >
            {toast.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span className="leading-snug">{toast.message}</span>
        </div>
      )}
    </div>
  );
}

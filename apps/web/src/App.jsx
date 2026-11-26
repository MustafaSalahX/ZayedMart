import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AmbientBackdrop from './components/AmbientBackdrop.jsx';
import AppShell from './components/AppShell.jsx';
import ShadcnSidebar from './components/ShadcnSidebar.jsx';
import TopBar from './components/TopBar.jsx';
import BottomNav from './components/BottomNav.jsx';
import SmartAlertsAndHandoverBar from './components/SmartAlertsAndHandoverBar.jsx';
import QrQuickModal from './components/QrQuickModal.jsx';
import AttendanceView from './components/AttendanceView.jsx';
import TrucksView from './components/TrucksView.jsx';
import ShortagesView from './components/ShortagesView.jsx';
import ScheduleView from './components/ScheduleView.jsx';
import CctvNotesView from './components/CctvNotesView.jsx';
import TeamChatView from './components/TeamChatView.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import SettingsView from './components/SettingsView.jsx';
import KioskLockView from './components/KioskLockView.jsx';
import AuthLoginScreen from './components/AuthLoginScreen.jsx';
import ProfileModal from './components/ProfileModal.jsx';
import PersonLogModal from './components/PersonLogModal.jsx';
import WalkieFloatingDock from './components/WalkieFloatingDock.jsx';
import WalkieTalkieConsole from './components/WalkieTalkieConsole.jsx';
import { popModalLayer, pushModalLayer } from './components/ui/BottomSheet.jsx';
import {
  BrandLogo,
  Icon,
  SkeletonKpiStrip,
  SkeletonList,
  SmartFab,
  ToastHost,
} from './components/ui/index.js';
import {
  fetchBootstrap,
  fetchBootstrapIfNeeded,
  flushOfflineQueue,
  getOfflineQueue,
  getCachedAuthSession,
  setAuthSession,
  onAuthInvalidated,
  logoutSession,
  lockDeviceToKiosk,
  hasPermission,
  hasAnyPermission,
  resolveApiUrl,
  isDirectCloudToken,
} from './lib/api.js';
import { subscribeSyncState } from './lib/localDb.js';
import { playSuccessChime } from './lib/audio.js';
import { buildNavTabs, getPreferredAllowedTab } from './lib/navigation.js';
import { subscribeGlobalStoreSync } from './lib/supabaseRealtime.js';
import { useTheme } from './lib/themeContext.jsx';
import { emitWalkieSseEvent, useWalkieTalkie } from './lib/useWalkieTalkie.js';

function getTodayLocalKey() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

const VALID_URL_TABS = [
  'attendance',
  'shortages',
  'schedule',
  'trucks',
  'notes',
  'chat',
  'dashboard',
  'settings',
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'zayed_shadcn_sidebar_collapsed_v1';

export default function App() {
  const todayKey = getTodayLocalKey();
  const {
    architecture,
    darkMode,
    toggleDarkMode,
    fontScale,
    cycleFontScale,
    fontFamily,
    cycleFontFamily,
    liteMode,
    setLiteMode,
    setKioskLocked,
    voiceConfirm: voiceConfirmEnabled,
    setVoiceConfirm: setVoiceConfirmEnabled,
    applyServerPrefs,
  } = useTheme();
  const hasShadcnSidebar =
    architecture?.shell?.sidebarLayout === 'shadcn-collapsible-rail';

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  }, []);

  const [authSession, setAuthSessionState] = useState(() => getCachedAuthSession());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const requestedTab = new URLSearchParams(window.location.search).get('tab');
      if (VALID_URL_TABS.includes(requestedTab)) {
        return requestedTab;
      }
    }
    const cached = getCachedAuthSession();
    return getPreferredAllowedTab(cached?.user?.role || '', cached?.permissions || []);
  });
  const [settingsSection, setSettingsSection] = useState('profile');
  const lastBackPressRef = useRef(0);
  const hydratedPrefsUserRef = useRef('');

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
  const latestRealtimeMetaRef = useRef({
    role: '',
    myEmployeeId: '',
    canSchedule: false,
    canManageSchedule: false,
  });
  const seenSwapNotifRef = useRef(new Map());

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 3400);
  }, []);

  const handleOpenSettings = useCallback((section = 'profile') => {
    setSettingsSection(typeof section === 'string' && section ? section : 'profile');
    setShowProfileModal(false);
    setActiveTab('settings');
  }, []);

  // Immediate (<50ms) state sync when a user updates their photo, username, display name, or password
  const handleUserUpdated = useCallback((updatedUser, freshToken) => {
    if (!updatedUser) return;
    setAuthSessionState((prev) => {
      const token = freshToken || prev?.token || '';
      const perms = prev?.permissions || [];
      const mergedUser = { ...(prev?.user || {}), ...updatedUser };
      if (token && mergedUser.id) {
        setAuthSession(token, mergedUser, perms);
      }
      return prev
        ? {
            ...prev,
            token,
            user: mergedUser,
          }
        : prev;
    });

    setData((prev) => {
      if (!prev) return prev;
      const mergedAuthUser = { ...(prev.auth?.user || {}), ...updatedUser };
      const nextMyProfile = prev.myProfile
        ? {
            ...prev.myProfile,
            ...updatedUser,
            effective_avatar_url:
              updatedUser.avatar_url ??
              updatedUser.effective_avatar_url ??
              prev.myProfile.effective_avatar_url,
          }
        : prev.myProfile;
      const targetEmpId = updatedUser.employee_id || prev.myProfile?.employee_id || '';
      const nextEmployees = Array.isArray(prev.employees)
        ? prev.employees.map((e) =>
            targetEmpId && e.id === targetEmpId
              ? {
                  ...e,
                  name: updatedUser.display_name || e.name,
                  avatar_url:
                    updatedUser.avatar_url !== undefined ? updatedUser.avatar_url : e.avatar_url,
                  avatar_preset:
                    updatedUser.avatar_preset !== undefined
                      ? updatedUser.avatar_preset
                      : e.avatar_preset,
                  avatar_color: updatedUser.avatar_color || e.avatar_color,
                }
              : e
          )
        : prev.employees;

      return {
        ...prev,
        auth: prev.auth ? { ...prev.auth, user: mergedAuthUser } : prev.auth,
        myProfile: nextMyProfile,
        employees: nextEmployees,
      };
    });
  }, []);

  // Listen for 401 session expiration / remote session revocation
  useEffect(() => {
    return onAuthInvalidated(() => {
      setAuthSessionState(null);
      setData(null);
      hydratedPrefsUserRef.current = '';
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

  const applyBootstrapSnapshot = useCallback(
    (snap) => {
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
        const userId = snap.auth.user.id || '';
        const serverPrefs =
          snap.myProfile?.preferences || snap.auth.user?.preferences || null;
        if (
          userId &&
          hydratedPrefsUserRef.current !== userId &&
          serverPrefs &&
          Object.keys(serverPrefs).length > 0
        ) {
          hydratedPrefsUserRef.current = userId;
          applyServerPrefs(serverPrefs);
        }
      }
      setOfflineQueueCount(getOfflineQueue().length);
    },
    [applyServerPrefs]
  );

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
        es.addEventListener('update', (ev) => {
          try {
            const payload = ev?.data ? JSON.parse(ev.data) : {};
            if (
              payload?.reason === 'day_off_schedule' ||
              payload?.reason === 'day_off_swap' ||
              payload?.reason === 'day_off_settings'
            ) {
              window.dispatchEvent(
                new CustomEvent('zayed:schedule-updated', { detail: payload })
              );
            }
          } catch {
            // ignore malformed update event data
          }
          loadData();
        });
        es.addEventListener('day_off_swap', (ev) => {
          try {
            const payload = JSON.parse(ev.data || '{}');
            const meta = latestRealtimeMetaRef.current;
            if (meta.role === 'kiosk' || !meta.canSchedule) return;
            window.dispatchEvent(new CustomEvent('zayed:schedule-updated', { detail: payload }));
            loadData();
            const hasMeta = Boolean(payload?.requestId || payload?.action || payload?.status);
            const dedupeKey = hasMeta
              ? `${payload?.requestId || ''}:${payload?.action || ''}:${payload?.status || ''}`
              : '';
            const nowMs = Date.now();
            const lastSeen = dedupeKey ? seenSwapNotifRef.current.get(dedupeKey) || 0 : 0;
            if (!dedupeKey || nowMs - lastSeen > 4000) {
              if (dedupeKey) seenSwapNotifRef.current.set(dedupeKey, nowMs);
              playSuccessChime('alert');
              showToast(payload?.message || 'يوجد تحديث جديد في طلبات تبديل الإجازات');
            }
          } catch {
            // ignore
          }
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
    const unsubscribeGlobalCloudSync = subscribeGlobalStoreSync((payload) => {
      if (
        payload?.reason === 'day_off_swap' ||
        payload?.reason === 'day_off_schedule' ||
        payload?.reason === 'day_off_settings'
      ) {
        const meta = latestRealtimeMetaRef.current;
        if (meta.role !== 'kiosk' && meta.canSchedule) {
          window.dispatchEvent(
            new CustomEvent('zayed:schedule-updated', { detail: payload || {} })
          );
          if (payload?.reason === 'day_off_swap') {
            const targetIds = Array.isArray(payload?.targetEmployeeIds)
              ? payload.targetEmployeeIds
              : [];
            const isTargetedEmp = Boolean(
              meta.myEmployeeId && targetIds.includes(meta.myEmployeeId)
            );
            const isTargetedMgr = Boolean(payload?.notifyManagers && meta.canManageSchedule);
            if (isTargetedEmp || isTargetedMgr) {
              const hasMeta = Boolean(payload?.requestId || payload?.action || payload?.status);
              const dedupeKey = hasMeta
                ? `${payload?.requestId || ''}:${payload?.action || ''}:${payload?.status || ''}`
                : '';
              const nowMs = Date.now();
              const lastSeen = dedupeKey ? seenSwapNotifRef.current.get(dedupeKey) || 0 : 0;
              if (!dedupeKey || nowMs - lastSeen > 4000) {
                if (dedupeKey) seenSwapNotifRef.current.set(dedupeKey, nowMs);
                playSuccessChime('alert');
                showToast(payload?.message || 'يوجد تحديث جديد في طلبات تبديل الإجازات');
              }
            }
          }
        }
      }
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
            showToast(`تم استعادة الاتصال ومزامنة (${flushed}) حركات`);
          } else if (liveConnectionMode === 'offline_cached') {
            showToast('تم استعادة الاتصال وتحديث البيانات');
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
          showToast(`تم استعادة الاتصال ومزامنة (${flushed}) حركات`);
        } else {
          showToast('تم استعادة الاتصال وتحديث البيانات');
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
            showToast(`تمت مزامنة (${flushed}) حركات`);
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
  }, [authSession?.token, liveConnectionMode, loadData, loadDataIfChanged, showToast]);

  const handleManualFlushSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      showToast(
        'الهاتف في وضع الأوفلاين حالياً — جميع حركاتك محفوظة بأمان على الجهاز وسيتم رفعها فور عودة الإنترنت',
        'error'
      );
      return;
    }
    const flushed = await flushOfflineQueue();
    await loadData();
    if (flushed > 0) {
      showToast(`تمت مزامنة (${flushed}) حركات`);
    } else {
      showToast('جميع البيانات محدثة');
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

  // Enforce bright Daylight Classic theme when locked to Worker Kiosk (unmounts AmbientBackdrop cleanly)
  useEffect(() => {
    setKioskLocked(role === 'kiosk');
    return () => setKioskLocked(false);
  }, [role, setKioskLocked]);

  // Keyboard toggle (Ctrl+B / Cmd+B) for Shadcn collapsible sidebar
  useEffect(() => {
    if (!hasShadcnSidebar || !authSession?.token || role === 'kiosk') return undefined;
    const onKeyDown = (e) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        String(e.key || '').toLowerCase() === 'b'
      ) {
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasShadcnSidebar, authSession?.token, role, handleToggleSidebar]);

  // Close Lightbox Preview on Escape key + coordinate modal floating-chrome hide layer
  const previewOpen = Boolean(previewModal);
  useEffect(() => {
    if (!previewOpen) return undefined;
    pushModalLayer();
    const onKey = (e) => {
      if (e.key === 'Escape') setPreviewModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      popModalLayer();
    };
  }, [previewOpen]);

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
  const canSchedule = hasAnyPermission(permissions, role, [
    'schedule:read',
    'schedule:manage',
    'schedule:swap_request',
  ]);
  const canManageSchedule = hasPermission(permissions, role, 'schedule:manage');
  const canSwapSchedule = hasAnyPermission(permissions, role, [
    'schedule:swap_request',
    'schedule:manage',
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
  const canSettings = Boolean(role && role !== 'kiosk');

  latestRealtimeMetaRef.current = {
    role,
    myEmployeeId:
      data?.dayOffSchedule?.myEmployeeId ||
      data?.myProfile?.employee_id ||
      authUser?.employee_id ||
      '',
    canSchedule,
    canManageSchedule,
  };

  // Strict RBAC tab guard: never allow any role to view an unpermitted tab
  useEffect(() => {
    if (!authSession?.token || role === 'kiosk') return;
    const tabAllowed =
      (activeTab === 'attendance' && canAttendance) ||
      (activeTab === 'shortages' && canShortages) ||
      (activeTab === 'schedule' && canSchedule) ||
      (activeTab === 'trucks' && canTrucks) ||
      (activeTab === 'notes' && canNotes) ||
      (activeTab === 'chat' && canChat) ||
      (activeTab === 'dashboard' && canDashboard) ||
      (activeTab === 'settings' && canSettings);

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
    canSchedule,
    canTrucks,
    canNotes,
    canChat,
    canDashboard,
    canSettings,
  ]);

  async function handleLogout() {
    await logoutSession();
    setQrModalTab(null);
    setShowHandoverModal(false);
    setShowProfileModal(false);
    setAuthSessionState(null);
    setData(null);
    hydratedPrefsUserRef.current = '';
  }

  async function handleLockToKiosk() {
    try {
      const nextSession = await lockDeviceToKiosk();
      setQrModalTab(null);
      setShowHandoverModal(false);
      setShowProfileModal(false);
      setAuthSessionState(nextSession);
      showToast('تم قفل الجهاز على وضع الكشك');
    } catch (err) {
      showToast(err.message || 'تعذر تفعيل وضع الكشك', 'error');
    }
  }

  // 1. Unauthenticated Gate -> Role Photo & Password Login Screen
  if (!authSession?.token) {
    return (
      <>
        <AmbientBackdrop />
        <AuthLoginScreen
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          liteMode={liteMode}
          onToggleLiteMode={() => {
            setLiteMode((l) => {
              const next = !l;
              showToast(next ? 'تم تفعيل الأداء الخفيف' : 'تم تفعيل الوضع الكامل');
              return next;
            });
          }}
          onToast={showToast}
          onLoginSuccess={(session) => {
            setAuthSessionState(session);
            if (session.user?.preferences) {
              hydratedPrefsUserRef.current = session.user.id || '';
              applyServerPrefs(session.user.preferences);
            }
            setActiveTab(
              getPreferredAllowedTab(session.user?.role || '', session.permissions || [])
            );
          }}
        />
        <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      </>
    );
  }

  if (loading && !data) {
    return (
      <div className="min-h-[100dvh] bg-canvas px-3 sm:px-6 py-4 space-y-5 max-w-7xl mx-auto">
        <div className="h-14 rounded-2xl bg-surface border border-line px-4 flex items-center gap-3">
          <BrandLogo alt="زايد مارت" size="sm" />
          <div className="font-extrabold text-sm sm:text-base text-ink">
            جاري تجهيز لوحة زايد مارت...
          </div>
        </div>
        <SkeletonKpiStrip count={4} />
        <SkeletonList count={5} />
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
        <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      </>
    );
  }

  const actorName = authUser?.display_name || 'المستخدم';
  const canVerify = hasPermission(permissions, role, 'attendance:verify');
  const canWriteAttendance = hasPermission(permissions, role, 'attendance:write');
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

  const navTabs = buildNavTabs({
    role,
    permissions,
    summary: data?.summary,
    includeSettings: true,
  });
  const hasBottomNav = navTabs.length > 1;
  const resolvedConnMode =
    liveConnectionMode === 'offline_cached' ? 'offline_cached' : data?.connectionMode;

  function handleJumpToRealData(subTabId = 'staff') {
    setDashboardSubTab(subTabId);
    setActiveTab('dashboard');
  }

  function handleSmartJumpTab(tabId, filterOpts = null) {
    if (tabId === 'settings') {
      handleOpenSettings(filterOpts?.section || 'profile');
      return;
    }
    setActiveTab(tabId);
    if (tabId === 'attendance' && filterOpts?.status) {
      setAttendanceFilterRequest({
        status: filterOpts.status,
        ts: Date.now(),
      });
    } else if (tabId === 'dashboard' && filterOpts?.subTab) {
      setDashboardSubTab(filterOpts.subTab);
    }
  }

  return (
    <AppShell
      hasBottomNav={hasBottomNav}
      sidebar={
        hasShadcnSidebar ? (
          <ShadcnSidebar
            collapsed={sidebarCollapsed}
            storeName={data?.settings?.store_name}
            branchName={data?.settings?.branch_name}
            authUser={authUser}
            permissions={permissions}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            summary={data?.summary}
            onOpenQrModal={() => setQrModalTab('code')}
            onOpenHandoverModal={() => setShowHandoverModal(true)}
            onOpenWalkieModal={() => walkie.setConsoleOpen(true)}
            onOpenProfileModal={() => setShowProfileModal(true)}
            onOpenSettings={handleOpenSettings}
            onLockToKiosk={handleLockToKiosk}
            onLogout={handleLogout}
            canUseWalkie={walkie.canUseWalkie}
            walkieActive={walkie.radioEnabled}
          />
        ) : null
      }
      header={
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
          connectionMode={resolvedConnMode}
          offlineQueueCount={offlineQueueCount}
          isSyncing={isSyncing}
          onFlushOfflineQueue={handleManualFlushSync}
          onToast={showToast}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          liteMode={liteMode}
          onToggleLiteMode={() => {
            setLiteMode((l) => {
              const next = !l;
              showToast(next ? 'تم تفعيل الأداء الخفيف' : 'تم تفعيل الوضع الكامل');
              return next;
            });
          }}
          fontScale={fontScale}
          onCycleFontScale={cycleFontScale}
          fontFamily={fontFamily}
          onToggleFontFamily={cycleFontFamily}
          selectedDate={selectedDate}
          onChangeDate={setSelectedDate}
          todayKey={todayKey}
          onOpenQrModal={() => setQrModalTab('code')}
          onOpenHandoverModal={() => setShowHandoverModal(true)}
          onOpenProfileModal={() => setShowProfileModal(true)}
          onOpenSettings={handleOpenSettings}
          canUseWalkie={walkie.canUseWalkie}
          walkieActive={walkie.radioEnabled}
          onOpenWalkieModal={() => walkie.setConsoleOpen(true)}
        />
      }
      footer={
        <>
          {/* Mobile Adaptive Bottom Dock */}
          <BottomNav
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onOpenSettings={handleOpenSettings}
            authUser={authUser}
            permissions={permissions}
            summary={data?.summary}
            onOpenQrModal={() => setQrModalTab('code')}
            onOpenHandoverModal={() => setShowHandoverModal(true)}
            onOpenWalkieModal={() => walkie.setConsoleOpen(true)}
            canUseWalkie={walkie.canUseWalkie}
          />

          {/* Context-Aware Single Mobile FAB (hidden on Dashboard, Settings & Chat) */}
          {activeTab !== 'settings' && activeTab !== 'dashboard' && (
            <SmartFab
              activeTab={activeTab}
              hasBottomNav={hasBottomNav}
              canWriteAttendance={canWriteAttendance}
              canQr={canWriteAttendance}
              canWriteShortages={canWriteShortages}
              canWriteTrucks={canWriteTrucks}
              canWriteNotes={canWriteNotes}
              canHandover={canHandover}
              canSwapSchedule={canSwapSchedule}
              onOpenQr={() => setQrModalTab('code')}
              onOpenHandover={() => setShowHandoverModal(true)}
              onPrimaryAction={(action) => {
                const tabMap = {
                  shortage_add: 'shortages',
                  truck_arrive: 'trucks',
                  note_add: 'notes',
                  schedule_swap: 'schedule',
                };
                const targetTab = tabMap[action];
                if (targetTab && activeTab !== targetTab) {
                  setActiveTab(targetTab);
                  setTimeout(() => {
                    window.dispatchEvent(
                      new CustomEvent('zayed:open-composer', { detail: { action, type: action } })
                    );
                  }, 60);
                } else if (action) {
                  window.dispatchEvent(
                    new CustomEvent('zayed:open-composer', { detail: { action, type: action } })
                  );
                }
              }}
            />
          )}

          {/* Floating Tactical Walkie-Talkie Quick-PTT Dock */}
          <WalkieFloatingDock
            walkie={walkie}
            hasBottomNav={hasBottomNav}
            compactOnDesktop={activeTab === 'settings'}
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

          {/* Personal Profile Modal */}
          <ProfileModal
            open={showProfileModal}
            onClose={() => setShowProfileModal(false)}
            authUser={authUser}
            onOpenSettings={handleOpenSettings}
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

          {/* Lightbox Image Preview Modal (Portaled above all shells) */}
          {previewModal &&
            (typeof document !== 'undefined'
              ? createPortal(
                  <div
                    onClick={() => setPreviewModal(null)}
                    style={{ zIndex: 75 }}
                    className="g-modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-label={previewModal.title || 'معاينة الصورة'}
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="g-dialog-sheet max-w-3xl p-0 overflow-hidden animate-pop"
                    >
                      <div className="p-4 flex items-center justify-between border-b border-line">
                        <h3 className="text-sm sm:text-base font-semibold text-ink m-0 truncate">
                          {previewModal.title}
                        </h3>
                        <button
                          type="button"
                          aria-label="إغلاق المعاينة"
                          onClick={() => setPreviewModal(null)}
                          className="w-11 h-11 rounded-full bg-transparent hover:bg-surface-2 text-ink-muted hover:text-ink flex items-center justify-center shrink-0 transition-colors active:scale-95"
                        >
                          <Icon name="close" size={20} />
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
                  </div>,
                  document.body
                )
              : null)}

          {/* Theme-Aware Snackbar Toast Host */}
          <ToastHost toast={toast} onDismiss={() => setToast(null)} />
        </>
      }
    >
      <SmartAlertsAndHandoverBar
        data={data}
        showBanners={activeTab !== 'dashboard' && activeTab !== 'settings'}
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
            storeName={data?.settings?.store_name || 'زايد مارت'}
            branchName={data?.settings?.branch_name || ''}
            dateKey={data?.dateKey || selectedDate}
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
            canExport={canExportReports || canWriteAttendance || canVerify}
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

        {activeTab === 'schedule' && canSchedule && (
          <ScheduleView
            authUser={authUser}
            permissions={permissions}
            bootstrapData={data}
            storeName={data?.settings?.store_name || 'زايد مارت'}
            canManage={canManageSchedule}
            canSwap={canSwapSchedule}
            canExport={canExportReports || canManageSchedule}
            canVerify={canVerify}
            canWriteAttendance={canWriteAttendance}
            onRefreshBootstrap={loadData}
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
            onToggleVoiceConfirm={() => setVoiceConfirmEnabled((v) => !v)}
            onSelectTab={setActiveTab}
            onSmartJumpTab={handleSmartJumpTab}
            onOpenSettings={handleOpenSettings}
            onOpenHandoverModal={() => setShowHandoverModal(true)}
            onOpenQrModal={(tab) => setQrModalTab(tab || 'cards')}
            onOpenPersonLog={(id, name) => setPersonLogTarget({ id, name })}
            walkie={walkie}
            onRefresh={loadData}
            onToast={showToast}
            onPreviewImage={(url, title) => setPreviewModal({ url, title })}
          />
        )}

        {activeTab === 'settings' && canSettings && (
          <SettingsView
            data={data}
            authUser={authUser}
            myProfile={data?.myProfile}
            permissions={permissions}
            connectionMode={resolvedConnMode}
            offlineQueueCount={offlineQueueCount}
            isSyncing={isSyncing}
            initialSection={settingsSection}
            section={settingsSection}
            onChangeSection={setSettingsSection}
            onFlushOfflineQueue={handleManualFlushSync}
            onUserUpdated={handleUserUpdated}
            onOpenPersonLog={(id, name) => setPersonLogTarget({ id, name })}
            onJumpToRbacMatrix={() => {
              setDashboardSubTab('rbac');
              setActiveTab('dashboard');
            }}
            onLogout={handleLogout}
            onRefresh={loadData}
            onToast={showToast}
          />
      )}
    </AppShell>
  );
}

import React, { useEffect, useState } from 'react';
import { hasAnyPermission, hasPermission } from '../lib/api.js';
import PwaInstallBanner from './PwaInstallBanner.jsx';

export default function TopBar({
  storeName,
  branchName,
  authUser,
  permissions = [],
  onLockToKiosk,
  onLogout,
  activeTab,
  onSelectTab,
  summary,
  connectionMode,
  offlineQueueCount,
  isSyncing = false,
  onFlushOfflineQueue,
  onToast,
  darkMode,
  onToggleDarkMode,
  fontScale,
  onCycleFontScale,
  fontFamily,
  onToggleFontFamily,
  selectedDate,
  onChangeDate,
  todayKey,
  onOpenQrModal,
  onOpenHandoverModal,
  onOpenProfileModal,
  canUseWalkie = false,
  walkieActive = false,
  onOpenWalkieModal,
}) {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const role = authUser?.role || '';
  const canAttendance = hasAnyPermission(permissions, role, [
    'attendance:read',
    'attendance:write',
    'attendance:kiosk',
  ]);
  const canVerify = hasPermission(permissions, role, 'attendance:verify');
  const canQr = hasAnyPermission(permissions, role, ['attendance:kiosk', 'attendance:write']);
  const canHandover = hasPermission(permissions, role, 'handover:manage');
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
  const isAdminLevel = hasAnyPermission(permissions, role, [
    'users:manage',
    'settings:manage',
    'staff:manage',
    'records:manage',
  ]);

  const navTabs = [];

  if (canAttendance) {
    navTabs.push({
      id: 'attendance',
      label: 'الحضور والانصراف',
      icon: 'badge',
      count: (summary?.presentCount || 0) + (summary?.onBreakCount || 0),
      alertCount: canVerify ? summary?.unverifiedAttendanceCount || 0 : 0,
    });
  }

  if (canShortages) {
    navTabs.push({
      id: 'shortages',
      label: 'نواقص الصالة',
      icon: 'shopping_basket',
      alertCount: summary?.openShortagesCount || 0,
    });
  }

  if (canTrucks) {
    navTabs.push({
      id: 'trucks',
      label: 'عربيات البضاعة والطلبيات',
      icon: 'local_shipping',
      count: summary?.unloadingTrucksCount || 0,
      isWarning: (summary?.unloadingTrucksCount || 0) > 0,
    });
  }

  if (canNotes) {
    navTabs.push({
      id: 'notes',
      label: 'الملاحظات والورديات',
      icon: 'sticky_note_2',
      count: summary?.openHandoverNotesCount || 0,
      alertCount: summary?.urgentNotesCount || 0,
    });
  }

  if (canChat) {
    navTabs.push({
      id: 'chat',
      label: 'تواصل الكاشيرية والتيم',
      icon: 'forum',
      alertCount: summary?.urgentMessagesCount || 0,
    });
  }

  if (canDashboard) {
    navTabs.push({
      id: 'dashboard',
      label: isAdminLevel ? 'الإدارة والتقارير الشاملة' : 'السجل اليومي والتقارير',
      icon: isAdminLevel ? 'admin_panel_settings' : 'space_dashboard',
    });
  }

  const isSingleShortageRole = navTabs.length === 1 && navTabs[0]?.id === 'shortages';

  const timeStr = [clock.getHours(), clock.getMinutes(), clock.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');

  const scaleLabel =
    fontScale === 'scale-normal' ? 'تكبير الخط' : fontScale === 'scale-large' ? 'خط كبير' : 'خط ضخم';

  const roleIcon =
    role === 'owner'
      ? 'shield_person'
      : role === 'manager'
      ? 'workspace_premium'
      : role === 'supervisor'
      ? 'manage_accounts'
      : role === 'cashier'
      ? 'point_of_sale'
      : role === 'cctv'
      ? 'videocam'
      : role === 'security'
      ? 'local_police'
      : role === 'hall'
      ? 'shopping_basket'
      : role === 'warehouse'
      ? 'warehouse'
      : role === 'delivery'
      ? 'two_wheeler'
      : 'person';

  return (
    <header className="sticky top-0 z-30 w-full bg-[var(--g-surface)]/95 backdrop-blur-md border-b border-[var(--g-border)]">
      {/* Authentic Google 4-color accent bar */}
      <div className="google-brand-bar" />

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 space-y-2">
        {/* Row 1: Brand Identity + User Profile + Quick System Controls */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-3 min-w-0">
          {/* Right side in RTL: Store Brand + Real-time Sync Status + Subtitle */}
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
            <img
              src="/Logo.png"
              onError={(e) => {
                if (e.currentTarget.src.endsWith('/Logo.png')) {
                  e.currentTarget.src = '/logo.jpeg';
                }
              }}
              alt={storeName || 'زايد مارت'}
              className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl object-cover border border-[var(--g-border)] shadow-xs shrink-0 bg-white"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <h1 className="text-sm sm:text-lg font-black tracking-tight m-0 whitespace-nowrap text-[var(--g-text)]">
                  {storeName || 'زايد مارت'}
                </h1>
                <button
                  type="button"
                  onClick={() => onFlushOfflineQueue?.()}
                  title={
                    connectionMode === 'offline_cached'
                      ? 'البيانات محفوظة محلياً على الهاتف في IndexedDB وسيتم رفعها تلقائياً فور عودة الإنترنت'
                      : offlineQueueCount > 0
                      ? 'اضغط لمزامنة الحركات المحفوظة محلياً مع السيرفر الآن'
                      : 'جميع البيانات متزامنة ومحفوظة رسمياً'
                  }
                  className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] px-2 sm:px-2.5 py-0.5 rounded-full font-extrabold shrink-0 transition-all active:scale-95 ${
                    isSyncing
                      ? 'bg-[var(--g-primary-container)] text-[var(--g-primary)]'
                      : connectionMode === 'offline_cached'
                      ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
                      : connectionMode === 'direct_cloud'
                      ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
                      : 'bg-[var(--g-green-bg)] text-[var(--g-green)]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full bg-current ${
                      isSyncing ? 'animate-ping' : ''
                    }`}
                  />
                  {/* Compact on mobile, full on desktop */}
                  {isSyncing ? (
                    <span>جاري الرفع ({offlineQueueCount})</span>
                  ) : connectionMode === 'offline_cached' ? (
                    <>
                      <span className="sm:hidden">أوفلاين{offlineQueueCount > 0 ? ` (${offlineQueueCount})` : ''}</span>
                      <span className="hidden sm:inline">أوفلاين • محفوظ بالهاتف{offlineQueueCount > 0 ? ` (${offlineQueueCount})` : ''}</span>
                    </>
                  ) : offlineQueueCount > 0 ? (
                    <>
                      <span className="sm:hidden">بانتظار النت ({offlineQueueCount})</span>
                      <span className="hidden sm:inline">بانتظار المزامنة ({offlineQueueCount})</span>
                    </>
                  ) : connectionMode === 'direct_cloud' ? (
                    <>
                      <span className="sm:hidden">سحابي</span>
                      <span className="hidden sm:inline">سحابي مباشر</span>
                    </>
                  ) : (
                    <>
                      <span className="sm:hidden">متصل</span>
                      <span className="hidden sm:inline">متصل ومتزامن</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-[var(--g-muted)] min-w-0 mt-0.5">
                <span className="font-bold text-[var(--g-text)] truncate max-w-[110px] sm:max-w-[200px]">
                  {authUser?.display_name || branchName || 'الفرع الرئيسي'}
                </span>
                <span className="hidden xs:inline">•</span>
                <span className="hidden xs:inline truncate">
                  {branchName || 'الفرع الرئيسي'}
                </span>
                <span>•</span>
                <span className="num-ltr font-bold text-[var(--g-primary)] shrink-0">
                  {timeStr}
                </span>
              </div>
            </div>
          </div>

          {/* Left side in RTL: Profile + Kiosk Lock + Logout (Never overlaps or crushes on mobile!) */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenProfileModal}
              title="فتح بروفايلي الشخصي، كلمة المرور الخاصة بي، وسجلي الكامل"
              className="h-9 sm:min-h-[40px] px-2 sm:px-3 py-1 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] hover:border-[var(--g-primary)] flex items-center gap-1.5 active:scale-95 transition-all shrink-0"
            >
              <span
                style={{ backgroundColor: authUser?.avatar_color || '#0B57D0' }}
                className="w-6 h-6 rounded-full text-white flex items-center justify-center shrink-0 shadow-2xs"
              >
                <span className="ms-icon filled text-sm">{roleIcon}</span>
              </span>
              <span className="hidden sm:inline-block text-xs font-extrabold truncate max-w-[100px] md:max-w-[140px]">
                {authUser?.display_name || 'بروفايلي'}
              </span>
              <span className="hidden lg:inline text-[10px] px-2 py-0.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] font-extrabold">
                بروفايلي
              </span>
            </button>

            {connectionMode === 'local_server' && isAdminLevel && (
              <button
                type="button"
                onClick={onLockToKiosk}
                title="قفل الجهاز فوراً على شاشة كشك حضور العمال فقط"
                className="w-9 h-9 sm:w-auto sm:min-h-[40px] px-0 sm:px-3 py-1 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] hover:border-[var(--g-primary)] text-xs font-extrabold flex items-center justify-center gap-1 shrink-0 active:scale-95"
              >
                <span className="ms-icon text-base text-[#E37400]">touch_app</span>
                <span className="hidden sm:inline">وضع الكشك</span>
              </button>
            )}

            <button
              type="button"
              onClick={onLogout}
              title="تسجيل الخروج أو تبديل الحساب"
              className="h-9 sm:min-h-[40px] px-2.5 sm:px-3.5 py-1 rounded-full bg-[var(--g-red-bg)] text-[var(--g-red)] border border-[var(--g-red-border)]/25 text-xs font-extrabold flex items-center justify-center gap-1 shrink-0 active:scale-95"
            >
              <span className="ms-icon text-base">logout</span>
              <span className="hidden xs:inline">خروج</span>
            </button>
          </div>
        </div>

        {/* Row 2: Mobile-First Quick Action & Accessibility Bar (No Crushing, Single Calendar Icon) */}
        <div className="flex items-center justify-between gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          <div className="flex items-center gap-1.5 shrink-0">
            <PwaInstallBanner compact onToast={onToast} />
            {canQr && (
              <button
                type="button"
                onClick={onOpenQrModal}
                title="مسح كرت QR أو إدخال كود الموظف السريع"
                className="min-h-[40px] px-3 py-1.5 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold flex items-center justify-center gap-1 hover:opacity-90 active:scale-95 shrink-0"
              >
                <span className="ms-icon filled text-base">qr_code_scanner</span>
                <span>QR / كود</span>
              </button>
            )}

            {canUseWalkie && (
              <button
                type="button"
                onClick={onOpenWalkieModal}
                title="فتح جهاز اللاسلكي الفوري لقناة الأمن والتيم"
                className="min-h-[40px] px-3 py-1.5 rounded-full bg-[#0D1117] text-white border border-[#00E676]/60 text-xs font-extrabold flex items-center justify-center gap-1.5 hover:border-[#00E676] active:scale-95 shrink-0 cursor-pointer"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    walkieActive ? 'bg-[#00E676]' : 'bg-[#64748B]'
                  }`}
                />
                <span className="ms-icon filled text-base text-[#00E676]">podcasts</span>
                <span>اللاسلكي</span>
              </button>
            )}

            {canHandover && (
              <button
                type="button"
                onClick={onOpenHandoverModal}
                title="تسليم واستلام الوردية"
                className="min-h-[40px] px-3 py-1.5 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold flex items-center justify-center gap-1 hover:border-[var(--g-primary)] active:scale-95 shrink-0"
              >
                <span className="ms-icon text-base text-[var(--g-primary)]">swap_horiz</span>
                <span>الوردية</span>
              </button>
            )}

            {/* Font Family Switcher (Cairo / Tajawal / Readex) — Always visible on Phone */}
            <button
              type="button"
              onClick={onToggleFontFamily}
              title="تبديل نوع الخط العربي (Cairo / Tajawal / Readex)"
              className="flex items-center justify-center gap-1 min-h-[40px] px-3 py-1.5 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold active:scale-95 shrink-0"
            >
              <span className="ms-icon text-base text-[var(--g-primary)]">font_download</span>
              <span>
                {fontFamily === 'tajawal'
                  ? 'Tajawal'
                  : fontFamily === 'readex'
                  ? 'Readex'
                  : 'Cairo'}
              </span>
            </button>

            {/* Easy Font Size Button */}
            <button
              type="button"
              onClick={onCycleFontScale}
              title="تكبير حجم الخط لسهولة القراءة"
              className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold flex items-center justify-center gap-1 active:scale-95 shrink-0"
            >
              <span className="ms-icon text-base">format_size</span>
              <span className="hidden sm:inline">{scaleLabel}</span>
            </button>

            {/* Dark / Light Mode Toggle */}
            <button
              type="button"
              onClick={onToggleDarkMode}
              title={darkMode ? 'الوضع النهاري' : 'الوضع الليلي المريح'}
              className="w-10 h-10 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] flex items-center justify-center hover:border-[var(--g-primary)] active:scale-95 shrink-0"
            >
              <span className="ms-icon filled text-lg">
                {darkMode ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
          </div>

          {!isSingleShortageRole && (
            <div className="flex items-center gap-1 bg-[var(--g-surface-variant)] px-2.5 min-h-[40px] py-1 rounded-full border border-[var(--g-border)] shrink-0">
              <input
                type="date"
                value={selectedDate}
                max={todayKey}
                onChange={(e) => onChangeDate(e.target.value || todayKey)}
                className="bg-transparent text-xs font-extrabold outline-none num-ltr text-[var(--g-text)] w-[112px] sm:w-auto cursor-pointer"
              />
              {selectedDate !== todayKey && (
                <button
                  type="button"
                  onClick={() => onChangeDate(todayKey)}
                  className="text-xs font-extrabold text-[var(--g-primary)] px-1.5 py-0.5 rounded-full bg-[var(--g-primary-container)]"
                >
                  اليوم
                </button>
              )}
            </div>
          )}
        </div>

        {/* Desktop Navigation Pills — Hidden when user only has 1 permitted view */}
        {navTabs.length > 1 && (
          <nav className="hidden md:flex items-center gap-2 pt-1 overflow-x-auto no-scrollbar">
            {navTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm whitespace-nowrap transition-all ${
                    isActive
                      ? 'g-pill-active'
                      : 'text-[var(--g-muted)] hover:bg-[var(--g-surface-variant)] font-semibold'
                  }`}
                >
                  <span className={`ms-icon ${isActive ? 'filled' : ''}`}>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span
                      className={`num-ltr text-xs px-2 py-0.5 rounded-full font-extrabold ${
                        tab.isWarning
                          ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
                          : 'bg-[var(--g-surface)] text-[var(--g-text)]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                  {tab.alertCount > 0 && (
                    <span className="num-ltr text-xs px-2 py-0.5 rounded-full font-extrabold bg-[var(--g-red-bg)] text-[var(--g-red)]">
                      {tab.alertCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}

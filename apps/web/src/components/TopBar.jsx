import React, { useEffect, useState } from 'react';
import { hasAnyPermission, hasPermission } from '../lib/api.js';
import PwaInstallBanner from './PwaInstallBanner.jsx';
import { BottomSheet, Button } from './ui/index.js';

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
  liteMode = false,
  onToggleLiteMode,
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
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const role = authUser?.role || '';
  const canAttendance = hasAnyPermission(permissions, role, [
    'attendance:self',
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
    fontScale === 'scale-normal' ? 'عادي' : fontScale === 'scale-large' ? 'كبير' : 'ضخم';

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

  const syncToneClass = isSyncing
    ? 'bg-[var(--g-primary-container)] text-[var(--g-primary)]'
    : connectionMode === 'offline_cached'
    ? 'bg-[var(--g-yellow-bg)] text-[var(--g-yellow)]'
    : connectionMode === 'direct_cloud'
    ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
    : 'bg-[var(--g-green-bg)] text-[var(--g-green)]';

  const syncShortLabel = isSyncing
    ? `رفع (${offlineQueueCount})`
    : connectionMode === 'offline_cached'
    ? `أوفلاين${offlineQueueCount > 0 ? ` (${offlineQueueCount})` : ''}`
    : offlineQueueCount > 0
    ? `معلق (${offlineQueueCount})`
    : connectionMode === 'direct_cloud'
    ? 'سحابي'
    : 'متصل';

  const syncFullLabel = isSyncing
    ? `جاري الرفع (${offlineQueueCount})`
    : connectionMode === 'offline_cached'
    ? `أوفلاين • محفوظ بالهاتف${offlineQueueCount > 0 ? ` (${offlineQueueCount})` : ''}`
    : offlineQueueCount > 0
    ? `بانتظار المزامنة (${offlineQueueCount})`
    : connectionMode === 'direct_cloud'
    ? 'سحابي مباشر'
    : 'متصل ومتزامن';

  return (
    <>
      <header className="sticky top-0 z-30 w-full bg-[var(--g-surface)]/95 backdrop-blur-md border-b border-[var(--g-border)]">
        {/* Authentic Google 4-color accent bar */}
        <div className="google-brand-bar" />

        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 md:py-2.5 md:space-y-2">
          {/* Slim Single-Row Mobile Header (~56px) + Full Desktop Top Row */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            {/* Right side in RTL: Brand Logo + Name + Sync Pill + Clock */}
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
              <img
                src="/Logo.png"
                onError={(e) => {
                  if (e.currentTarget.src.endsWith('/Logo.png')) {
                    e.currentTarget.src = '/logo.jpeg';
                  }
                }}
                alt={storeName || 'زايد مارت'}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl object-cover border border-[var(--g-border)] shadow-xs shrink-0 bg-white"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h1 className="text-sm sm:text-base font-black tracking-tight m-0 truncate text-[var(--g-text)]">
                    {storeName || 'زايد مارت'}
                  </h1>
                  <button
                    type="button"
                    onClick={() => onFlushOfflineQueue?.()}
                    title={
                      connectionMode === 'offline_cached'
                        ? 'البيانات محفوظة محلياً على الهاتف وسيتم رفعها تلقائياً فور عودة الإنترنت'
                        : offlineQueueCount > 0
                        ? 'اضغط لمزامنة الحركات المحفوظة محلياً مع السيرفر الآن'
                        : 'جميع البيانات متزامنة ومحفوظة رسمياً'
                    }
                    className={`inline-flex items-center gap-1 text-[10px] sm:text-[11px] px-2 py-0.5 rounded-full font-extrabold shrink-0 transition-all active:scale-95 ${syncToneClass}`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full bg-current ${
                        isSyncing ? 'animate-ping' : ''
                      }`}
                    />
                    <span className="sm:hidden">{syncShortLabel}</span>
                    <span className="hidden sm:inline">{syncFullLabel}</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-[var(--g-muted)] min-w-0 mt-0.5">
                  <span className="font-bold text-[var(--g-text)] truncate max-w-[100px] sm:max-w-[180px]">
                    {authUser?.display_name || branchName || 'الفرع الرئيسي'}
                  </span>
                  <span className="hidden xs:inline">•</span>
                  <span className="num-ltr font-bold text-[var(--g-primary)] shrink-0">
                    {timeStr}
                  </span>
                </div>
              </div>
            </div>

            {/* Left side in RTL: Mobile Compact Actions + Desktop Full Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Compact Date Pill (Always 1 tap on mobile & desktop) */}
              {!isSingleShortageRole && (
                <div className="flex items-center gap-1 bg-[var(--g-surface-variant)] px-2 sm:px-2.5 min-h-[40px] rounded-full border border-[var(--g-border)] shrink-0">
                  <input
                    type="date"
                    value={selectedDate}
                    max={todayKey}
                    aria-label="تاريخ التشغيل"
                    onChange={(e) => onChangeDate(e.target.value || todayKey)}
                    className="bg-transparent text-[11px] sm:text-xs font-extrabold outline-none num-ltr text-[var(--g-text)] w-[104px] sm:w-auto cursor-pointer"
                  />
                  {selectedDate !== todayKey && (
                    <button
                      type="button"
                      onClick={() => onChangeDate(todayKey)}
                      className="text-[10px] sm:text-xs font-extrabold text-[var(--g-primary)] px-1.5 py-0.5 rounded-full bg-[var(--g-primary-container)]"
                    >
                      اليوم
                    </button>
                  )}
                </div>
              )}

              {/* Quick QR on Mobile & Desktop */}
              {canQr && (
                <button
                  type="button"
                  onClick={onOpenQrModal}
                  aria-label="مسح QR أو إدخال الكود السريع"
                  title="مسح كرت QR أو إدخال كود الموظف السريع"
                  className="min-w-[40px] h-10 px-2.5 sm:px-3 rounded-full bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] text-xs font-extrabold flex items-center justify-center gap-1 hover:opacity-90 active:scale-95 shrink-0"
                >
                  <span className="ms-icon filled text-lg">qr_code_scanner</span>
                  <span className="hidden lg:inline">QR / كود</span>
                </button>
              )}

              {/* Desktop-only quick Walkie & Handover buttons */}
              {canUseWalkie && (
                <button
                  type="button"
                  onClick={onOpenWalkieModal}
                  title="فتح جهاز اللاسلكي الفوري لقناة الأمن والتيم"
                  className="hidden md:flex min-h-[40px] px-3 py-1 rounded-full bg-[#0D1117] text-white border border-[#00E676]/60 text-xs font-extrabold items-center justify-center gap-1.5 hover:border-[#00E676] active:scale-95 shrink-0"
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
                  className="hidden lg:flex min-h-[40px] px-3 py-1 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold items-center justify-center gap-1 hover:border-[var(--g-primary)] active:scale-95 shrink-0"
                >
                  <span className="ms-icon text-base text-[var(--g-primary)]">swap_horiz</span>
                  <span>الوردية</span>
                </button>
              )}

              {/* Avatar / Quick Settings Sheet Trigger (Replaces 8 crowded mobile buttons) */}
              <button
                type="button"
                onClick={() => setSettingsSheetOpen(true)}
                aria-label="القائمة السريعة وإعدادات العرض والحساب"
                title="الإعدادات السريعة، الخطوط، البروفايل، والخروج"
                className="min-h-[40px] px-2 sm:px-3 py-1 rounded-full bg-[var(--g-surface-variant)] border border-[var(--g-border)] hover:border-[var(--g-primary)] flex items-center gap-1.5 active:scale-95 transition-all shrink-0"
              >
                <span
                  style={{ backgroundColor: authUser?.avatar_color || '#0B57D0' }}
                  className="w-7 h-7 rounded-full text-white flex items-center justify-center shrink-0 shadow-2xs"
                >
                  <span className="ms-icon filled text-sm">{roleIcon}</span>
                </span>
                <span className="hidden sm:inline-block text-xs font-extrabold truncate max-w-[110px]">
                  {authUser?.display_name || 'الحساب'}
                </span>
                <span className="ms-icon text-base text-[var(--g-muted)]">tune</span>
              </button>
            </div>
          </div>

          {/* Desktop Navigation Pills — Hidden on Mobile (BottomNav handles Mobile) */}
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

      {/* Quick Settings, Account & Display Sheet (Declutters Mobile TopBar) */}
      <BottomSheet
        open={settingsSheetOpen}
        onClose={() => setSettingsSheetOpen(false)}
        title={authUser?.display_name || 'الحساب والإعدادات'}
        subtitle={`${authUser?.role_label || role || 'مستخدم'} • ${branchName || 'الفرع الرئيسي'}`}
        icon={roleIcon}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {/* PWA Install CTA if available */}
          <PwaInstallBanner compact={false} onToast={onToast} />

          {/* Primary Account & Operational Shortcuts */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="tonal"
              icon="account_circle"
              iconFilled
              onClick={() => {
                setSettingsSheetOpen(false);
                onOpenProfileModal?.();
              }}
            >
              بروفايلي وكلمة المرور
            </Button>

            {canHandover && (
              <Button
                variant="secondary"
                icon="swap_horiz"
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onOpenHandoverModal?.();
                }}
              >
                تسليم الوردية
              </Button>
            )}

            {canQr && (
              <Button
                variant="secondary"
                icon="qr_code_scanner"
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onOpenQrModal?.();
                }}
              >
                QR / كود سريع
              </Button>
            )}

            {canUseWalkie && (
              <Button
                variant="dark"
                icon="podcasts"
                iconFilled
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onOpenWalkieModal?.();
                }}
              >
                جهاز اللاسلكي
              </Button>
            )}

            {isAdminLevel && (
              <Button
                variant="secondary"
                icon="touch_app"
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onLockToKiosk?.();
                }}
                className="col-span-2"
              >
                قفل الجهاز على وضع كشك حضور العمال
              </Button>
            )}
          </div>

          {/* Display & Ergonomics Controls */}
          <div className="p-3.5 rounded-2xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] space-y-2.5">
            <div className="text-xs font-black text-[var(--g-muted)]">تخصيص العرض والراحة البصرية</div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={darkMode ? 'primary' : 'secondary'}
                size="sm"
                icon={darkMode ? 'light_mode' : 'dark_mode'}
                iconFilled
                onClick={onToggleDarkMode}
              >
                {darkMode ? 'الوضع النهاري' : 'الوضع الليلي'}
              </Button>

              {onToggleLiteMode && (
                <Button
                  variant={liteMode ? 'success' : 'secondary'}
                  size="sm"
                  icon="bolt"
                  iconFilled={liteMode}
                  onClick={onToggleLiteMode}
                >
                  {liteMode ? 'الأداء الخفيف: مفعّل' : 'الأداء الخفيف'}
                </Button>
              )}

              <Button
                variant="secondary"
                size="sm"
                icon="font_download"
                onClick={onToggleFontFamily}
              >
                الخط: {fontFamily === 'tajawal' ? 'Tajawal' : fontFamily === 'readex' ? 'Readex' : 'Cairo'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                icon="format_size"
                onClick={onCycleFontScale}
              >
                الحجم: {scaleLabel}
              </Button>
            </div>
          </div>

          {/* Logout Action */}
          <Button
            variant="dangerTonal"
            fullWidth
            icon="logout"
            onClick={() => {
              setSettingsSheetOpen(false);
              onLogout?.();
            }}
          >
            تسجيل الخروج أو تبديل الحساب
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

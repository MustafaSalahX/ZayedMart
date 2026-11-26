import React, { useState } from 'react';
import { buildNavTabs, getRoleCapabilities } from '../lib/navigation.js';
import { MODE_OPTIONS, THEMES_REGISTRY } from '../lib/themeRegistry.js';
import { useTheme } from '../lib/themeContext.jsx';
import {
  BottomSheet,
  BrandLogo,
  Button,
  GroupedList,
  GroupedRow,
  Icon,
  RoleAvatar,
  SegmentedControl,
  Separator,
} from './ui/index.js';

function shiftIsoDate(dateStr, deltaDays) {
  try {
    const [y, m, d] = String(dateStr || '')
      .split('-')
      .map(Number);
    if (!y || !m || !d) return dateStr;
    const dt = new Date(y, m - 1, d + deltaDays);
    return [
      dt.getFullYear(),
      String(dt.getMonth() + 1).padStart(2, '0'),
      String(dt.getDate()).padStart(2, '0'),
    ].join('-');
  } catch {
    return dateStr;
  }
}

/**
 * Adaptive 5-Architecture Top Navigation Chrome (`TopBar`):
 * - minimal-slim: 52px single-row flat typographic bar, 1px hairline, underlined links (0 pills, 0 brand bar)
 * - floating-glass-capsule: detached iOS 26 frosted glass capsule with Fresnel rim over <AmbientBackdrop />
 * - editorial-rule: warm editorial bar + 1px champagne-gold bottom gradient rule
 * - studio-segmented: crisp studio bar housing a recessed segmented nav pill track
 * - classic-clean: clean detoxed ZayedMart bar with 2px Zayed Blue top hairline & M3 tonal pills
 */
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
  offlineQueueCount = 0,
  isSyncing = false,
  onFlushOfflineQueue,
  darkMode: darkModeProp,
  onToggleDarkMode,
  sidebarCollapsed = false,
  onToggleSidebar,
  selectedDate,
  onChangeDate,
  todayKey,
  onOpenQrModal,
  onOpenHandoverModal,
  onOpenProfileModal,
  onOpenSettings,
  canUseWalkie = false,
  walkieActive = false,
  onOpenWalkieModal,
}) {
  const [settingsSheetOpen, setSettingsSheetOpen] = useState(false);
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  const themeCtx = useTheme();
  const arch = themeCtx.architecture;
  const headerLayout = arch.shell.headerLayout;
  const darkMode = darkModeProp !== undefined ? darkModeProp : themeCtx.darkMode;

  const isShadcnHeader = headerLayout === 'shadcn-sidebar-header';
  const isMinimal = headerLayout === 'minimal-slim';
  const isGlass = headerLayout === 'floating-glass-capsule';
  const isElegant = headerLayout === 'editorial-rule';
  const isModern = headerLayout === 'studio-segmented';

  const role = authUser?.role || '';
  const caps = getRoleCapabilities(permissions, role);
  const navTabs = buildNavTabs({
    role,
    permissions,
    summary,
    includeSettings: true,
  });

  const operationalTabsCount = navTabs.filter((t) => t.id !== 'settings').length;
  const isSingleShortageRole =
    operationalTabsCount === 1 && navTabs[0]?.id === 'shortages';
  const showDateControl =
    !isSingleShortageRole && activeTab !== 'schedule' && activeTab !== 'settings';

  const isToday = !selectedDate || selectedDate === todayKey;
  const shortDateDisplay = isToday
    ? 'اليوم'
    : String(selectedDate || '').slice(5).replace('-', '/');

  // Quiet status dot when online; compact label ONLY when offline, syncing, or queued
  const showSyncText =
    isSyncing || connectionMode === 'offline_cached' || offlineQueueCount > 0;
  const syncDotCls = isSyncing
    ? 'bg-primary-solid animate-ping'
    : connectionMode === 'offline_cached' || offlineQueueCount > 0
    ? 'bg-warning-solid'
    : 'bg-success-solid';
  const syncText = isSyncing
    ? `مزامنة (${offlineQueueCount})`
    : connectionMode === 'offline_cached'
    ? offlineQueueCount > 0
      ? `أوفلاين (${offlineQueueCount})`
      : 'أوفلاين'
    : `معلق (${offlineQueueCount})`;
  const syncTitle = isSyncing
    ? 'جاري المزامنة'
    : connectionMode === 'offline_cached'
    ? 'وضع أوفلاين'
    : offlineQueueCount > 0
    ? `معلق (${offlineQueueCount}) — اضغط للمزامنة`
    : 'متصل';

  const currentTabMeta = navTabs.find((t) => t.id === activeTab);
  const currentTabLabel =
    currentTabMeta?.fullLabel ||
    currentTabMeta?.label ||
    (activeTab === 'settings' ? 'الإعدادات' : 'الرئيسية');

  function handleToggleMode() {
    if (onToggleDarkMode) {
      onToggleDarkMode();
    } else {
      themeCtx.toggleDarkMode();
    }
  }

  function renderSyncButton(idleCls, activeCls) {
    return (
      <button
        type="button"
        onClick={() => onFlushOfflineQueue?.()}
        title={syncTitle}
        aria-label={syncTitle}
        className={`inline-flex items-center justify-center gap-1.5 shrink-0 transition-[background-color,transform] duration-150 active:scale-95 cursor-pointer ${
          showSyncText ? activeCls : idleCls
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${syncDotCls}`} aria-hidden="true" />
        {showSyncText && <span>{syncText}</span>}
      </button>
    );
  }

  function handleOpenFullSettings(section = 'profile') {
    setSettingsSheetOpen(false);
    if (onOpenSettings) {
      onOpenSettings(section);
    } else if (onSelectTab) {
      onSelectTab('settings');
    } else {
      onOpenProfileModal?.();
    }
  }

  function handleTabClick(tabId) {
    if (tabId === 'settings') {
      handleOpenFullSettings('profile');
    } else {
      onSelectTab?.(tabId);
    }
  }

  /* ── Desktop Inline Navigation (Rendered per Active Theme Architecture) ── */
  const desktopNav =
    navTabs.length > 1 ? (
      <nav
        aria-label="التنقل الرئيسي"
        className={`hidden md:flex items-center min-w-0 overflow-x-auto no-scrollbar ${
          isMinimal
            ? 'gap-5 h-full'
            : isElegant
            ? 'gap-4 h-full'
            : isModern
            ? 'gap-0.5 p-1 rounded-xl bg-surface-2 border border-line'
            : isGlass
            ? 'gap-1'
            : 'gap-1'
        }`}
      >
        {navTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const badgeCount = tab.alertCount > 0 ? tab.alertCount : tab.count > 0 ? tab.count : 0;
          const isAlert = tab.alertCount > 0;

          if (isMinimal || isElegant) {
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleTabClick(tab.id)}
                className={`relative h-[52px] px-0.5 text-xs sm:text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-[color] duration-150 cursor-pointer ${
                  isActive
                    ? isElegant
                      ? 'text-primary font-semibold'
                      : 'text-ink font-semibold'
                    : 'text-ink-muted hover:text-ink font-medium'
                }`}
              >
                <span>{tab.shortLabel || tab.label}</span>
                {badgeCount > 0 && (
                  <span
                    className={`num-ltr text-[11px] leading-none ${
                      isAlert
                        ? 'text-danger font-semibold'
                        : 'text-ink-muted font-medium'
                    }`}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 bottom-0 ${
                      isElegant ? 'h-[2px] bg-accent' : 'h-[1.5px] bg-ink'
                    }`}
                  />
                )}
              </button>
            );
          }

          if (isModern) {
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleTabClick(tab.id)}
                className={`min-h-[34px] px-2.5 py-1 rounded-[9px] text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-[background-color,color,box-shadow] duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-surface text-ink font-semibold border border-line-subtle shadow-2xs'
                    : 'text-ink-muted hover:text-ink font-medium border border-transparent'
                }`}
              >
                <span>{tab.shortLabel || tab.label}</span>
                {badgeCount > 0 && (
                  <span
                    className={`num-ltr text-[10px] font-semibold leading-none ${
                      isAlert ? 'text-danger' : 'text-ink-muted'
                    }`}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </button>
            );
          }

          if (isGlass) {
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleTabClick(tab.id)}
                className={`min-h-[36px] px-3 py-1 rounded-full text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-[transform,background-color,color,box-shadow] duration-150 ease-[var(--g-ease-out)] active:scale-[0.97] cursor-pointer ${
                  isActive
                    ? 'bg-glass-pill text-ink font-semibold shadow-[var(--g-glass-pill-specular)]'
                    : 'text-ink-muted hover:text-ink hover:bg-glass-control font-medium'
                }`}
              >
                <span>{tab.shortLabel || tab.label}</span>
                {badgeCount > 0 && (
                  <span
                    className={`num-ltr text-[10px] font-semibold leading-none ${
                      isAlert ? 'text-danger' : 'text-ink-muted'
                    }`}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </button>
            );
          }

          /* Classic clean M3 pill */
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleTabClick(tab.id)}
              className={`min-h-[36px] px-3 py-1 rounded-full text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-[transform,background-color,color] duration-150 ease-[var(--g-ease-out)] active:scale-[0.97] cursor-pointer ${
                isActive
                  ? 'g-pill-active'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink font-medium'
              }`}
            >
              <Icon
                name={tab.icon}
                size={17}
                filled={isActive}
              />
              <span>{tab.shortLabel || tab.label}</span>
              {badgeCount > 0 && (
                <span
                  className={`num-ltr text-[10px] font-semibold leading-none ${
                    isAlert ? 'text-danger' : 'opacity-80'
                  }`}
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    ) : null;

  /* ── Shared Single-Row Header Inner Content ── */
  const controlBtnBaseCls = isMinimal
    ? 'min-h-[40px] min-w-[40px] sm:min-h-[34px] sm:min-w-[34px] px-2 rounded-[6px] text-ink-muted hover:text-ink hover:bg-surface-2 items-center justify-center gap-1.5 text-xs font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] cursor-pointer shrink-0'
    : isGlass
    ? 'min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] px-2.5 rounded-full bg-glass-control border border-[var(--g-glass-border)] text-ink items-center justify-center gap-1.5 text-xs font-medium transition-[transform,background-color] duration-150 active:scale-[0.97] cursor-pointer shrink-0'
    : 'min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-[36px] px-2.5 rounded-[var(--g-radius-btn)] bg-surface-2/80 hover:bg-surface-2 border border-line text-ink items-center justify-center gap-1.5 text-xs font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] cursor-pointer shrink-0';

  const headerInner = (
    <div
      className={`flex items-center justify-between gap-2 sm:gap-3 min-w-0 ${
        isMinimal || isElegant ? 'h-[52px]' : 'min-h-[48px]'
      }`}
    >
      {/* Start: Store Mark + Concise Name + Minimal Sync Status Dot */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <BrandLogo alt={storeName || 'زايد مارت'} size="xs" />
        <h1
          className={`text-sm ${arch.surfaces.headingWeight} tracking-tight m-0 truncate text-ink max-w-[125px] sm:max-w-[160px]`}
        >
          {storeName || 'زايد مارت'}
        </h1>

        {renderSyncButton(
          'w-7 h-7 rounded-full hover:bg-surface-2',
          'min-h-[28px] px-2 py-0.5 rounded-full bg-warning-bg text-warning text-[11px] font-semibold'
        )}
      </div>

      {/* Center: Single-Row Desktop Navigation */}
      {desktopNav}

      {/* End: Date + Compact Tools + Avatar Trigger */}
      <div className="flex items-center gap-1.5 shrink-0">
        {showDateControl && (
          <>
            <button
              type="button"
              onClick={() => setDateSheetOpen(true)}
              aria-label="تاريخ التشغيل"
              className={`inline-flex sm:hidden ${controlBtnBaseCls} ${
                !isToday ? 'text-primary font-semibold' : ''
              }`}
            >
              <Icon name="calendar_today" size={17} />
              <span className="num-ltr">{shortDateDisplay}</span>
            </button>

            <div
              className={`hidden sm:flex items-center gap-1 shrink-0 ${
                isMinimal
                  ? 'px-1.5 min-h-[34px] rounded-[6px] hover:bg-surface-2'
                  : isGlass
                  ? 'px-3 min-h-[36px] rounded-full bg-glass-control border border-[var(--g-glass-border)]'
                  : 'px-2.5 min-h-[36px] rounded-[var(--g-radius-btn)] bg-surface-2/80 border border-line'
              }`}
            >
              <input
                type="date"
                value={selectedDate}
                max={todayKey}
                aria-label="تاريخ التشغيل"
                onChange={(e) => onChangeDate?.(e.target.value || todayKey)}
                className="bg-transparent text-xs font-medium outline-none num-ltr text-ink cursor-pointer"
              />
              {!isToday && (
                <button
                  type="button"
                  onClick={() => onChangeDate?.(todayKey)}
                  className="text-[11px] font-semibold text-primary hover:underline px-1 cursor-pointer"
                >
                  اليوم
                </button>
              )}
            </div>
          </>
        )}

        {caps.canQr && (
          <button
            type="button"
            onClick={onOpenQrModal}
            aria-label="QR / كود"
            title="QR / كود"
            className={`hidden sm:inline-flex ${controlBtnBaseCls}`}
          >
            <Icon name="qr_code_scanner" size={18} />
          </button>
        )}

        {canUseWalkie && (
          <button
            type="button"
            onClick={onOpenWalkieModal}
            aria-label="اللاسلكي"
            title="اللاسلكي"
            className={`hidden md:inline-flex relative ${controlBtnBaseCls}`}
          >
            <Icon name="podcasts" size={18} />
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                walkieActive ? 'bg-success-solid' : 'bg-ink-muted opacity-50'
              }`}
              aria-hidden="true"
            />
          </button>
        )}

        {caps.canHandover && (
          <button
            type="button"
            onClick={onOpenHandoverModal}
            aria-label="تسليم الوردية"
            title="تسليم الوردية"
            className={`hidden xl:inline-flex ${controlBtnBaseCls}`}
          >
            <Icon name="swap_horiz" size={18} />
          </button>
        )}

        {/* Compact Account & Quick Menu Trigger (>= 44x44px hit target) */}
        <button
          type="button"
          onClick={() => setSettingsSheetOpen(true)}
          aria-label="القائمة والحساب"
          title={authUser?.display_name || 'الحساب'}
          className={`min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center gap-1.5 transition-[transform,background-color] duration-150 active:scale-[0.96] cursor-pointer shrink-0 ${
            isMinimal
              ? 'rounded-full hover:bg-surface-2 px-1'
              : isGlass
              ? 'rounded-full p-0.5 bg-glass-control border border-[var(--g-glass-border)]'
              : 'rounded-full p-0.5 hover:bg-surface-2'
          }`}
        >
          <RoleAvatar
            src={authUser?.effective_avatar_url || authUser?.avatar_url}
            name={authUser?.display_name}
            role={role}
            color={authUser?.avatar_color}
            preset={authUser?.avatar_preset}
            size="xs"
          />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {isShadcnHeader ? (
        <header className="sticky top-0 z-30 w-full bg-canvas/95 pt-[var(--safe-top)]">
          {/* Desktop Shadcn Sidebar Header */}
          <div className="hidden md:flex h-14 border-b border-line bg-canvas/95 px-4 lg:px-6 items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => onToggleSidebar?.()}
                aria-label={
                  sidebarCollapsed ? 'توسيع القائمة الجانبية' : 'طي القائمة الجانبية'
                }
                aria-expanded={!sidebarCollapsed}
                title={`${sidebarCollapsed ? 'توسيع القائمة' : 'طي القائمة'} (Ctrl+B)`}
                className="inline-flex items-center justify-center min-h-[38px] w-9 rounded-[var(--g-radius-btn)] text-ink-muted hover:text-ink hover:bg-surface-2 transition-[background-color,color,transform] duration-150 active:scale-[0.97] cursor-pointer shrink-0"
              >
                <Icon name="sidebar" size={18} />
              </button>

              <Separator orientation="vertical" className="h-4" />

              <nav aria-label="مسار التنقل" className="flex items-center gap-1.5 text-sm min-w-0">
                <span className="text-ink-muted truncate max-w-[160px]">
                  {storeName || 'زايد مارت'}
                </span>
                <Icon
                  name="chevron_left"
                  size={14}
                  className="text-ink-muted shrink-0 ltr:rotate-180"
                />
                <span className="font-semibold text-ink truncate">
                  {currentTabLabel}
                </span>
              </nav>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {renderSyncButton(
                'w-9 h-9 rounded-[var(--g-radius-btn)] hover:bg-surface-2',
                'min-h-[36px] px-2.5 py-1 rounded-[var(--g-radius-btn)] bg-warning-bg text-warning text-xs font-semibold'
              )}

              {showDateControl && (
                <div className="flex items-center gap-1 px-2.5 min-h-[36px] rounded-[var(--g-radius-btn)] border border-line bg-surface hover:border-line-strong transition-[border-color] duration-150 shrink-0">
                  <input
                    type="date"
                    value={selectedDate}
                    max={todayKey}
                    aria-label="تاريخ التشغيل"
                    onChange={(e) => onChangeDate?.(e.target.value || todayKey)}
                    className="bg-transparent text-xs font-medium outline-none num-ltr text-ink cursor-pointer"
                  />
                  {!isToday && (
                    <button
                      type="button"
                      onClick={() => onChangeDate?.(todayKey)}
                      className="text-[11px] font-semibold text-primary hover:underline px-1 cursor-pointer"
                    >
                      اليوم
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleToggleMode}
                aria-label={darkMode ? 'التبديل للوضع النهاري' : 'التبديل للوضع الليلي'}
                title={darkMode ? 'الوضع النهاري' : 'الوضع الليلي'}
                className="inline-flex items-center justify-center min-h-[36px] w-9 rounded-[var(--g-radius-btn)] border border-line bg-surface text-ink-muted hover:text-ink hover:bg-surface-2 transition-[background-color,color,transform] duration-150 active:scale-[0.97] cursor-pointer shrink-0"
              >
                <Icon name={darkMode ? 'light_mode' : 'dark_mode'} size={17} />
              </button>
            </div>
          </div>

          {/* Mobile Shadcn Compact Header */}
          <div className="flex md:hidden h-14 border-b border-line bg-canvas/95 px-3 items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <BrandLogo alt={storeName || 'زايد مارت'} size="xs" />
              <h1 className="text-sm font-semibold tracking-tight m-0 truncate text-ink max-w-[130px]">
                {storeName || 'زايد مارت'}
              </h1>
              {renderSyncButton(
                'min-h-[44px] min-w-[44px] rounded-[var(--g-radius-btn)] hover:bg-surface-2',
                'min-h-[44px] px-2.5 rounded-[var(--g-radius-btn)] bg-warning-bg text-warning text-[11px] font-semibold'
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {showDateControl && (
                <button
                  type="button"
                  onClick={() => setDateSheetOpen(true)}
                  aria-label="تاريخ التشغيل"
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2.5 rounded-[var(--g-radius-btn)] border border-line bg-surface text-xs font-medium shrink-0 cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
                    !isToday ? 'text-primary font-semibold' : 'text-ink'
                  }`}
                >
                  <Icon name="calendar_today" size={16} />
                  <span className="num-ltr">{shortDateDisplay}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSettingsSheetOpen(true)}
                aria-label="القائمة والحساب"
                title={authUser?.display_name || 'الحساب'}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-surface-2 transition-[transform,background-color] duration-150 active:scale-[0.96] cursor-pointer shrink-0"
              >
                <RoleAvatar
                  src={authUser?.effective_avatar_url || authUser?.avatar_url}
                  name={authUser?.display_name}
                  role={role}
                  color={authUser?.avatar_color}
                  preset={authUser?.avatar_preset}
                  size="xs"
                />
              </button>
            </div>
          </div>
        </header>
      ) : isGlass ? (
        <header className="sticky top-0 z-30 w-full pointer-events-none pt-[calc(var(--safe-top)+0.5rem)] px-3 sm:px-5">
          <div className="pointer-events-auto max-w-7xl mx-auto g-glass-capsule rounded-[22px] lg:rounded-full px-3 sm:px-4 py-1">
            {headerInner}
          </div>
        </header>
      ) : (
        <header
          className={`sticky top-0 z-30 w-full g-header ${
            isElegant ? 'border-b-0' : ''
          }`}
        >
          {arch.shell.showBrandBar && <div className="google-brand-bar" />}
          <div className={`${arch.shell.maxContentWidth} mx-auto px-3 sm:px-6 ${isMinimal || isElegant ? '' : 'py-1'}`}>
            {headerInner}
          </div>
          {isElegant && <div className="g-header-editorial-rule" />}
        </header>
      )}

      {/* Mobile Compact Date Picker BottomSheet */}
      <BottomSheet
        open={dateSheetOpen}
        onClose={() => setDateSheetOpen(false)}
        title="تاريخ التشغيل"
        maxWidth="max-w-sm"
      >
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={isToday ? 'primary' : 'secondary'}
              onClick={() => {
                onChangeDate?.(todayKey);
                setDateSheetOpen(false);
              }}
            >
              اليوم
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                onChangeDate?.(shiftIsoDate(todayKey, -1));
                setDateSheetOpen(false);
              }}
            >
              أمس
            </Button>
          </div>

          <input
            type="date"
            value={selectedDate}
            max={todayKey}
            aria-label="تاريخ محدد"
            onChange={(e) => {
              onChangeDate?.(e.target.value || todayKey);
              setDateSheetOpen(false);
            }}
            className="g-input num-ltr font-medium"
          />
        </div>
      </BottomSheet>

      {/* Detoxed Quick Account & 5-Theme Sheet */}
      <BottomSheet
        open={settingsSheetOpen}
        onClose={() => setSettingsSheetOpen(false)}
        title={authUser?.display_name || 'الحساب'}
        subtitle={`${authUser?.role_label || role || ''}${branchName ? ` · ${branchName}` : ''}`}
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          {/* Quick Mode & 5-Theme Switcher */}
          <div className="space-y-2.5">
            <SegmentedControl
              fullWidth
              ariaLabel="الإضاءة"
              options={MODE_OPTIONS}
              value={themeCtx.modePref}
              onChange={(nextMode) => themeCtx.setModePref(nextMode)}
            />

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {THEMES_REGISTRY.map((t) => {
                const active = themeCtx.theme === t.id;
                const swatch = (darkMode ? t.swatches.dark : t.swatches.light)[2];
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => themeCtx.setTheme(t.id)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-[var(--g-radius-pill)] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 border transition-[transform,background-color,border-color,color] duration-150 ease-[var(--g-ease-out)] active:scale-[0.97] cursor-pointer ${
                      active
                        ? 'bg-primary-solid text-on-primary border-transparent'
                        : 'bg-surface text-ink border-line hover:border-line-strong'
                    }`}
                  >
                    <span
                      style={{ backgroundColor: swatch }}
                      className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/15"
                      aria-hidden="true"
                    />
                    <span>{t.nameAr}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grouped Clean Shortcuts */}
          <GroupedList>
            <GroupedRow onClick={() => handleOpenFullSettings('profile')}>
              <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                <Icon name="settings" size={19} className="text-ink-muted" />
                <span>الإعدادات والمظهر</span>
              </span>
              <Icon name="chevron_left" size={18} className="text-ink-muted ltr:rotate-180" />
            </GroupedRow>

            <GroupedRow
              onClick={() => {
                setSettingsSheetOpen(false);
                onOpenProfileModal?.();
              }}
            >
              <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                <Icon name="qr_code_2" size={19} className="text-ink-muted" />
                <span>بطاقة QR وسجلي</span>
              </span>
              <Icon name="chevron_left" size={18} className="text-ink-muted ltr:rotate-180" />
            </GroupedRow>

            {caps.canHandover && (
              <GroupedRow
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onOpenHandoverModal?.();
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="swap_horiz" size={19} className="text-ink-muted" />
                  <span>تسليم الوردية</span>
                </span>
                <Icon name="chevron_left" size={18} className="text-ink-muted ltr:rotate-180" />
              </GroupedRow>
            )}

            {caps.canQr && (
              <GroupedRow
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onOpenQrModal?.();
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="qr_code_scanner" size={19} className="text-ink-muted" />
                  <span>QR / كود</span>
                </span>
                <Icon name="chevron_left" size={18} className="text-ink-muted ltr:rotate-180" />
              </GroupedRow>
            )}

            {canUseWalkie && (
              <GroupedRow
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onOpenWalkieModal?.();
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="podcasts" size={19} className="text-ink-muted" />
                  <span>اللاسلكي</span>
                </span>
                <Icon name="chevron_left" size={18} className="text-ink-muted ltr:rotate-180" />
              </GroupedRow>
            )}

            {caps.isAdminLevel && (
              <GroupedRow
                onClick={() => {
                  setSettingsSheetOpen(false);
                  onLockToKiosk?.();
                }}
              >
                <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name="touch_app" size={19} className="text-ink-muted" />
                  <span>وضع الكشك</span>
                </span>
                <Icon name="chevron_left" size={18} className="text-ink-muted ltr:rotate-180" />
              </GroupedRow>
            )}
          </GroupedList>

          <Button
            variant="dangerTonal"
            fullWidth
            icon="logout"
            onClick={() => {
              setSettingsSheetOpen(false);
              onLogout?.();
            }}
          >
            تسجيل الخروج
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}

import React from 'react';
import {
  buildNavTabs,
  getRoleCapabilities,
  getRoleShortLabel,
  ROLE_ARABIC_FULL,
} from '../lib/navigation.js';
import { useTheme } from '../lib/themeContext.jsx';
import { THEMES_REGISTRY } from '../lib/themeRegistry.js';
import { cn } from '../lib/utils.js';
import {
  BrandLogo,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Icon,
  RoleAvatar,
  Separator,
} from './ui/index.js';

const BADGE_TONE_EXPANDED = {
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  neutral: 'bg-surface-2 text-ink-muted',
};

const BADGE_TONE_COLLAPSED = {
  danger: 'bg-danger-solid text-on-danger',
  warning: 'bg-warning-solid text-on-warning',
  neutral: 'bg-primary-solid text-on-primary',
};

function SidebarNavButton({
  icon,
  label,
  title,
  active = false,
  collapsed = false,
  badgeCount = 0,
  badgeTone = 'neutral',
  showCollapsedBadge = false,
  statusDotCls = '',
  onClick,
  ariaCurrent,
}) {
  const formattedCount = badgeCount > 99 ? '99+' : badgeCount;
  const displayTitle = title || label;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ariaCurrent ? 'page' : undefined}
      aria-label={displayTitle}
      title={collapsed ? displayTitle : undefined}
      className={cn(
        'relative flex items-center text-sm rounded-[var(--g-radius-md)] transition-[background-color,color,transform] duration-150 ease-[var(--g-ease-out)] active:scale-[0.985] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]',
        collapsed
          ? 'w-10 h-10 mx-auto justify-center px-0'
          : 'w-full min-h-[38px] px-2.5 py-1.5 justify-start gap-2.5',
        active
          ? 'bg-sidebar-accent text-ink font-semibold'
          : 'text-ink-muted hover:bg-sidebar-accent/70 hover:text-ink font-medium'
      )}
    >
      <span className="relative inline-flex items-center justify-center shrink-0">
        <Icon name={icon} size={18} filled={active} />
        {collapsed && showCollapsedBadge && badgeCount > 0 && (
          <span
            className={cn(
              'absolute -top-1.5 -end-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center num-ltr leading-none',
              BADGE_TONE_COLLAPSED[badgeTone] || BADGE_TONE_COLLAPSED.neutral
            )}
          >
            {formattedCount}
          </span>
        )}
        {collapsed && statusDotCls && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-0.5 -end-1 w-2 h-2 rounded-full ring-2 ring-[var(--g-sidebar-bg)]',
              statusDotCls
            )}
          />
        )}
      </span>

      <span className={collapsed ? 'sr-only' : 'truncate text-[13px] leading-snug'}>
        {label}
      </span>

      {!collapsed && badgeCount > 0 && (
        <span
          className={cn(
            'ms-auto num-ltr text-[11px] leading-none px-1.5 py-0.5 rounded-full font-semibold shrink-0',
            BADGE_TONE_EXPANDED[badgeTone] || BADGE_TONE_EXPANDED.neutral
          )}
        >
          {formattedCount}
        </span>
      )}

      {!collapsed && statusDotCls && (
        <span
          aria-hidden="true"
          className={cn('ms-auto w-2 h-2 rounded-full shrink-0', statusDotCls)}
        />
      )}
    </button>
  );
}

/**
 * Collapsible RTL Shadcn Dashboard-01 Desktop Sidebar (`md+` only).
 * Rendered exclusively when `architecture.shell.sidebarLayout === 'shadcn-collapsible-rail'`.
 */
export default function ShadcnSidebar({
  collapsed = false,
  storeName,
  branchName,
  authUser,
  permissions = [],
  activeTab,
  onSelectTab,
  summary,
  onOpenQrModal,
  onOpenHandoverModal,
  onOpenWalkieModal,
  onOpenProfileModal,
  onOpenSettings,
  onLockToKiosk,
  onLogout,
  canUseWalkie = false,
  walkieActive = false,
}) {
  const { theme, setTheme, darkMode, toggleDarkMode } = useTheme();

  const role = authUser?.role || '';
  const caps = getRoleCapabilities(permissions, role);
  const navTabs = buildNavTabs({
    role,
    permissions,
    summary,
    includeSettings: false,
  });

  const displayName = authUser?.display_name || authUser?.name || 'المستخدم';
  const roleLabel =
    authUser?.role_label || ROLE_ARABIC_FULL[role] || getRoleShortLabel(role);
  const resolvedStoreName = storeName || 'زايد مارت';

  function handleOpenSettings(section = 'profile') {
    if (onOpenSettings) {
      onOpenSettings(section);
    } else {
      onSelectTab?.('settings');
    }
  }

  return (
    <aside
      aria-label="التنقل الرئيسي"
      className={cn(
        'hidden md:flex flex-col shrink-0 sticky top-0 h-[100dvh] z-30 border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-[var(--g-ease-out)]',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand Header (aligned to h-14 TopBar height) */}
      <div
        className={cn(
          'h-14 shrink-0 border-b border-sidebar-border flex items-center',
          collapsed ? 'justify-center px-2' : 'px-3.5 gap-2.5'
        )}
      >
        <BrandLogo alt={resolvedStoreName} size="sm" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink truncate leading-tight">
              {resolvedStoreName}
            </div>
            {branchName ? (
              <div className="text-[11px] text-ink-muted truncate leading-tight mt-0.5">
                {branchName}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Scrollable Navigation Groups */}
      <nav
        aria-label="أقسام النظام"
        className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-3 no-scrollbar"
      >
        {navTabs.length > 0 && (
          <div className="space-y-1">
            {!collapsed && (
              <div className="px-2.5 pb-1 text-[11px] font-semibold text-ink-muted tracking-wide">
                العمليات
              </div>
            )}
            {navTabs.map((tab) => {
              const active = activeTab === tab.id;
              const badgeCount =
                tab.badge > 0 ? tab.badge : tab.count > 0 ? tab.count : 0;
              const badgeTone =
                tab.alertCount > 0
                  ? 'danger'
                  : tab.isWarning
                  ? 'warning'
                  : 'neutral';

              return (
                <SidebarNavButton
                  key={tab.id}
                  icon={tab.icon}
                  label={tab.shortLabel || tab.label}
                  title={tab.fullLabel || tab.label}
                  active={active}
                  ariaCurrent={active}
                  collapsed={collapsed}
                  badgeCount={badgeCount}
                  badgeTone={badgeTone}
                  showCollapsedBadge={tab.badge > 0}
                  onClick={() => onSelectTab?.(tab.id)}
                />
              );
            })}
          </div>
        )}

        <Separator orientation="horizontal" className="my-2" />

        <div className="space-y-1">
          {!collapsed && (
            <div className="px-2.5 pb-1 text-[11px] font-semibold text-ink-muted tracking-wide">
              أدوات سريعة
            </div>
          )}

          {caps.canQr && (
            <SidebarNavButton
              icon="qr_code_scanner"
              label="QR / كود"
              collapsed={collapsed}
              onClick={() => onOpenQrModal?.()}
            />
          )}

          {caps.canHandover && (
            <SidebarNavButton
              icon="swap_horiz"
              label="تسليم الوردية"
              collapsed={collapsed}
              onClick={() => onOpenHandoverModal?.()}
            />
          )}

          {canUseWalkie && (
            <SidebarNavButton
              icon="podcasts"
              label="اللاسلكي"
              collapsed={collapsed}
              statusDotCls={
                walkieActive ? 'bg-success-solid' : 'bg-ink-muted opacity-40'
              }
              onClick={() => onOpenWalkieModal?.()}
            />
          )}

          {caps.isAdminLevel && (
            <SidebarNavButton
              icon="touch_app"
              label="وضع الكشك"
              collapsed={collapsed}
              onClick={() => onLockToKiosk?.()}
            />
          )}

          {caps.canSettings && (
            <SidebarNavButton
              icon="settings"
              label="الإعدادات"
              active={activeTab === 'settings'}
              ariaCurrent={activeTab === 'settings'}
              collapsed={collapsed}
              onClick={() => handleOpenSettings('profile')}
            />
          )}
        </div>
      </nav>

      {/* Footer User Menu */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={collapsed ? `${displayName} · ${roleLabel}` : undefined}
              aria-label={`الحساب: ${displayName}`}
              className={cn(
                'flex items-center rounded-[var(--g-radius-md)] hover:bg-sidebar-accent transition-[background-color,transform] duration-150 ease-[var(--g-ease-out)] active:scale-[0.985] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--g-ring-focus)]',
                collapsed
                  ? 'w-11 h-11 mx-auto justify-center p-0'
                  : 'w-full min-h-[48px] px-2 py-1.5 gap-2.5 text-start'
              )}
            >
              <RoleAvatar
                src={authUser?.effective_avatar_url || authUser?.avatar_url}
                name={displayName}
                role={role}
                color={authUser?.avatar_color}
                preset={authUser?.avatar_preset}
                size="sm"
              />
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-ink truncate leading-tight">
                      {displayName}
                    </div>
                    <div className="text-[11px] text-ink-muted truncate leading-tight mt-0.5">
                      {roleLabel}
                    </div>
                  </div>
                  <Icon
                    name="unfold_more"
                    size={16}
                    className="text-ink-muted shrink-0"
                  />
                </>
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side={collapsed ? 'left' : 'top'}
            align={collapsed ? 'end' : 'start'}
            sideOffset={8}
            className="w-60"
          >
            <DropdownMenuLabel className="px-2 py-1.5">
              <div className="text-xs font-semibold text-ink truncate">
                {displayName}
              </div>
              <div className="text-[11px] font-normal text-ink-muted truncate">
                {roleLabel}
                {branchName ? ` · ${branchName}` : ''}
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={() => handleOpenSettings('profile')}>
              <Icon name="settings" size={16} className="text-ink-muted" />
              <span>الإعدادات والمظهر</span>
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={() => onOpenProfileModal?.()}>
              <Icon name="qr_code_2" size={16} className="text-ink-muted" />
              <span>بطاقة QR وسجلي</span>
            </DropdownMenuItem>

            <DropdownMenuItem onSelect={() => toggleDarkMode()}>
              <Icon
                name={darkMode ? 'light_mode' : 'dark_mode'}
                size={16}
                className="text-ink-muted"
              />
              <span>{darkMode ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="palette" size={16} className="text-ink-muted" />
                <span>السمة والشكل</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {THEMES_REGISTRY.map((t) => {
                  const isCurrent = theme === t.id;
                  const swatch = (darkMode ? t.swatches.dark : t.swatches.light)[2];
                  return (
                    <DropdownMenuItem
                      key={t.id}
                      onSelect={() => setTheme(t.id)}
                      className="justify-between"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          style={{ backgroundColor: swatch }}
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-line"
                          aria-hidden="true"
                        />
                        <span
                          className={cn(
                            'truncate',
                            isCurrent ? 'font-semibold text-ink' : ''
                          )}
                        >
                          {t.nameAr}
                        </span>
                      </span>
                      {isCurrent && (
                        <Icon name="check" size={14} className="text-ink shrink-0" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            <DropdownMenuItem destructive onSelect={() => onLogout?.()}>
              <Icon name="logout" size={16} />
              <span>تسجيل الخروج</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

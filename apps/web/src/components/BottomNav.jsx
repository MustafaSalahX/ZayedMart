import React, { useState } from 'react';
import { buildNavTabs, getRoleCapabilities } from '../lib/navigation.js';
import { useThemeArchitecture } from '../lib/themeContext.jsx';
import { BottomSheet, Button, GroupedList, GroupedRow, Icon } from './ui/index.js';

/**
 * Adaptive 5-Architecture Mobile Bottom Dock (`BottomNav`):
 * - minimal-hairline: edge-to-edge 1px border-t, bare monochrome icons + 4px active ink dot (0 pills!)
 * - floating-glass-dock: detached iOS 26 floating pill capsule (`rounded-[28px]`) + liquid active bubble
 * - editorial-hairline: edge-to-edge warm dock with fine 2px champagne top active rule
 * - floating-studio-dock: detached crisp studio dock (`rounded-2xl`) + sharp active tile
 * - classic-m3-pill: clean M3 bottom bar with tonal pill indicator
 */
export default function BottomNav({
  activeTab,
  onSelectTab,
  onOpenSettings,
  authUser,
  permissions = [],
  summary,
  onOpenQrModal,
  onOpenHandoverModal,
  onOpenWalkieModal,
  canUseWalkie = false,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const arch = useThemeArchitecture();
  const dockLayout = arch.shell.bottomNavLayout;

  const isMinimal = dockLayout === 'minimal-hairline';
  const isGlass = dockLayout === 'floating-glass-dock';
  const isElegant = dockLayout === 'editorial-hairline';
  const isModern = dockLayout === 'floating-studio-dock';

  const role = authUser?.role || '';
  const caps = getRoleCapabilities(permissions, role);
  const items = buildNavTabs({
    role,
    permissions,
    summary,
    includeSettings: true,
  });

  if (items.length <= 1) {
    return null;
  }

  function handleSelectItem(tabId) {
    if (tabId === 'settings' && onOpenSettings) {
      onOpenSettings('profile');
    } else {
      onSelectTab?.(tabId);
    }
  }

  const needsMoreHub = items.length > 4;
  let visibleTabs = items;
  let hiddenTabs = [];

  if (needsMoreHub) {
    const firstThree = items.slice(0, 3);
    const rest = items.slice(3);
    const activeInRest = rest.find((t) => t.id === activeTab);
    const fourthTab = activeInRest || rest[0];
    visibleTabs = [...firstThree, fourthTab];
    hiddenTabs = rest.filter((t) => t.id !== fourthTab.id);
  }

  const hiddenBadgeTotal = hiddenTabs.reduce((sum, t) => sum + (Number(t.badge) || 0), 0);
  const totalSlots = needsMoreHub ? visibleTabs.length + 1 : visibleTabs.length;
  const colClass =
    totalSlots >= 5
      ? 'grid-cols-5'
      : totalSlots === 4
      ? 'grid-cols-4'
      : totalSlots === 3
      ? 'grid-cols-3'
      : 'grid-cols-2';

  const formatBadgeCount = (n) => (n > 99 ? '99+' : n);

  const navContainerCls = isGlass
    ? 'md:hidden fixed bottom-[calc(var(--safe-bottom)+0.75rem)] inset-x-3.5 max-w-[420px] mx-auto z-35 g-glass-dock rounded-[28px] p-1.5'
    : isModern
    ? 'md:hidden fixed bottom-[calc(var(--safe-bottom)+0.625rem)] inset-x-3 max-w-[420px] mx-auto z-35 rounded-2xl bg-surface-elevated border border-line shadow-[var(--g-shadow-elevated)] p-1.5'
    : isMinimal
    ? 'md:hidden fixed bottom-0 inset-x-0 z-35 g-bottom-nav'
    : isElegant
    ? 'md:hidden fixed bottom-0 inset-x-0 z-35 g-bottom-nav'
    : 'md:hidden fixed bottom-0 inset-x-0 z-35 g-bottom-nav shadow-[var(--g-shadow-elevated)]';

  const renderSlot = ({ id, icon, label, active, badge, badgeTone, onClick, ariaExpanded }) => {
    if (isMinimal) {
      return (
        <button
          key={id}
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-expanded={ariaExpanded}
          onClick={onClick}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[54px] py-1 min-w-0 relative active:scale-[0.96] transition-transform duration-150 cursor-pointer"
        >
          <span className="relative inline-flex items-center justify-center">
            <Icon
              name={icon}
              size={21}
              filled={active}
              className={active ? 'text-ink' : 'text-ink-muted'}
            />
            {badge > 0 && (
              <span
                className={`absolute -top-1 -end-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center num-ltr ${badgeTone}`}
              >
                {formatBadgeCount(badge)}
              </span>
            )}
          </span>
          <span
            className={`text-[10px] leading-none truncate max-w-full px-0.5 ${
              active ? 'font-semibold text-ink' : 'font-medium text-ink-muted'
            }`}
          >
            {label}
          </span>
          <span
            aria-hidden="true"
            className={`w-1 h-1 rounded-full transition-opacity duration-150 ${
              active ? 'bg-ink opacity-100' : 'opacity-0'
            }`}
          />
        </button>
      );
    }

    if (isGlass) {
      return (
        <button
          key={id}
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-expanded={ariaExpanded}
          onClick={onClick}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[52px] py-1.5 px-1 rounded-[22px] min-w-0 relative transition-[transform,background-color,color,box-shadow] duration-150 ease-[var(--g-ease-out)] active:scale-[0.95] cursor-pointer ${
            active
              ? 'bg-glass-pill text-primary shadow-[var(--g-glass-pill-specular)]'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          <span className="relative inline-flex items-center justify-center">
            <Icon name={icon} size={21} filled={active} />
            {badge > 0 && (
              <span
                className={`absolute -top-1 -end-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center num-ltr ${badgeTone}`}
              >
                {formatBadgeCount(badge)}
              </span>
            )}
          </span>
          <span
            className={`text-[10px] leading-none truncate max-w-full ${
              active ? 'font-semibold text-ink' : 'font-medium'
            }`}
          >
            {label}
          </span>
        </button>
      );
    }

    if (isElegant) {
      return (
        <button
          key={id}
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-expanded={ariaExpanded}
          onClick={onClick}
          className="flex flex-col items-center justify-center gap-1 min-h-[56px] py-1.5 min-w-0 relative active:scale-[0.96] transition-transform duration-150 cursor-pointer"
        >
          {active && (
            <span
              aria-hidden="true"
              className="absolute top-0 w-7 h-[2px] rounded-full bg-accent"
            />
          )}
          <span className="relative inline-flex items-center justify-center">
            <Icon
              name={icon}
              size={21}
              filled={active}
              className={active ? 'text-primary' : 'text-ink-muted'}
            />
            {badge > 0 && (
              <span
                className={`absolute -top-1 -end-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center num-ltr ${badgeTone}`}
              >
                {formatBadgeCount(badge)}
              </span>
            )}
          </span>
          <span
            className={`text-[10px] leading-none truncate max-w-full px-0.5 ${
              active ? 'font-semibold text-ink' : 'font-medium text-ink-muted'
            }`}
          >
            {label}
          </span>
        </button>
      );
    }

    if (isModern) {
      return (
        <button
          key={id}
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-expanded={ariaExpanded}
          onClick={onClick}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-[50px] py-1.5 px-1 rounded-xl min-w-0 relative transition-[transform,background-color,color,border-color] duration-150 active:scale-[0.96] cursor-pointer border ${
            active
              ? 'bg-surface-2 text-primary border-line-subtle'
              : 'bg-transparent text-ink-muted border-transparent'
          }`}
        >
          <span className="relative inline-flex items-center justify-center">
            <Icon name={icon} size={21} filled={active} />
            {badge > 0 && (
              <span
                className={`absolute -top-1 -end-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center num-ltr ${badgeTone}`}
              >
                {formatBadgeCount(badge)}
              </span>
            )}
          </span>
          <span
            className={`text-[10px] leading-none truncate max-w-full ${
              active ? 'font-semibold text-ink' : 'font-medium'
            }`}
          >
            {label}
          </span>
        </button>
      );
    }

    /* Classic M3 Pill Dock */
    return (
      <button
        key={id}
        type="button"
        aria-current={active ? 'page' : undefined}
        aria-expanded={ariaExpanded}
        onClick={onClick}
        className="flex flex-col items-center justify-center gap-1 min-h-[48px] py-1 min-w-0 relative active:scale-[0.96] transition-transform duration-150 cursor-pointer"
      >
        <div
          className={`relative w-full max-w-[54px] h-8 rounded-full flex items-center justify-center transition-[background-color,color] duration-150 ${
            active
              ? 'bg-secondary-container text-on-secondary-container'
              : 'text-ink-muted'
          }`}
        >
          <Icon name={icon} size={21} filled={active} />
          {badge > 0 && (
            <span
              className={`absolute -top-1 end-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center num-ltr ${badgeTone}`}
            >
              {formatBadgeCount(badge)}
            </span>
          )}
        </div>
        <span
          className={`text-[11px] leading-none truncate max-w-full px-0.5 ${
            active ? 'font-semibold text-ink' : 'font-medium text-ink-muted'
          }`}
        >
          {label}
        </span>
      </button>
    );
  };

  return (
    <>
      <nav aria-label="التنقل الرئيسي للموبايل" className={navContainerCls}>
        <div
          className={`grid ${colClass} items-center ${
            isGlass || isModern ? 'gap-1' : isMinimal ? 'h-[60px] px-1 gap-0.5' : 'h-16 px-1 gap-0.5'
          }`}
        >
          {visibleTabs.map((item) =>
            renderSlot({
              id: item.id,
              icon: item.icon,
              label: item.shortLabel || item.label,
              active: activeTab === item.id,
              badge: item.badge,
              badgeTone: item.badgeTone,
              onClick: () => handleSelectItem(item.id),
            })
          )}

          {needsMoreHub &&
            renderSlot({
              id: '__more__',
              icon: 'apps',
              label: 'المزيد',
              active: moreOpen,
              badge: hiddenBadgeTotal,
              badgeTone: 'bg-danger-solid text-on-danger',
              onClick: () => setMoreOpen(true),
              ariaExpanded: moreOpen,
            })}
        </div>
      </nav>

      {/* Detoxed More Hub Sheet — Clean GroupedList Hairline Rows */}
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="الأقسام"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <GroupedList>
            {items.map((item) => {
              const active = activeTab === item.id;
              return (
                <GroupedRow
                  key={item.id}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    handleSelectItem(item.id);
                    setMoreOpen(false);
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      name={item.icon}
                      size={20}
                      filled={active}
                      className={`shrink-0 ${active ? 'text-primary' : 'text-ink-muted'}`}
                    />
                    <span
                      className={`text-sm truncate ${
                        active ? 'font-semibold text-primary' : 'font-medium text-ink'
                      }`}
                    >
                      {item.fullLabel || item.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.badge > 0 && (
                      <span
                        className={`num-ltr text-[11px] px-2 py-0.5 rounded-full font-semibold ${item.badgeTone}`}
                      >
                        {formatBadgeCount(item.badge)}
                      </span>
                    )}
                    <Icon
                      name="chevron_left"
                      size={18}
                      className="text-ink-muted ltr:rotate-180"
                    />
                  </div>
                </GroupedRow>
              );
            })}
          </GroupedList>

          {(caps.canQr || caps.canHandover || canUseWalkie) && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {caps.canQr && (
                <Button
                  variant="secondary"
                  size="md"
                  icon="qr_code_scanner"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenQrModal?.();
                  }}
                >
                  QR / كود
                </Button>
              )}
              {caps.canHandover && (
                <Button
                  variant="secondary"
                  size="md"
                  icon="swap_horiz"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenHandoverModal?.();
                  }}
                >
                  الوردية
                </Button>
              )}
              {canUseWalkie && (
                <Button
                  variant="dark"
                  size="md"
                  icon="podcasts"
                  iconFilled
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenWalkieModal?.();
                  }}
                >
                  اللاسلكي
                </Button>
              )}
            </div>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

import React, { useState } from 'react';
import { hasAnyPermission, hasPermission } from '../lib/api.js';
import { BottomSheet } from './ui/index.js';

/**
 * Mobile Material 3 Bottom Navigation Bar:
 * - Caps visible tabs at <=5 slots (4 primary operational tabs + "المزيد" More Hub Sheet)
 *   so every touch target stays >=48px wide/tall with zero text truncation or crowding.
 * - Hides automatically when a role has only 1 permitted view.
 */
export default function BottomNav({
  activeTab,
  onSelectTab,
  authUser,
  permissions = [],
  summary,
  onOpenQrModal,
  onOpenHandoverModal,
  onOpenWalkieModal,
  canUseWalkie = false,
}) {
  const [moreOpen, setMoreOpen] = useState(false);

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

  const items = [];

  if (canAttendance) {
    items.push({
      id: 'attendance',
      label: 'الحضور',
      fullLabel: 'الحضور والانصراف',
      icon: 'badge',
      badge: canVerify ? summary?.unverifiedAttendanceCount || 0 : 0,
      badgeTone: 'bg-[#B3261E] text-white',
    });
  }

  if (canShortages) {
    items.push({
      id: 'shortages',
      label: 'النواقص',
      fullLabel: 'نواقص الصالة',
      icon: 'shopping_basket',
      badge: summary?.openShortagesCount || 0,
      badgeTone: 'bg-[#B3261E] text-white',
    });
  }

  if (canTrucks) {
    items.push({
      id: 'trucks',
      label: 'العربيات',
      fullLabel: 'عربيات البضاعة',
      icon: 'local_shipping',
      badge: summary?.unloadingTrucksCount || 0,
      badgeTone: 'bg-[#C25E00] text-white',
    });
  }

  if (canNotes) {
    items.push({
      id: 'notes',
      label: 'الملاحظات',
      fullLabel: 'الملاحظات والورديات',
      icon: 'sticky_note_2',
      badge: (summary?.urgentNotesCount || 0) + (summary?.openHandoverNotesCount || 0),
      badgeTone:
        (summary?.urgentNotesCount || 0) > 0
          ? 'bg-[#B3261E] text-white'
          : 'bg-[#0B57D0] text-white',
    });
  }

  if (canChat) {
    items.push({
      id: 'chat',
      label: 'التيم',
      fullLabel: 'تواصل الكاشيرية والتيم',
      icon: 'forum',
      badge: summary?.urgentMessagesCount || 0,
      badgeTone: 'bg-[#B3261E] text-white',
    });
  }

  if (canDashboard) {
    items.push({
      id: 'dashboard',
      label: isAdminLevel ? 'الإدارة' : 'التقارير',
      fullLabel: isAdminLevel ? 'الإدارة والتقارير الشاملة' : 'السجل اليومي والتقارير',
      icon: isAdminLevel ? 'admin_panel_settings' : 'space_dashboard',
      badge: 0,
      badgeTone: 'bg-[#0B57D0] text-white',
    });
  }

  if (items.length <= 1) {
    return null;
  }

  // Cap mobile bar at 4 primary tabs + 1 "المزيد" Hub button when >= 5 tabs exist
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

  return (
    <>
      <nav
        aria-label="التنقل الرئيسي"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--g-surface)]/98 backdrop-blur-md border-t border-[var(--g-border)] shadow-lg"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className={`grid ${colClass} h-18 items-center px-1.5 gap-1`}>
          {visibleTabs.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className="flex flex-col items-center justify-center gap-1 min-h-[48px] py-1 min-w-0 relative active:scale-95 transition-transform"
              >
                <div
                  className={`relative w-14 h-8 rounded-full flex items-center justify-center transition-all ${
                    active
                      ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] shadow-2xs'
                      : 'text-[var(--g-muted)]'
                  }`}
                >
                  <span className={`ms-icon text-[22px] ${active ? 'filled' : ''}`}>
                    {item.icon}
                  </span>
                  {item.badge > 0 && (
                    <span
                      className={`absolute -top-1 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center num-ltr shadow-2xs ${item.badgeTone}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[11px] leading-none truncate max-w-full px-0.5 ${
                    active
                      ? 'font-black text-[var(--g-text)]'
                      : 'font-bold text-[var(--g-muted)]'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          {needsMoreHub && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center justify-center gap-1 min-h-[48px] py-1 min-w-0 relative active:scale-95 transition-transform"
            >
              <div
                className={`relative w-14 h-8 rounded-full flex items-center justify-center transition-all ${
                  moreOpen
                    ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)]'
                    : 'text-[var(--g-muted)]'
                }`}
              >
                <span className={`ms-icon text-[22px] ${moreOpen ? 'filled' : ''}`}>apps</span>
                {hiddenBadgeTotal > 0 && (
                  <span className="absolute -top-1 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center num-ltr shadow-2xs bg-[#B3261E] text-white">
                    {hiddenBadgeTotal}
                  </span>
                )}
              </div>
              <span className="text-[11px] leading-none font-bold text-[var(--g-muted)]">
                المزيد
              </span>
            </button>
          )}
        </div>
      </nav>

      {/* More Hub Bottom Sheet */}
      <BottomSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="كل الأقسام والأدوات"
        subtitle="وصول سريع لجميع الشاشات المصرح بها لحسابك"
        icon="apps"
        maxWidth="max-w-md"
      >
        <div className="grid grid-cols-2 gap-2.5">
          {items.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  setMoreOpen(false);
                }}
                className={`p-3.5 rounded-2xl border text-right flex flex-col gap-2 min-h-[84px] transition-all active:scale-95 cursor-pointer ${
                  active
                    ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] border-transparent shadow-xs'
                    : 'bg-[var(--g-surface-variant)] text-[var(--g-text)] border-[var(--g-border)] hover:border-[var(--g-primary)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`ms-icon text-2xl ${active ? 'filled' : 'text-[var(--g-primary)]'}`}>
                    {item.icon}
                  </span>
                  {item.badge > 0 && (
                    <span
                      className={`num-ltr text-[11px] px-2 py-0.5 rounded-full font-black ${item.badgeTone}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-xs font-black leading-snug">{item.fullLabel}</span>
              </button>
            );
          })}
        </div>

        {(canQr || canHandover || canUseWalkie) && (
          <div className="pt-2 border-t border-[var(--g-border)] flex flex-wrap gap-2">
            {canQr && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenQrModal?.();
                }}
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold flex items-center justify-center gap-1.5"
              >
                <span className="ms-icon text-base text-[var(--g-primary)]">qr_code_scanner</span>
                <span>مسح QR / كود</span>
              </button>
            )}
            {canHandover && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenHandoverModal?.();
                }}
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-[var(--g-surface-variant)] border border-[var(--g-border)] text-xs font-extrabold flex items-center justify-center gap-1.5"
              >
                <span className="ms-icon text-base text-[var(--g-primary)]">swap_horiz</span>
                <span>تسليم الوردية</span>
              </button>
            )}
            {canUseWalkie && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenWalkieModal?.();
                }}
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#0D1117] text-white border border-[#00E676]/50 text-xs font-extrabold flex items-center justify-center gap-1.5"
              >
                <span className="ms-icon filled text-base text-[#00E676]">podcasts</span>
                <span>اللاسلكي</span>
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}

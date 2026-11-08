import React from 'react';
import { hasAnyPermission, hasPermission } from '../lib/api.js';

/**
 * شريط التنقل السفلي لتصميم Google Material Design 3 على الموبايل (Bottom Navigation Bar)
 * يعرض فقط التبويبات المسموحة لدور المستخدم الحالي وفق مصفوفة RBAC،
 * ويختفي تلقائياً إذا كان للدور صفحة واحدة فقط (مثل عمال الصالة -> النواقص فقط) لعدم التشتيت.
 */
export default function BottomNav({
  activeTab,
  onSelectTab,
  authUser,
  permissions = [],
  summary,
}) {
  const role = authUser?.role || '';
  const canAttendance = hasAnyPermission(permissions, role, [
    'attendance:self',
    'attendance:read',
    'attendance:write',
    'attendance:kiosk',
  ]);
  const canVerify = hasPermission(permissions, role, 'attendance:verify');
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
      icon: 'badge',
      badge: canVerify ? summary?.unverifiedAttendanceCount || 0 : 0,
      badgeTone: 'bg-[#B3261E] text-white',
    });
  }

  if (canShortages) {
    items.push({
      id: 'shortages',
      label: 'النواقص',
      icon: 'shopping_basket',
      badge: summary?.openShortagesCount || 0,
      badgeTone: 'bg-[#B3261E] text-white',
    });
  }

  if (canTrucks) {
    items.push({
      id: 'trucks',
      label: 'العربيات',
      icon: 'local_shipping',
      badge: summary?.unloadingTrucksCount || 0,
      badgeTone: 'bg-[#C25E00] text-white',
    });
  }

  if (canNotes) {
    items.push({
      id: 'notes',
      label: 'الملاحظات',
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
      icon: 'forum',
      badge: summary?.urgentMessagesCount || 0,
      badgeTone: 'bg-[#B3261E] text-white',
    });
  }

  if (canDashboard) {
    items.push({
      id: 'dashboard',
      label: isAdminLevel ? 'الإدارة' : 'التقارير',
      icon: isAdminLevel ? 'admin_panel_settings' : 'space_dashboard',
      badge: 0,
    });
  }

  // Single-page roles (like Hall Workers -> Shortages only) get zero bottom-nav distraction
  if (items.length <= 1) {
    return null;
  }

  const colClass =
    items.length >= 6
      ? 'grid-cols-6'
      : items.length === 5
      ? 'grid-cols-5'
      : items.length === 4
      ? 'grid-cols-4'
      : items.length === 3
      ? 'grid-cols-3'
      : 'grid-cols-2';

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--g-surface)]/98 backdrop-blur-md border-t border-[var(--g-border)] shadow-lg"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className={`grid ${colClass} h-18 items-center px-1`}>
        {items.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className="flex flex-col items-center justify-center gap-1 py-1.5 min-w-0 relative active:scale-95 transition-transform"
            >
              <div
                className={`relative w-13 sm:w-16 h-8 rounded-full flex items-center justify-center transition-all ${
                  active
                    ? 'bg-[var(--g-secondary-container)] text-[var(--g-on-secondary-container)] shadow-2xs'
                    : 'text-[var(--g-muted)]'
                }`}
              >
                <span className={`ms-icon text-[23px] ${active ? 'filled' : ''}`}>
                  {item.icon}
                </span>
                {item.badge > 0 && (
                  <span
                    className={`absolute -top-1 right-0.5 min-w-[19px] h-[19px] px-1 rounded-full text-[10px] font-black flex items-center justify-center num-ltr shadow-2xs ${item.badgeTone}`}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <span
                className={`text-xs leading-none truncate max-w-full px-0.5 ${
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
      </div>
    </nav>
  );
}

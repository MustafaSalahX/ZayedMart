import { hasAnyPermission, hasPermission } from './api.js';

/**
 * Shared Navigation & Role Metadata — Single Source of Truth across
 * App.jsx, TopBar.jsx, BottomNav.jsx, AdminDashboard.jsx, SettingsView.jsx, and TeamChatView.jsx.
 * V2: Concise 1-word Arabic navigation labels for clean single-row headers & minimal docks.
 */

export const TAB_DEFAULT_ORDER = [
  'dashboard',
  'attendance',
  'shortages',
  'schedule',
  'trucks',
  'notes',
  'chat',
  'settings',
];

export const ROLE_ARABIC_SHORT = Object.freeze({
  owner: 'الأدمن',
  manager: 'المدير',
  supervisor: 'المشرف',
  cashier: 'الكاشير',
  cctv: 'الكاميرات',
  security: 'الأمن',
  hall: 'الصالة',
  warehouse: 'المخزن',
  delivery: 'الدليفري',
  kiosk: 'الكشك',
});

export const ROLE_ARABIC_FULL = Object.freeze({
  owner: 'المالك',
  manager: 'مدير الفرع',
  supervisor: 'مشرف الصالة',
  cashier: 'الكاشير',
  cctv: 'مراقب الكاميرات',
  security: 'الأمن والاستلام',
  hall: 'عمال الصالة',
  warehouse: 'أمين المخزن',
  delivery: 'الدليفري',
  kiosk: 'كشك العمال',
});

export const ROLE_ICONS = Object.freeze({
  owner: 'shield_person',
  manager: 'workspace_premium',
  supervisor: 'manage_accounts',
  cashier: 'point_of_sale',
  cctv: 'videocam',
  security: 'local_police',
  hall: 'shopping_basket',
  warehouse: 'warehouse',
  delivery: 'two_wheeler',
  kiosk: 'touch_app',
});

export const ROLE_DEFAULT_COLORS = Object.freeze({
  owner: '#7627BB',
  manager: '#9334E6',
  supervisor: '#0B57D0',
  cashier: '#D93025',
  cctv: '#185ABC',
  security: '#146C2E',
  hall: '#007B83',
  warehouse: '#8430CE',
  delivery: '#C26401',
  kiosk: '#4E5661',
});

export function getRoleIcon(role) {
  return ROLE_ICONS[role] || 'person';
}

export function getRoleShortLabel(role) {
  return ROLE_ARABIC_SHORT[role] || 'مستخدم';
}

export function getRoleCapabilities(permissions = [], role = '') {
  const canAttendance = hasAnyPermission(permissions, role, [
    'attendance:self',
    'attendance:read',
    'attendance:write',
    'attendance:kiosk',
  ]);
  const canVerify = hasPermission(permissions, role, 'attendance:verify');
  const canWriteAttendance = hasPermission(permissions, role, 'attendance:write');
  const canSelfAttendance = hasPermission(permissions, role, 'attendance:self');
  const canReadAttendance = hasPermission(permissions, role, 'attendance:read');
  const canShortages = hasAnyPermission(permissions, role, [
    'shortages:read',
    'shortages:write',
    'shortages:manage',
  ]);
  const canWriteShortages = hasPermission(permissions, role, 'shortages:write');
  const canManageShortages = hasPermission(permissions, role, 'shortages:manage');
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
  const canWriteTrucks = hasPermission(permissions, role, 'trucks:write');
  const canClearReturn = hasPermission(permissions, role, 'suppliers:clear_return');
  const canNotes = hasAnyPermission(permissions, role, ['notes:read', 'notes:write']);
  const canWriteNotes = hasPermission(permissions, role, 'notes:write');
  const canResolveNotes = hasPermission(permissions, role, 'notes:resolve');
  const canChat = hasAnyPermission(permissions, role, ['chat:read', 'chat:write']);
  const canHandover = hasPermission(permissions, role, 'handover:manage');
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
  const canManageStaff = hasPermission(permissions, role, 'staff:manage');
  const canManageSuppliers = hasPermission(permissions, role, 'suppliers:manage');
  const canManageUsers = hasPermission(permissions, role, 'users:manage');
  const canManageSettings = hasPermission(permissions, role, 'settings:manage');
  const canManageBackup = hasPermission(permissions, role, 'backup:manage');
  const canExportReports = hasPermission(permissions, role, 'reports:export');
  const canManageRecords = hasPermission(permissions, role, 'records:manage');
  const canPrintCards = hasAnyPermission(permissions, role, ['staff:manage', 'attendance:read']);
  const canSettings = Boolean(role && role !== 'kiosk');

  return {
    canAttendance,
    canVerify,
    canWriteAttendance,
    canSelfAttendance,
    canReadAttendance,
    canQr: canWriteAttendance,
    canShortages,
    canWriteShortages,
    canManageShortages,
    canSchedule,
    canManageSchedule,
    canSwapSchedule,
    canTrucks,
    canWriteTrucks,
    canClearReturn,
    canNotes,
    canWriteNotes,
    canResolveNotes,
    canChat,
    canHandover,
    canDashboard,
    isAdminLevel,
    canManageStaff,
    canManageSuppliers,
    canManageUsers,
    canManageSettings,
    canManageBackup,
    canExportReports,
    canManageRecords,
    canPrintCards,
    canSettings,
  };
}

/**
 * Builds the canonical permission-filtered tab list for TopBar, BottomNav, and App routing.
 */
export function buildNavTabs({
  role = '',
  permissions = [],
  summary = {},
  includeSettings = false,
} = {}) {
  const caps = getRoleCapabilities(permissions, role);
  const tabs = [];

  if (caps.canDashboard) {
    tabs.push({
      id: 'dashboard',
      label: caps.isAdminLevel ? 'الإدارة' : 'التقارير',
      shortLabel: caps.isAdminLevel ? 'الإدارة' : 'التقارير',
      fullLabel: caps.isAdminLevel ? 'الإدارة' : 'التقارير',
      icon: caps.isAdminLevel ? 'space_dashboard' : 'bar_chart',
      count: 0,
      alertCount: 0,
      badge: 0,
      badgeTone: 'bg-primary-solid text-on-primary',
    });
  }

  if (caps.canAttendance) {
    const alertCount = caps.canVerify
      ? (summary?.unverifiedAttendanceCount || 0) + (summary?.mismatchAttendanceCount || 0)
      : 0;
    tabs.push({
      id: 'attendance',
      label: 'الحضور',
      shortLabel: 'الحضور',
      fullLabel: 'الحضور والانصراف',
      icon: 'badge',
      count: (summary?.presentCount || 0) + (summary?.onBreakCount || 0),
      alertCount,
      badge: alertCount,
      badgeTone: 'bg-danger-solid text-on-danger',
    });
  }

  if (caps.canShortages) {
    const openCount = summary?.openShortagesCount || 0;
    tabs.push({
      id: 'shortages',
      label: 'النواقص',
      shortLabel: 'النواقص',
      fullLabel: 'نواقص الصالة',
      icon: 'shopping_basket',
      count: 0,
      alertCount: openCount,
      badge: openCount,
      badgeTone: 'bg-danger-solid text-on-danger',
    });
  }

  if (caps.canSchedule) {
    const swapCount = summary?.pendingDayOffSwapsCount || 0;
    tabs.push({
      id: 'schedule',
      label: 'الإجازات',
      shortLabel: 'الإجازات',
      fullLabel: 'جدول الإجازات',
      icon: 'calendar_month',
      count: 0,
      alertCount: swapCount,
      badge: swapCount,
      badgeTone: 'bg-danger-solid text-on-danger',
    });
  }

  if (caps.canTrucks) {
    const unloading = summary?.unloadingTrucksCount || 0;
    tabs.push({
      id: 'trucks',
      label: 'العربيات',
      shortLabel: 'العربيات',
      fullLabel: 'عربيات البضاعة',
      icon: 'local_shipping',
      count: unloading,
      alertCount: 0,
      badge: unloading,
      isWarning: unloading > 0,
      badgeTone: 'bg-warning-solid text-on-warning',
    });
  }

  if (caps.canNotes) {
    const urgent = summary?.urgentNotesCount || 0;
    const handoverOpen = summary?.openHandoverNotesCount || 0;
    tabs.push({
      id: 'notes',
      label: 'الملاحظات',
      shortLabel: 'الملاحظات',
      fullLabel: 'الملاحظات والوردية',
      icon: 'sticky_note_2',
      count: handoverOpen,
      alertCount: urgent,
      badge: urgent + handoverOpen,
      badgeTone: urgent > 0 ? 'bg-danger-solid text-on-danger' : 'bg-primary-solid text-on-primary',
    });
  }

  if (caps.canChat) {
    const urgentChat = summary?.urgentMessagesCount || 0;
    tabs.push({
      id: 'chat',
      label: 'التيم',
      shortLabel: 'التيم',
      fullLabel: 'تواصل التيم',
      icon: 'forum',
      count: 0,
      alertCount: urgentChat,
      badge: urgentChat,
      badgeTone: 'bg-danger-solid text-on-danger',
    });
  }

  if (includeSettings && caps.canSettings) {
    tabs.push({
      id: 'settings',
      label: 'الإعدادات',
      shortLabel: 'الإعدادات',
      fullLabel: 'الإعدادات',
      icon: 'settings',
      count: 0,
      alertCount: 0,
      badge: 0,
      badgeTone: 'bg-primary-solid text-on-primary',
    });
  }

  return tabs;
}

export function getPreferredAllowedTab(role = '', permissions = []) {
  const caps = getRoleCapabilities(permissions, role);
  if (role === 'owner' && caps.canDashboard) return 'dashboard';
  if (role === 'hall' && caps.canShortages) return 'shortages';
  if (caps.canAttendance) return 'attendance';
  if (caps.canShortages) return 'shortages';
  if (caps.canSchedule) return 'schedule';
  if (caps.canTrucks) return 'trucks';
  if (caps.canNotes) return 'notes';
  if (caps.canDashboard) return 'dashboard';
  if (caps.canChat) return 'chat';
  return 'settings';
}

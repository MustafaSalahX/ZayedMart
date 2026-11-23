/**
 * Curated Role Avatar Presets & Accessible Color Palette for ZayedMart
 * Aligned with ui/RoleAvatar.jsx and backend SettingsController validation.
 */

export const ROLE_AVATAR_ICONS = {
  owner: 'shield_person',
  manager: 'workspace_premium',
  supervisor: 'manage_accounts',
  cashier: 'point_of_sale',
  cctv: 'videocam',
  security: 'local_police',
  hall: 'shopping_basket',
  warehouse: 'inventory_2',
  delivery: 'two_wheeler',
  kiosk: 'touch_app',
};

export const AVATAR_PRESETS = [
  { id: 'role_default', label: 'أيقونة الدور', icon: '', kind: 'role' },
  { id: 'badge_crown', label: 'تاج الإدارة', icon: 'workspace_premium', kind: 'icon' },
  { id: 'badge_shield', label: 'درع الحماية', icon: 'verified_user', kind: 'icon' },
  { id: 'badge_cashier', label: 'كاشير محترف', icon: 'point_of_sale', kind: 'icon' },
  { id: 'badge_camera', label: 'مراقبة ذكية', icon: 'videocam', kind: 'icon' },
  { id: 'badge_store', label: 'صالة العرض', icon: 'storefront', kind: 'icon' },
  { id: 'badge_warehouse', label: 'أمين المخزن', icon: 'inventory_2', kind: 'icon' },
  { id: 'badge_delivery', label: 'توصيل سريع', icon: 'two_wheeler', kind: 'icon' },
  { id: 'badge_star', label: 'نجم الفريق', icon: 'star', kind: 'icon' },
  { id: 'badge_bolt', label: 'سرعة الإنجاز', icon: 'bolt', kind: 'icon' },
  { id: 'initials_gradient', label: 'حروف بتدرج', icon: '', kind: 'initials_gradient' },
  { id: 'initials_minimal', label: 'حروف بسيطة', icon: '', kind: 'initials_minimal' },
];

export const AVATAR_COLORS = [
  { hex: '#0B57D0', label: 'أزرق ملكي' },
  { hex: '#7627BB', label: 'بنفسجي قيادي' },
  { hex: '#146C2E', label: 'أخضر زمردي' },
  { hex: '#007B83', label: 'فيروزي عصري' },
  { hex: '#C26401', label: 'كهرماني دافئ' },
  { hex: '#B3261E', label: 'ياقوتي واضح' },
  { hex: '#185ABC', label: 'أزرق مراقبة' },
  { hex: '#8430CE', label: 'أرجواني مخزن' },
  { hex: '#0F766E', label: 'أخضر تيل' },
  { hex: '#334155', label: 'رمادي فحمي' },
];

export function getRoleAvatarIcon(role = '') {
  return ROLE_AVATAR_ICONS[String(role || '').trim()] || 'person';
}

export function getPresetIcon(preset = '', role = '') {
  const clean = String(preset || '').trim();
  if (!clean || clean === 'role_default') {
    return getRoleAvatarIcon(role);
  }
  const found = AVATAR_PRESETS.find((p) => p.id === clean);
  if (found && found.icon) return found.icon;
  return getRoleAvatarIcon(role);
}

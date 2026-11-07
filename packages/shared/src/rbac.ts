export interface RoleMetadata {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  description: string;
}

export interface PermissionItem {
  id: string;
  label: string;
  group: string;
}

export interface WalkieChannelMeta {
  id: 'security' | 'warehouse' | 'floor' | 'emergency';
  code: string;
  label: string;
  shortLabel: string;
  freq: string;
  color: string;
}

export const VALID_WALKIE_CHANNELS = ['security', 'warehouse', 'floor', 'emergency'] as const;
export type WalkieChannelId = (typeof VALID_WALKIE_CHANNELS)[number];

export const WALKIE_CHANNELS: Record<WalkieChannelId, WalkieChannelMeta> = {
  security: {
    id: 'security',
    code: 'CH-01',
    label: 'قناة الأمن والبوابة (CH-01)',
    shortLabel: 'الأمن CH-01',
    freq: '462.5625 MHz',
    color: '#146C2E',
  },
  warehouse: {
    id: 'warehouse',
    code: 'CH-02',
    label: 'قناة المخزن والرصيف (CH-02)',
    shortLabel: 'المخزن CH-02',
    freq: '462.6125 MHz',
    color: '#8430CE',
  },
  floor: {
    id: 'floor',
    code: 'CH-03',
    label: 'قناة الصالة والكاشير (CH-03)',
    shortLabel: 'الصالة CH-03',
    freq: '462.6625 MHz',
    color: '#007B83',
  },
  emergency: {
    id: 'emergency',
    code: 'CH-09',
    label: 'قناة الطوارئ العامة (CH-09)',
    shortLabel: 'الطوارئ CH-09',
    freq: '462.9500 MHz',
    color: '#D93025',
  },
};

export const ROLES_METADATA: Record<string, RoleMetadata> = {
  owner: {
    id: 'owner',
    label: 'الأدمن العام / المالك',
    shortLabel: 'الأدمن',
    icon: 'shield_locked',
    color: '#7627BB',
    description: 'صلاحية كاملة على النظام، المستخدمين، الصلاحيات، النسخ الاحتياطي، والإعدادات السحابية',
  },
  manager: {
    id: 'manager',
    label: 'مدير الفرع / المدير',
    shortLabel: 'المدير',
    icon: 'workspace_premium',
    color: '#9334E6',
    description: 'إدارة الفرع بالكامل، الموظفين، الموردين، النواقص، التقارير الشاملة، وتعديل السجلات',
  },
  supervisor: {
    id: 'supervisor',
    label: 'مشرف الصالة والفرع',
    shortLabel: 'مشرف الفرع',
    icon: 'manage_accounts',
    color: '#0B57D0',
    description: 'إدارة الموظفين والموردين، التقارير، إغلاق الملاحظات، ومراجعة التشغيل اليومي',
  },
  cashier: {
    id: 'cashier',
    label: 'الكاشير / الكاشيرية',
    shortLabel: 'الكاشير',
    icon: 'point_of_sale',
    color: '#D93025',
    description: 'رؤية وإضافة النواقص ومقترحات الأصناف، تسجيل مشاكل وملاحظات الكاشير، التواصل مع الكاشيرية والتيم، وعرض البروفايل الشخصي',
  },
  cctv: {
    id: 'cctv',
    label: 'مراقب الكاميرات',
    shortLabel: 'مراقب الكاميرات',
    icon: 'desktop_windows',
    color: '#185ABC',
    description: 'مطابقة حضور الموظفين بالكاميرا، تسجيل الملاحظات والوقائع، تسليم الوردية، ومتابعة الرصيف',
  },
  security: {
    id: 'security',
    label: 'الأمن واستلام البضاعة',
    shortLabel: 'الأمن',
    icon: 'shield_person',
    color: '#146C2E',
    description: 'تسجيل حضور وانصراف الموظفين، إدارة البريك المخصص، عربيات الموردين والطلبيات، ملاحظات البوابة، واللاسلكي المباشر',
  },
  hall: {
    id: 'hall',
    label: 'عمال الصالة والممرات',
    shortLabel: 'عمال الصالة',
    icon: 'shopping_basket',
    color: '#007B83',
    description: 'تحديد الأصناف الناقصة في الصالة وتحديد أو تعديل الكميات المطلوبة والملاحظات والتواصل مع التيم',
  },
  warehouse: {
    id: 'warehouse',
    label: 'أمين المخزن والاستلام',
    shortLabel: 'المخزن',
    icon: 'inventory_2',
    color: '#8430CE',
    description: 'متابعة النواقص وتوفيرها من المخزن، استلام عربيات الموردين، وإدارة الكتالوج والملاحظات',
  },
  delivery: {
    id: 'delivery',
    label: 'الدليفري والتوصيل',
    shortLabel: 'الدليفري',
    icon: 'two_wheeler',
    color: '#C26401',
    description: 'متابعة النواقص، تسجيل ملاحظات التوصيل، والتواصل الفوري مع الكاشيرية والتيم',
  },
  kiosk: {
    id: 'kiosk',
    label: 'شاشة كشك العمال (مقيدة)',
    shortLabel: 'كشك العمال',
    icon: 'touch_app',
    color: '#E37400',
    description: 'وضع مقفول بأقل صلاحية لتسجيل حضور وانصراف العمال باللمس أو كرت الـ QR فقط دون عرض أي سجلات',
  },
};

export const ALL_PERMISSIONS: PermissionItem[] = [
  { id: 'attendance:kiosk', label: 'تسجيل حضور كشك العمال / QR', group: 'الحضور والانصراف' },
  { id: 'attendance:read', label: 'عرض سجل الحضور التفصيلي والبريك', group: 'الحضور والانصراف' },
  { id: 'attendance:write', label: 'تسجيل حضور وانصراف وتحديد مدة البريك', group: 'الحضور والانصراف' },
  { id: 'attendance:verify', label: 'ختم مطابقة مراقب الكاميرات ✓', group: 'الحضور والانصراف' },
  { id: 'trucks:read', label: 'عرض سجل عربيات البضاعة', group: 'الموردون والطلبيات' },
  { id: 'trucks:write', label: 'تسجيل وصول وإنهاء استلام العربيات', group: 'الموردون والطلبيات' },
  { id: 'suppliers:clear_return', label: 'تسوية ومسح تنبيهات مرتجعات الموردين', group: 'الموردون والطلبيات' },
  { id: 'shortages:read', label: 'عرض قائمة النواقص ومقترحات الأصناف', group: 'النواقص وأصناف الصالة' },
  { id: 'shortages:write', label: 'إضافة النواقص واقتراح أصناف جديدة وتعديل الكمية', group: 'النواقص وأصناف الصالة' },
  { id: 'shortages:manage', label: 'اعتماد توفير النواقص وتغيير الحالة وإدارة كتالوج الأصناف', group: 'النواقص وأصناف الصالة' },
  { id: 'notes:read', label: 'عرض سجل الملاحظات ومشاكل الكاشيرية والوقائع', group: 'الملاحظات والورديات' },
  { id: 'notes:write', label: 'إضافة ملاحظات أو مشاكل كاشير/صالة جديدة', group: 'الملاحظات والورديات' },
  { id: 'notes:resolve', label: 'إغلاق وحل الملاحظات المعلقة', group: 'الملاحظات والورديات' },
  { id: 'handover:manage', label: 'تسليم واستلام الورديات', group: 'الملاحظات والورديات' },
  { id: 'chat:read', label: 'عرض رسائل وتنبيهات الكاشيرية والتيم', group: 'التواصل والبروفايل' },
  { id: 'chat:write', label: 'إرسال رسائل ونداءات سريعة للكاشيرية والتيم', group: 'التواصل والبروفايل' },
  { id: 'walkie:use', label: 'استخدام جهاز اللاسلكي الفوري (Push-To-Talk)', group: 'التواصل والبروفايل' },
  { id: 'walkie:all_channels', label: 'التبديل بين جميع قنوات اللاسلكي والنداء العام', group: 'التواصل والبروفايل' },
  { id: 'profile:view', label: 'عرض البروفايل الشخصي والباسورد والسجل الفردي', group: 'التواصل والبروفايل' },
  { id: 'reports:view', label: 'عرض لوحة التقارير الشاملة والسجل الزمني الموحد', group: 'الإدارة والأمان' },
  { id: 'reports:export', label: 'تصدير تقارير Excel و Word و WhatsApp', group: 'الإدارة والأمان' },
  { id: 'records:manage', label: 'تعديل وحذف أي سجل تشغيلي (حضور، عربيات، نواقص، ملاحظات)', group: 'الإدارة والأمان' },
  { id: 'staff:manage', label: 'إضافة وتعديل وحذف الموظفين وكروت QR', group: 'الإدارة والأمان' },
  { id: 'suppliers:manage', label: 'إضافة وحذف الموردين الدائمين', group: 'الإدارة والأمان' },
  { id: 'audit:view', label: 'عرض اللوج الشامل (Master Log) واللوج الفردي', group: 'الإدارة والأمان' },
  { id: 'settings:manage', label: 'تعديل إعدادات الفرع والمزامنة السحابية', group: 'الإدارة والأمان' },
  { id: 'backup:manage', label: 'تصدير واستعادة النسخ الاحتياطية الكاملة', group: 'الإدارة والأمان' },
  { id: 'users:manage', label: 'إدارة المستخدمين والأدوار والصلاحيات المخصصة', group: 'الإدارة والأمان' },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ALL_PERMISSIONS.map((p) => p.id),
  manager: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'attendance:verify',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'shortages:read',
    'shortages:write',
    'shortages:manage',
    'notes:read',
    'notes:write',
    'notes:resolve',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'walkie:all_channels',
    'profile:view',
    'reports:view',
    'reports:export',
    'records:manage',
    'staff:manage',
    'suppliers:manage',
    'audit:view',
    'settings:manage',
  ],
  supervisor: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'attendance:verify',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'shortages:read',
    'shortages:write',
    'shortages:manage',
    'notes:read',
    'notes:write',
    'notes:resolve',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'walkie:all_channels',
    'profile:view',
    'reports:view',
    'reports:export',
    'staff:manage',
    'suppliers:manage',
    'audit:view',
  ],
  cashier: [
    'attendance:read',
    'shortages:read',
    'shortages:write',
    'notes:read',
    'notes:write',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'profile:view',
  ],
  cctv: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'attendance:verify',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'notes:read',
    'notes:write',
    'notes:resolve',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'walkie:all_channels',
    'profile:view',
    'reports:view',
    'reports:export',
  ],
  security: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'shortages:read',
    'notes:read',
    'notes:write',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'profile:view',
  ],
  hall: [
    'shortages:read',
    'shortages:write',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'profile:view',
  ],
  warehouse: [
    'attendance:kiosk',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'shortages:read',
    'shortages:write',
    'shortages:manage',
    'notes:read',
    'notes:write',
    'handover:manage',
    'chat:read',
    'chat:write',
    'walkie:use',
    'profile:view',
  ],
  delivery: [
    'attendance:kiosk',
    'shortages:read',
    'notes:read',
    'notes:write',
    'chat:read',
    'chat:write',
    'walkie:use',
    'profile:view',
  ],
  kiosk: ['attendance:kiosk'],
};

export function resolveAllowedWalkieChannels(
  role: string,
  permissions: string[] = []
): WalkieChannelId[] {
  const hasPerm = (p: string) => role === 'owner' || permissions.includes(p);
  if (!hasPerm('walkie:use') || role === 'kiosk') {
    return [];
  }
  if (hasPerm('walkie:all_channels') || role === 'owner') {
    return [...VALID_WALKIE_CHANNELS];
  }
  if (role === 'security') {
    return ['security', 'emergency'];
  }
  if (role === 'warehouse') {
    return ['warehouse', 'emergency'];
  }
  return ['floor', 'emergency'];
}

export function inferDefaultRoleFromDepartment(department = '', roleTitle = ''): string {
  const dept = String(department || '').trim();
  const title = String(roleTitle || '').trim();
  if (title.includes('كاميرات') || dept.includes('كاميرات')) return 'cctv';
  if (dept === 'نظافة' || title.includes('نظافة')) return 'none';
  if (dept.includes('أمن') || title.includes('أمن') || title.includes('حارس')) return 'security';
  if (dept === 'المدير' || title.includes('مدير')) return 'manager';
  if (dept.includes('إدارة') || dept.includes('مشرف') || title.includes('مشرف')) return 'supervisor';
  if (dept.includes('كاشير') || title.includes('كاشير')) return 'cashier';
  if (dept.includes('مخزن') || title.includes('مخزن')) return 'warehouse';
  if (dept.includes('دليفري') || title.includes('دليفري') || title.includes('توصيل') || title.includes('طيار')) return 'delivery';
  return 'hall';
}

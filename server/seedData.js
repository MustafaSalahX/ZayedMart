import crypto from 'node:crypto';
import { hashPin, encryptPasswordForAdmin } from './rbac.js';

export const SEED_ROLE_ACCOUNTS = [
  {
    id: 'cabc0e04-6b8f-4f68-9d6f-8d824cfd0ae9',
    username: 'admin',
    display_name: 'إدارة زايد مارت (Admin)',
    role: 'owner',
    password: '123',
    avatar_color: '#7627BB',
  },
  {
    id: '34cfe3c6-ebd0-4a8a-82e8-5eec90d82753',
    username: 'hall_370f91',
    display_name: 'كريم حسن (عامل الصالة)',
    role: 'hall',
    password: '777',
    avatar_color: '#007B83',
  },
  {
    id: 'd5b46bc6-7133-478c-88e6-a7b5e1b234b1',
    username: 'supervisor_acfaa6',
    display_name: 'أ. طارق الشاذلي (مشرف الصالة)',
    role: 'supervisor',
    password: '555',
    avatar_color: '#0B57D0',
  },
  {
    id: 'aced9496-4de6-4c96-8b77-d9c9c767b15b',
    username: 'cctv_df6271',
    display_name: 'أ. خالد منصور (مراقب الكاميرات)',
    role: 'cctv',
    password: '333',
    avatar_color: '#185ABC',
  },
  {
    id: 'b72805fd-1bbc-46e4-be0b-6dfde9265fc8',
    username: 'security_b4fbc4',
    display_name: 'عم رجب (بوابة الأمن والاستلام)',
    role: 'security',
    password: '444',
    avatar_color: '#146C2E',
  },
  {
    id: 'de78d971-c394-43da-bbbc-f192787c45d4',
    username: 'kiosk_f24aa1',
    display_name: 'شاشة كشك حضور العمال',
    role: 'kiosk',
    password: '000',
    avatar_color: '#E37400',
  },
];

export const SEED_EMPLOYEES = [
  {
    id: '6c058b52-c494-4fcc-b611-055defd26ead',
    emp_code: '101',
    name: 'أحمد محمد علي',
    department: 'كاشير',
    role_title: 'كاشير أول صباحي',
    shift_start: '08:00',
    shift_end: '16:00',
    avatar_color: '#0B57D0',
    phone: '01012345001',
    is_active: 1,
    system_role: 'hall',
    login_enabled: 1,
  },
  {
    id: '7beb37db-3cd9-4eea-b151-4dcc89e3315f',
    emp_code: '102',
    name: 'سارة خالد إبراهيم',
    department: 'كاشير',
    role_title: 'كاشير مسائي',
    shift_start: '15:00',
    shift_end: '23:00',
    avatar_color: '#9334E6',
    phone: '01012345002',
    is_active: 1,
    system_role: 'hall',
    login_enabled: 1,
  },
  {
    id: 'a8db792c-9fcf-4162-9291-a91d45b4794b',
    emp_code: '103',
    name: 'كريم حسن عبدربه',
    department: 'منسقي ممرات',
    role_title: 'منسق ممرات الصالة',
    shift_start: '08:00',
    shift_end: '17:00',
    avatar_color: '#007B83',
    phone: '01122334003',
    is_active: 1,
    system_role: 'hall',
    login_enabled: 1,
  },
  {
    id: 'c048a0b9-2597-4df7-b31f-b090310f54e8',
    emp_code: '104',
    name: 'مصطفى سيد شعبان',
    department: 'ثلاجات وأجبان',
    role_title: 'مسؤول ثلاجة الأجبان',
    shift_start: '08:00',
    shift_end: '17:00',
    avatar_color: '#E37400',
    phone: '01233445004',
    is_active: 1,
    system_role: 'hall',
    login_enabled: 1,
  },
  {
    id: 'a02bccd7-e4ab-4177-97e2-ac876af930fa',
    emp_code: '105',
    name: 'محمود فوزي عبدالمقصود',
    department: 'مخزن',
    role_title: 'أمين مخزن واستلام',
    shift_start: '09:00',
    shift_end: '18:00',
    avatar_color: '#146C2E',
    phone: '01098765005',
    is_active: 1,
    system_role: 'hall',
    login_enabled: 1,
  },
  {
    id: '435d24f9-e1dd-4d37-9e35-80a1a81f76fd',
    emp_code: '106',
    name: 'إسلام جمال الدسوقي',
    department: 'دليفري',
    role_title: 'طيار توصيل طلبات',
    shift_start: '10:00',
    shift_end: '20:00',
    avatar_color: '#B3261E',
    phone: '01155667006',
    is_active: 1,
    system_role: 'hall',
    login_enabled: 1,
  },
  {
    id: '7a142940-8ce3-40bd-93aa-91d511914fc6',
    emp_code: '107',
    name: 'رجب عبدالفتاح حسنين',
    department: 'أمن',
    role_title: 'أمن البوابة الرئيسية',
    shift_start: '08:00',
    shift_end: '16:00',
    avatar_color: '#185ABC',
    phone: '01277889007',
    is_active: 1,
    system_role: 'security',
    login_enabled: 1,
  },
  {
    id: '35b9ad92-7402-49e0-8c1c-7a851d2bf883',
    emp_code: '108',
    name: 'طارق نبيل الشاذلي',
    department: 'مشرفين',
    role_title: 'مشرف الصالة والفرع',
    shift_start: '08:00',
    shift_end: '17:00',
    avatar_color: '#3C4043',
    phone: '01066554008',
    is_active: 1,
    system_role: 'supervisor',
    login_enabled: 1,
  },
  {
    id: 'aecff9f9-9f1c-4a7a-841e-9a974be11889',
    emp_code: '233',
    name: 'مصطفي صلاح',
    department: 'مراقب كاميرات',
    role_title: 'مراقب كاميرات',
    shift_start: '20:00',
    shift_end: '08:00',
    avatar_color: '#0B57D0',
    phone: '01010574543',
    is_active: 1,
    system_role: 'cctv',
    login_enabled: 1,
  },
];

export const SEED_SUPPLIERS = [
  {
    id: '5eb728c8-8f8d-4c1c-af04-78ab44e78437',
    name: 'شركة جهينة للصناعات الغذائية',
    category: 'ألبان وجبن',
    icon: 'local_shipping',
    color: '#0B57D0',
    has_pending_return: 0,
    pending_return_note: '',
    phone: '01099887711',
    is_active: 1,
  },
  {
    id: '3eb9b36d-5d5f-4920-b43e-bd010cae0f23',
    name: 'شركة المراعي مصر',
    category: 'ألبان وجبن',
    icon: 'local_shipping',
    color: '#146C2E',
    has_pending_return: 0,
    pending_return_note: '',
    phone: '01099887722',
    is_active: 1,
  },
  {
    id: 'c0bdf7e6-6028-4f75-ad14-8c3d8e58681a',
    name: 'شركة بيبسي كولا مصر',
    category: 'مشروبات وعصائر',
    icon: 'local_shipping',
    color: '#185ABC',
    has_pending_return: 0,
    pending_return_note: '',
    phone: '01222334455',
    is_active: 1,
  },
  {
    id: 'd4fe2387-1c39-43c3-9deb-eb9bca6aa4f2',
    name: 'شركة شيبسي للصناعات الغذائية',
    category: 'شيبسي وسناكس',
    icon: 'local_shipping',
    color: '#E37400',
    has_pending_return: 1,
    pending_return_note: 'كرتونة شيبسي عائلي طعوم مكسورة بانتظار الاستبدال',
    phone: '01144556677',
    is_active: 1,
  },
  {
    id: '8c60cab7-c708-4cd5-906d-3b324f367835',
    name: 'شركة أرما للزيوت (كريستال)',
    category: 'بقالة جافة',
    icon: 'local_shipping',
    color: '#9334E6',
    has_pending_return: 0,
    pending_return_note: '',
    phone: '01033221100',
    is_active: 1,
  },
  {
    id: '7081ee3e-5056-4003-af58-cce39cfb7ad1',
    name: 'شركة يونيليفر مشرق للمنظفات',
    category: 'منظفات وورقيات',
    icon: 'local_shipping',
    color: '#007B83',
    has_pending_return: 0,
    pending_return_note: '',
    phone: '01288990011',
    is_active: 1,
  },
];

export const SEED_CATALOG = [
  {
    id: '360210a4-acaf-43bd-bc19-7089a58782fe',
    name: 'لبن جهينة كامل الدسم 1 لتر',
    category: 'ألبان وجبن',
    default_unit: 'كرتونة',
    usage_count: 2,
  },
  {
    id: 'ddac66cb-5542-421d-ab9a-0eb409373944',
    name: 'لبن المراعي كامل الدسم 1 لتر',
    category: 'ألبان وجبن',
    default_unit: 'كرتونة',
    usage_count: 1,
  },
  {
    id: '4ceedd52-e78c-401e-b754-7b3bdd65ac2d',
    name: 'زبادي جهينة طبيعي عبوة 6 قطع',
    category: 'ألبان وجبن',
    default_unit: 'كرتونة',
    usage_count: 1,
  },
  {
    id: '8cad60ed-e670-44d1-88f2-c554c2726eef',
    name: 'جبنة عبور لاند فيتا 500 جم',
    category: 'ألبان وجبن',
    default_unit: 'علبة',
    usage_count: 2,
  },
  {
    id: '84137c95-eeb2-4a5b-b8d6-c88fa3509ae4',
    name: 'جبنة دومتي بلس إسطنبولي 500 جم',
    category: 'ألبان وجبن',
    default_unit: 'علبة',
    usage_count: 1,
  },
  {
    id: '744a42f2-6619-4ec3-86ed-40a826021de8',
    name: 'زيت كريستال عباد الشمس 800 مل',
    category: 'بقالة جافة',
    default_unit: 'كرتونة',
    usage_count: 2,
  },
  {
    id: '62736d6d-e713-408b-9a5d-02f569c649d1',
    name: 'مكرونة الملكة خواتم 400 جم',
    category: 'بقالة جافة',
    default_unit: 'كرتونة',
    usage_count: 1,
  },
  {
    id: '82f9f77d-3b98-4580-8880-8652f7c0786b',
    name: 'صلصة طماطم هاينز برطمان 360 جم',
    category: 'بقالة جافة',
    default_unit: 'كرتونة',
    usage_count: 1,
  },
  {
    id: 'bfd593b0-011c-447b-a423-72e748a9d0f5',
    name: 'سكر الأسرة أبيض 1 كجم',
    category: 'بقالة جافة',
    default_unit: 'باكت',
    usage_count: 2,
  },
  {
    id: '359290a0-02ca-4935-abec-11dcc9ab1179',
    name: 'أرز الضحى مصري فاخر 1 كجم',
    category: 'بقالة جافة',
    default_unit: 'باكت',
    usage_count: 1,
  },
  {
    id: '5bc9f642-7f97-4185-b10b-cb021027d1d5',
    name: 'شاي العروسة ناعم 250 جم',
    category: 'بقالة جافة',
    default_unit: 'باكت',
    usage_count: 1,
  },
  {
    id: '182d030e-2595-4800-8bd0-188ffeb28574',
    name: 'بيبسي عائلي 2.5 لتر',
    category: 'مشروبات وعصائر',
    default_unit: 'باكت',
    usage_count: 2,
  },
  {
    id: '6cf3b707-933e-46a3-bed5-32daf03699ae',
    name: 'مياه نستله 1.5 لتر',
    category: 'مشروبات وعصائر',
    default_unit: 'باكت',
    usage_count: 1,
  },
  {
    id: '50f741da-e6d8-41c8-b7ab-9550492e35a9',
    name: 'عصير جهينة مانجو 1 لتر',
    category: 'مشروبات وعصائر',
    default_unit: 'باكت',
    usage_count: 1,
  },
  {
    id: 'a52d8149-9dc5-400e-8be1-b383a958a980',
    name: 'مناديل فاين سحب 550 منديل',
    category: 'منظفات وورقيات',
    default_unit: 'باكت',
    usage_count: 1,
  },
  {
    id: '7deaed47-ef03-4671-81cc-17d3463fd569',
    name: 'سائل بريل لغسيل الأطباق 1 لتر',
    category: 'منظفات وورقيات',
    default_unit: 'باكت',
    usage_count: 1,
  },
  {
    id: 'dcbdc0c6-4f29-46eb-84ec-0cbcd959cedf',
    name: 'مسحوق أريال أوتوماتيك 4 كجم',
    category: 'منظفات وورقيات',
    default_unit: 'باكت',
    usage_count: 1,
  },
];

export const SEED_SHORTAGES = [
  {
    id: '81d648bd-df08-48fc-bfc2-57983cd93398',
    product_id: '360210a4-acaf-43bd-bc19-7089a58782fe',
    item_name: 'لبن جهينة كامل الدسم 1 لتر',
    category: 'ألبان وجبن',
    requested_qty: null,
    unit: '',
    urgency: 'out_of_stock',
    status: 'open',
    notes: 'الرف فاضي بالكامل في ممر الألبان',
    recorded_by: 'كريم حسن (عامل الصالة) (عمال الصالة)',
    recorded_by_role: 'hall',
    updated_by: '',
    resolved_by: '',
    resolved_at: '',
  },
  {
    id: '6cb1c092-48e7-444e-8cbe-6c20e47b28c5',
    product_id: '8cad60ed-e670-44d1-88f2-c554c2726eef',
    item_name: 'جبنة عبور لاند فيتا 500 جم',
    category: 'ألبان وجبن',
    requested_qty: 0,
    unit: 'علبة',
    urgency: 'low_stock',
    status: 'open',
    notes: 'متبقي علبتين فقط بالعرض — راجع رصيد الثلاجة الخلفية أولاً',
    recorded_by: 'كريم حسن (عامل الصالة) (عمال الصالة)',
    recorded_by_role: 'hall',
    updated_by: '',
    resolved_by: '',
    resolved_at: '',
  },
  {
    id: '76e7ec95-01e9-430a-81e8-f22a511e5d88',
    product_id: '744a42f2-6619-4ec3-86ed-40a826021de8',
    item_name: 'زيت كريستال عباد الشمس 800 مل',
    category: 'بقالة جافة',
    requested_qty: 5,
    unit: 'كرتونة',
    urgency: 'out_of_stock',
    status: 'open',
    notes: '',
    recorded_by: 'كريم حسن (عامل الصالة) (عمال الصالة)',
    recorded_by_role: 'hall',
    updated_by: '',
    resolved_by: '',
    resolved_at: '',
  },
  {
    id: 'aff78780-992c-4e40-9ed1-69d14ab31210',
    product_id: 'bfd593b0-011c-447b-a423-72e748a9d0f5',
    item_name: 'سكر الأسرة أبيض 1 كجم',
    category: 'بقالة جافة',
    requested_qty: 12,
    unit: 'باكت',
    urgency: 'out_of_stock',
    status: 'ordered',
    notes: '',
    recorded_by: 'كريم حسن (عامل الصالة) (عمال الصالة)',
    recorded_by_role: 'hall',
    updated_by: 'أ. طارق الشاذلي (مشرف الصالة) (مشرف الفرع)',
    resolved_by: '',
    resolved_at: '',
  },
  {
    id: 'ef2298e5-e09d-4004-825e-f506c81bb406',
    product_id: '182d030e-2595-4800-8bd0-188ffeb28574',
    item_name: 'بيبسي عائلي 2.5 لتر',
    category: 'مشروبات وعصائر',
    requested_qty: null,
    unit: '',
    urgency: 'low_stock',
    status: 'resolved',
    notes: '',
    recorded_by: 'كريم حسن (عامل الصالة) (عمال الصالة)',
    recorded_by_role: 'hall',
    updated_by: 'أ. طارق الشاذلي (مشرف الصالة) (مشرف الفرع)',
    resolved_by: 'أ. طارق الشاذلي (مشرف الصالة) (مشرف الفرع)',
  },
];

export const SEED_ATTENDANCE = [
  {
    id: '7c823f25-c1a3-497f-95b9-d9ca62ea301c',
    employee_id: '6c058b52-c494-4fcc-b611-055defd26ead',
    employee_name: 'أحمد محمد علي',
    department: 'كاشير',
    action_type: 'check_in',
    late_minutes: 0,
    note: 'تسجيل سريع عبر الكود / QR',
    recorded_by: 'كشك العمال [QR]',
    verified_by_cctv: 1,
  },
  {
    id: 'd4f96697-c020-4d8d-8fa5-e62adb17e3bd',
    employee_id: 'a8db792c-9fcf-4162-9291-a91d45b4794b',
    employee_name: 'كريم حسن عبدربه',
    department: 'منسقي ممرات',
    action_type: 'check_in',
    late_minutes: 0,
    note: 'تسجيل سريع عبر الكود / QR',
    recorded_by: 'كشك العمال [QR]',
    verified_by_cctv: 1,
  },
  {
    id: '124201a6-7934-4de2-a0c4-efaeef49c03a',
    employee_id: 'c048a0b9-2597-4df7-b31f-b090310f54e8',
    employee_name: 'مصطفى سيد شعبان',
    department: 'ثلاجات وأجبان',
    action_type: 'check_in',
    late_minutes: 0,
    note: 'حضور منتظم',
    recorded_by: 'عم رجب (بوابة الأمن والاستلام) (الأمن)',
    verified_by_cctv: 1,
  },
  {
    id: '10c7d628-45cc-4da1-8c43-eaebd50770d5',
    employee_id: 'aecff9f9-9f1c-4a7a-841e-9a974be11889',
    employee_name: 'مصطفي صلاح',
    department: 'مراقب كاميرات',
    action_type: 'check_in',
    late_minutes: 0,
    note: 'حضور منتظم',
    recorded_by: 'إدارة زايد مارت (Admin) (المالك)',
    verified_by_cctv: 1,
  },
];

export const SEED_TRUCKS = [
  {
    id: 'bd6c93db-5cca-4a49-9f8b-7cb43e71aa29',
    supplier_id: '3eb9b36d-5d5f-4920-b43e-bd010cae0f23',
    supplier_name: 'شركة المراعي مصر',
    category: 'ألبان وجبن',
    plate_or_driver: 'س م ر 4821 - مندوب هاني',
    status: 'completed',
    duration_minutes: 25,
    delivery_condition: 'complete',
    invoice_number: 'INV-9021',
    notes: 'العدد مطابق للفاتورة بالكامل وتم الفحص',
    recorded_by: 'عم رجب (بوابة الأمن والاستلام) (الأمن)',
    verified_by_cctv: 1,
  },
  {
    id: '755d8ba0-57d1-487b-9956-d3b27316bc79',
    supplier_id: '5eb728c8-8f8d-4c1c-af04-78ab44e78437',
    supplier_name: 'شركة جهينة للصناعات الغذائية',
    category: 'ألبان وجبن',
    plate_or_driver: 'ق ط ب 7712 - مندوب وليد',
    status: 'completed',
    duration_minutes: 40,
    delivery_condition: 'complete',
    invoice_number: 'INV-9055',
    notes: 'تم استلام الألبان والزبادي ومراجعة المرتجع السابق',
    recorded_by: 'عم رجب (بوابة الأمن والاستلام) (الأمن)',
    verified_by_cctv: 1,
  },
];

export const SEED_NOTES = [
  {
    id: '919a3e3b-cc9a-4db4-8baf-0f08da3ce6cc',
    location_tag: 'منطقة الكاشير',
    category_tag: 'زحام على الكاشير',
    severity: 'warning',
    dvr_timestamp: '11:39:08',
    content: 'زحام متوسط على كاشير 1 — يرجى فتح كاشير إضافي وقت الذروة',
    recorded_by: 'أ. خالد منصور (مراقب الكاميرات) (مراقب الكاميرات)',
    is_open_handover: 1,
  },
  {
    id: 'fc21e986-07e6-4beb-b0f9-a84da5df88fb',
    location_tag: 'الثلاجات والأجبان',
    category_tag: 'ثلاجة مفتوحة أو عطل',
    severity: 'urgent',
    dvr_timestamp: '11:45:12',
    content: 'باب ثلاجة العصائر رقم 2 لم يغلق بإحكام — تم إبلاغ مشرف الصالة',
    recorded_by: 'أ. خالد منصور (مراقب الكاميرات) (مراقب الكاميرات)',
    is_open_handover: 1,
  },
];

export function deterministicSaltHex(seedKey) {
  return crypto.createHash('sha256').update(`zayed-salt:${seedKey}`).digest('hex').slice(0, 32);
}

export function seedInitialStoreData(db, secretHex, dateKey) {
  const nowIso = new Date().toISOString();

  // 1. Seed Role Accounts (123, 777, 555, 333, 444, 000)
  const insertUserStmt = db.prepare(`
    INSERT OR IGNORE INTO system_users (
      id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, employee_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
  `);

  for (const acc of SEED_ROLE_ACCOUNTS) {
    const saltHex = deterministicSaltHex(`role-user:${acc.id}:${acc.password}`);
    const { hashHex } = hashPin(acc.password, saltHex);
    const cipher = encryptPasswordForAdmin(acc.password, secretHex);
    insertUserStmt.run(
      acc.id,
      acc.username,
      acc.display_name,
      acc.role,
      saltHex,
      hashHex,
      cipher,
      acc.avatar_color,
      nowIso,
      nowIso
    );
  }

  // 2. Seed Employees (101-108, 233)
  const insertEmpStmt = db.prepare(`
    INSERT OR IGNORE INTO employees (
      id, emp_code, name, department, role_title, shift_start, shift_end, avatar_color, phone, is_active, system_role, login_enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const emp of SEED_EMPLOYEES) {
    insertEmpStmt.run(
      emp.id,
      emp.emp_code,
      emp.name,
      emp.department,
      emp.role_title,
      emp.shift_start,
      emp.shift_end,
      emp.avatar_color,
      emp.phone,
      emp.is_active,
      emp.system_role,
      emp.login_enabled,
      nowIso
    );
  }

  // 3. Seed Suppliers
  const insertSupStmt = db.prepare(`
    INSERT OR IGNORE INTO suppliers (
      id, name, category, icon, color, has_pending_return, pending_return_note, phone, is_active, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const sup of SEED_SUPPLIERS) {
    insertSupStmt.run(
      sup.id,
      sup.name,
      sup.category,
      sup.icon,
      sup.color,
      sup.has_pending_return,
      sup.pending_return_note,
      sup.phone,
      sup.is_active,
      nowIso
    );
  }

  // 4. Seed Product Catalog
  const insertCatStmt = db.prepare(`
    INSERT OR IGNORE INTO product_catalog (
      id, name, category, default_unit, supplier_id, usage_count, is_active, updated_at
    ) VALUES (?, ?, ?, ?, '', ?, 1, ?)
  `);

  for (const item of SEED_CATALOG) {
    insertCatStmt.run(
      item.id,
      item.name,
      item.category,
      item.default_unit,
      item.usage_count,
      nowIso
    );
  }

  // 5. Seed Shortages
  const insertShortageStmt = db.prepare(`
    INSERT OR IGNORE INTO shortages (
      id, product_id, item_name, category, requested_qty, unit, urgency, status,
      supplier_id, supplier_name, notes, recorded_by, recorded_by_role, updated_by,
      resolved_by, resolved_at, timestamp, updated_at, date_key, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  for (const s of SEED_SHORTAGES) {
    insertShortageStmt.run(
      s.id,
      s.product_id,
      s.item_name,
      s.category,
      s.requested_qty,
      s.unit,
      s.urgency,
      s.status,
      s.notes,
      s.recorded_by,
      s.recorded_by_role,
      s.updated_by,
      s.resolved_by,
      s.status === 'resolved' ? nowIso : '',
      nowIso,
      nowIso,
      dateKey
    );
  }

  // 6. Seed Attendance Logs
  const insertAttStmt = db.prepare(`
    INSERT OR IGNORE INTO attendance_logs (
      id, employee_id, employee_name, department, action_type, timestamp, date_key,
      late_minutes, note, proof_url, recorded_by, verified_by_cctv, verified_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 0)
  `);

  for (const a of SEED_ATTENDANCE) {
    insertAttStmt.run(
      a.id,
      a.employee_id,
      a.employee_name,
      a.department,
      a.action_type,
      nowIso,
      dateKey,
      a.late_minutes,
      a.note,
      a.recorded_by,
      a.verified_by_cctv,
      a.verified_by_cctv ? nowIso : ''
    );
  }

  // 7. Seed Truck Logs
  const insertTruckStmt = db.prepare(`
    INSERT OR IGNORE INTO truck_logs (
      id, supplier_id, supplier_name, category, plate_or_driver, status, arrival_time,
      departure_time, duration_minutes, date_key, delivery_condition, invoice_number,
      notes, arrival_proof_url, completion_proof_url, recorded_by, verified_by_cctv, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, 0)
  `);

  for (const t of SEED_TRUCKS) {
    insertTruckStmt.run(
      t.id,
      t.supplier_id,
      t.supplier_name,
      t.category,
      t.plate_or_driver,
      t.status,
      nowIso,
      t.status === 'completed' ? nowIso : '',
      t.duration_minutes,
      dateKey,
      t.delivery_condition,
      t.invoice_number,
      t.notes,
      t.recorded_by,
      t.verified_by_cctv
    );
  }

  // 8. Seed CCTV / Gate Notes
  const insertNoteStmt = db.prepare(`
    INSERT OR IGNORE INTO notes (
      id, location_tag, category_tag, severity, dvr_timestamp, content, proof_url,
      recorded_by, is_open_handover, resolved_by, resolved_at, timestamp, date_key, synced
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '', '', ?, ?, 0)
  `);

  for (const n of SEED_NOTES) {
    insertNoteStmt.run(
      n.id,
      n.location_tag,
      n.category_tag,
      n.severity,
      n.dvr_timestamp,
      n.content,
      n.recorded_by,
      n.is_open_handover,
      nowIso,
      dateKey
    );
  }
}

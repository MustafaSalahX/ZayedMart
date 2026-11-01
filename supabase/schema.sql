-- مخطط قاعدة البيانات السحابية الشامل لنظام "زايد مارت" (v3.6 - PWA Offline-First + Vercel + Supabase 3-Way Sync)
-- انسخ هذا الكود بالكامل في نافذة SQL Editor داخل مشروعك المجاني على Supabase واضغط Run

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_cipher TEXT DEFAULT '',
  avatar_color TEXT DEFAULT '#0B57D0',
  is_active INTEGER DEFAULT 1,
  employee_id TEXT DEFAULT '',
  custom_permissions_json TEXT DEFAULT '[]',
  last_login_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_policies (
  role TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT DEFAULT '',
  user_name TEXT NOT NULL,
  role TEXT DEFAULT '',
  action TEXT NOT NULL,
  details TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  severity TEXT DEFAULT 'info',
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  emp_code TEXT DEFAULT '',
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  role_title TEXT DEFAULT '',
  shift_start TEXT DEFAULT '08:00',
  shift_end TEXT DEFAULT '20:00',
  avatar_color TEXT DEFAULT '#1A73E8',
  phone TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  system_role TEXT DEFAULT '',
  login_enabled INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  action_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  date_key TEXT NOT NULL,
  shift_date_key TEXT DEFAULT '',
  late_minutes INTEGER DEFAULT 0,
  allowed_break_minutes INTEGER DEFAULT 0,
  break_duration_minutes INTEGER DEFAULT 0,
  break_reason TEXT DEFAULT '',
  note TEXT DEFAULT '',
  proof_url TEXT DEFAULT '',
  recorded_by TEXT NOT NULL,
  verified_by_cctv INTEGER DEFAULT 0,
  verified_at TEXT DEFAULT '',
  synced INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT DEFAULT 'local_shipping',
  color TEXT DEFAULT '#1A73E8',
  has_pending_return INTEGER DEFAULT 0,
  pending_return_note TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS truck_logs (
  id TEXT PRIMARY KEY,
  supplier_id TEXT DEFAULT '',
  supplier_name TEXT NOT NULL,
  category TEXT NOT NULL,
  plate_or_driver TEXT DEFAULT '',
  status TEXT NOT NULL,
  arrival_time TEXT NOT NULL,
  departure_time TEXT DEFAULT '',
  duration_minutes INTEGER DEFAULT 0,
  date_key TEXT NOT NULL,
  delivery_condition TEXT DEFAULT 'pending',
  invoice_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  arrival_proof_url TEXT DEFAULT '',
  completion_proof_url TEXT DEFAULT '',
  recorded_by TEXT NOT NULL,
  verified_by_cctv INTEGER DEFAULT 0,
  synced INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  location_tag TEXT NOT NULL,
  category_tag TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  dvr_timestamp TEXT NOT NULL,
  content TEXT NOT NULL,
  proof_url TEXT DEFAULT '',
  recorded_by TEXT NOT NULL,
  is_open_handover INTEGER DEFAULT 0,
  resolved_by TEXT DEFAULT '',
  resolved_at TEXT DEFAULT '',
  timestamp TEXT NOT NULL,
  date_key TEXT NOT NULL,
  synced INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shift_handovers (
  id TEXT PRIMARY KEY,
  from_operator TEXT NOT NULL,
  to_operator TEXT NOT NULL,
  shift_name TEXT NOT NULL,
  summary_note TEXT DEFAULT '',
  open_items_json TEXT DEFAULT '[]',
  open_trucks_count INTEGER DEFAULT 0,
  open_notes_count INTEGER DEFAULT 0,
  present_staff_count INTEGER DEFAULT 0,
  acknowledged INTEGER DEFAULT 0,
  acknowledged_at TEXT DEFAULT '',
  from_role TEXT DEFAULT '',
  target_role TEXT DEFAULT '',
  timestamp TEXT NOT NULL,
  date_key TEXT NOT NULL,
  synced INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'بقالة جافة',
  default_unit TEXT DEFAULT '',
  supplier_id TEXT DEFAULT '',
  usage_count INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shortages (
  id TEXT PRIMARY KEY,
  product_id TEXT DEFAULT '',
  item_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'بقالة جافة',
  requested_qty DOUBLE PRECISION DEFAULT NULL,
  unit TEXT DEFAULT '',
  urgency TEXT NOT NULL DEFAULT 'out_of_stock',
  status TEXT NOT NULL DEFAULT 'open',
  is_suggestion INTEGER DEFAULT 0,
  supplier_id TEXT DEFAULT '',
  supplier_name TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  recorded_by TEXT NOT NULL,
  recorded_by_role TEXT DEFAULT '',
  updated_by TEXT DEFAULT '',
  resolved_by TEXT DEFAULT '',
  resolved_at TEXT DEFAULT '',
  timestamp TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date_key TEXT NOT NULL,
  synced INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS team_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'general',
  sender_id TEXT DEFAULT '',
  sender_name TEXT NOT NULL,
  sender_role TEXT DEFAULT '',
  content TEXT NOT NULL,
  is_urgent INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL,
  date_key TEXT NOT NULL,
  synced INTEGER DEFAULT 1
);

-- ترقية آمنة للمشاريع القائمة مسبقاً على Supabase بدون فقدان أي بيانات
ALTER TABLE employees ADD COLUMN IF NOT EXISTS system_role TEXT DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS login_enabled INTEGER DEFAULT 1;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS shift_date_key TEXT DEFAULT '';
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS allowed_break_minutes INTEGER DEFAULT 0;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_duration_minutes INTEGER DEFAULT 0;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS break_reason TEXT DEFAULT '';
ALTER TABLE shortages ADD COLUMN IF NOT EXISTS is_suggestion INTEGER DEFAULT 0;
ALTER TABLE shift_handovers ADD COLUMN IF NOT EXISTS from_role TEXT DEFAULT '';
ALTER TABLE shift_handovers ADD COLUMN IF NOT EXISTS target_role TEXT DEFAULT '';

INSERT INTO storage.buckets (id, name, public)
VALUES ('zayed-proofs', 'zayed-proofs', true)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'settings',
    'system_users',
    'role_policies',
    'audit_logs',
    'employees',
    'attendance_logs',
    'suppliers',
    'truck_logs',
    'notes',
    'shift_handovers',
    'product_catalog',
    'shortages',
    'team_messages'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "zayed_all_%s" ON %I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "zayed_all_%s" ON %I FOR ALL USING (true) WITH CHECK (true);', tbl, tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "zayed_proofs_public_read" ON storage.objects;
CREATE POLICY "zayed_proofs_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'zayed-proofs');

DROP POLICY IF EXISTS "zayed_proofs_public_insert" ON storage.objects;
CREATE POLICY "zayed_proofs_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'zayed-proofs');

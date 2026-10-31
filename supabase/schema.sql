-- مخطط قاعدة البيانات السحابية لنظام "زايد مارت" (Supabase Cloud Sync & RBAC Security)
-- انسخ هذا الكود بالكامل في نافذة SQL Editor داخل مشروعك المجاني على Supabase واضغط Run

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
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
  shift_end TEXT DEFAULT '17:00',
  avatar_color TEXT DEFAULT '#1A73E8',
  phone TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
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
  late_minutes INTEGER DEFAULT 0,
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

INSERT INTO storage.buckets (id, name, public)
VALUES ('zayed-proofs', 'zayed-proofs', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE truck_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE shortages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['settings','audit_logs','employees','attendance_logs','suppliers','truck_logs','notes','shift_handovers','product_catalog','shortages']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "zayed_all_%s" ON %I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "zayed_all_%s" ON %I FOR ALL USING (true) WITH CHECK (true);', tbl, tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "zayed_proofs_public_read" ON storage.objects;
CREATE POLICY "zayed_proofs_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'zayed-proofs');

DROP POLICY IF EXISTS "zayed_proofs_public_insert" ON storage.objects;
CREATE POLICY "zayed_proofs_public_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'zayed-proofs');

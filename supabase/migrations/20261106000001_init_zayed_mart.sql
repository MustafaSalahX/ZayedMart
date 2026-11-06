-- ZayedMart Cloud Production Schema (PostgreSQL 17 + Hardened RLS + Composite Indexes)
-- Project: ZayedMart (efeioijgxjyyqplfusub)

CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.system_users (
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

CREATE TABLE IF NOT EXISTS public.role_policies (
  role TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
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

CREATE TABLE IF NOT EXISTS public.employees (
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

CREATE TABLE IF NOT EXISTS public.attendance_logs (
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

CREATE TABLE IF NOT EXISTS public.suppliers (
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

CREATE TABLE IF NOT EXISTS public.truck_logs (
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

CREATE TABLE IF NOT EXISTS public.notes (
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

CREATE TABLE IF NOT EXISTS public.shift_handovers (
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

CREATE TABLE IF NOT EXISTS public.product_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'بقالة جافة',
  default_unit TEXT DEFAULT '',
  supplier_id TEXT DEFAULT '',
  usage_count INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shortages (
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

CREATE TABLE IF NOT EXISTS public.team_messages (
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

CREATE TABLE IF NOT EXISTS public.walkie_calls (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'security',
  kind TEXT NOT NULL DEFAULT 'voice',
  sender_id TEXT DEFAULT '',
  sender_name TEXT NOT NULL,
  sender_role TEXT DEFAULT '',
  audio_data TEXT DEFAULT '',
  mime_type TEXT DEFAULT 'audio/webm',
  duration_sec DOUBLE PRECISION DEFAULT 0,
  is_emergency INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL,
  date_key TEXT NOT NULL,
  synced INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.walkie_presence (
  presence_key TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  role_label TEXT DEFAULT '',
  avatar_color TEXT DEFAULT '#146C2E',
  channel TEXT NOT NULL DEFAULT 'security',
  status TEXT NOT NULL DEFAULT 'listening',
  live_on INTEGER DEFAULT 1,
  mic_mode TEXT DEFAULT 'vad',
  updated_at_ms BIGINT NOT NULL
);

-- Composite B-Tree Indexes for Fast Operational Queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_revoked ON public.user_sessions (user_id, revoked, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_time ON public.audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_employees_active_dept ON public.employees (is_active, department, emp_code);
CREATE INDEX IF NOT EXISTS idx_attendance_date_ts ON public.attendance_logs (date_key, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_shift_date ON public.attendance_logs (shift_date_key, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_ts ON public.attendance_logs (employee_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON public.suppliers (is_active, has_pending_return DESC);
CREATE INDEX IF NOT EXISTS idx_trucks_date_arrival ON public.truck_logs (date_key, arrival_time DESC);
CREATE INDEX IF NOT EXISTS idx_trucks_status ON public.truck_logs (status, arrival_time DESC);
CREATE INDEX IF NOT EXISTS idx_notes_date_ts ON public.notes (date_key, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notes_open ON public.notes (is_open_handover, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_handovers_ts ON public.shift_handovers (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_active_usage ON public.product_catalog (is_active, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_shortages_status_updated ON public.shortages (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_shortages_date ON public.shortages (date_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_messages_channel_ts ON public.team_messages (channel, is_pinned DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_team_messages_ts ON public.team_messages (is_pinned DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_walkie_calls_channel_ts ON public.walkie_calls (channel, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_walkie_presence_channel_ms ON public.walkie_presence (channel, updated_at_ms DESC);

-- Storage Bucket for Operational Proof Images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('zayed-proofs', 'zayed-proofs', true, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 8388608,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Hardened Row Level Security (Backend Service Role Only — Zero Public Table Exposure)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'settings',
    'system_users',
    'role_policies',
    'user_sessions',
    'audit_logs',
    'employees',
    'attendance_logs',
    'suppliers',
    'truck_logs',
    'notes',
    'shift_handovers',
    'product_catalog',
    'shortages',
    'team_messages',
    'walkie_calls',
    'walkie_presence'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "zayed_all_%s" ON public.%I;', tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_only_%s" ON public.%I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "service_role_only_%s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', tbl, tbl);
  END LOOP;
END $$;

-- Storage Policies: Public read for proof images; uploads restricted to authenticated NestJS backend
DROP POLICY IF EXISTS "zayed_proofs_public_read" ON storage.objects;
CREATE POLICY "zayed_proofs_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'zayed-proofs');

DROP POLICY IF EXISTS "zayed_proofs_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "zayed_proofs_service_all" ON storage.objects;
CREATE POLICY "zayed_proofs_service_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'zayed-proofs')
  WITH CHECK (bucket_id = 'zayed-proofs');

-- مخطط قاعدة البيانات السحابية المعتمد لنظام "زايد مارت" (v4.0 - Turborepo + NestJS + Supabase Production)
-- تم تطبيقه وتأمينه بالكامل (Hardened RLS + Composite Indexes) على مشروع ZayedMart (efeioijgxjyyqplfusub)

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

CREATE TABLE IF NOT EXISTS public.employee_dayoff_defaults (
  employee_id TEXT PRIMARY KEY,
  team_group TEXT NOT NULL CHECK (team_group IN ('cashiers', 'hall', 'security_cctv')),
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.weekly_dayoff_overrides (
  id TEXT PRIMARY KEY,
  week_start_date TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  team_group TEXT NOT NULL CHECK (team_group IN ('cashiers', 'hall', 'security_cctv')),
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'swap', 'move', 'revert')),
  swap_request_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE(week_start_date, employee_id)
);

CREATE TABLE IF NOT EXISTS public.dayoff_swap_requests (
  id TEXT PRIMARY KEY,
  request_type TEXT NOT NULL DEFAULT 'swap' CHECK (request_type IN ('swap', 'move')),
  scope TEXT NOT NULL DEFAULT 'week' CHECK (scope IN ('week', 'permanent')),
  week_start_date TEXT NOT NULL,
  team_group TEXT NOT NULL CHECK (team_group IN ('cashiers', 'hall', 'security_cctv')),
  requester_employee_id TEXT NOT NULL,
  requester_from_day TEXT NOT NULL CHECK (requester_from_day IN ('sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri')),
  target_employee_id TEXT NOT NULL DEFAULT '',
  target_from_day TEXT NOT NULL CHECK (target_from_day IN ('sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri')),
  reason TEXT NOT NULL DEFAULT '',
  requester_approved INTEGER NOT NULL DEFAULT 0,
  requester_approved_at TEXT NOT NULL DEFAULT '',
  target_approved INTEGER NOT NULL DEFAULT 0,
  target_approved_at TEXT NOT NULL DEFAULT '',
  manager_approved INTEGER NOT NULL DEFAULT 0,
  manager_approved_by TEXT NOT NULL DEFAULT '',
  manager_approved_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_peer' CHECK (status IN ('pending_requester', 'pending_peer', 'pending_manager', 'approved', 'rejected', 'cancelled', 'reverted')),
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dayoff_defaults_team
  ON public.employee_dayoff_defaults(team_group, day_of_week);
CREATE INDEX IF NOT EXISTS idx_dayoff_overrides_week_team
  ON public.weekly_dayoff_overrides(week_start_date, team_group);
CREATE INDEX IF NOT EXISTS idx_dayoff_overrides_emp
  ON public.weekly_dayoff_overrides(employee_id, week_start_date);
CREATE INDEX IF NOT EXISTS idx_dayoff_swaps_week_status
  ON public.dayoff_swap_requests(week_start_date, status);
CREATE INDEX IF NOT EXISTS idx_dayoff_swaps_requester_pending
  ON public.dayoff_swap_requests(requester_employee_id, week_start_date)
  WHERE status IN ('pending_requester', 'pending_peer', 'pending_manager');
CREATE INDEX IF NOT EXISTS idx_dayoff_swaps_target_pending
  ON public.dayoff_swap_requests(target_employee_id, week_start_date)
  WHERE status IN ('pending_requester', 'pending_peer', 'pending_manager');

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'employee_dayoff_defaults',
    'weekly_dayoff_overrides',
    'dayoff_swap_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_only_%s" ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "service_role_only_%s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      tbl,
      tbl
    );
  END LOOP;
END $$;

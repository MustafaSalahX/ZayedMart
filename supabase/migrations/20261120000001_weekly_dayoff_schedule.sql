-- Weekly Day-Off Schedule & Dual-Cashier Swap Feature
-- Project: ZayedMart (efeioijgxjyyqplfusub)

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

-- Composite and Partial Indexes for Schedule & Pending Swap Queries
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

-- Hardened Row Level Security (Service Role Only — Zero Direct Public Access)
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

-- Idempotent RBAC Policy Backfill for schedule:* Permissions
DO $$
DECLARE
  v_now TEXT := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_role TEXT;
  v_extra TEXT[];
  v_existing TEXT;
  v_arr JSONB;
  v_perm TEXT;
  v_role_map JSONB := jsonb_build_object(
    'owner', jsonb_build_array('schedule:read', 'schedule:manage', 'schedule:swap_request'),
    'manager', jsonb_build_array('schedule:read', 'schedule:manage', 'schedule:swap_request'),
    'supervisor', jsonb_build_array('schedule:read', 'schedule:manage', 'schedule:swap_request'),
    'cashier', jsonb_build_array('schedule:read', 'schedule:swap_request'),
    'hall', jsonb_build_array('schedule:read'),
    'cctv', jsonb_build_array('schedule:read'),
    'security', jsonb_build_array('schedule:read'),
    'warehouse', jsonb_build_array('schedule:read'),
    'delivery', jsonb_build_array('schedule:read')
  );
BEGIN
  FOR v_role IN SELECT jsonb_object_keys(v_role_map)
  LOOP
    SELECT permissions_json INTO v_existing
    FROM public.role_policies
    WHERE role = v_role;

    IF FOUND THEN
      BEGIN
        v_arr := COALESCE(v_existing::jsonb, '[]'::jsonb);
        IF jsonb_typeof(v_arr) <> 'array' THEN
          v_arr := '[]'::jsonb;
        END IF;

        SELECT ARRAY(SELECT jsonb_array_elements_text(v_role_map -> v_role)) INTO v_extra;

        FOREACH v_perm IN ARRAY v_extra
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_arr) AS elem(val) WHERE elem.val = v_perm
          ) THEN
            v_arr := v_arr || to_jsonb(v_perm);
          END IF;
        END LOOP;

        UPDATE public.role_policies
        SET permissions_json = v_arr::text,
            updated_at = v_now
        WHERE role = v_role;
      EXCEPTION WHEN OTHERS THEN
        -- Ignore malformed existing JSON rows
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

INSERT INTO public.settings (key, value)
VALUES
  ('migration_schedule_tables_v41', 'done'),
  ('migration_rbac_schedule_v41', 'done')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

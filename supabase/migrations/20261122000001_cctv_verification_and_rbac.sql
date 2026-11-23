-- CCTV Attendance Verification Columns & Strict Attendance RBAC Policy Migration
-- Project: ZayedMart (efeioijgxjyyqplfusub)

-- 1. Idempotently add CCTV verification metadata columns to public.attendance_logs
ALTER TABLE public.attendance_logs
  ADD COLUMN IF NOT EXISTS verified_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cctv_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS cctv_observed_time TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS cctv_note TEXT DEFAULT '';

-- 2. Backfill existing records safely
UPDATE public.attendance_logs
SET cctv_status = 'confirmed'
WHERE verified_by_cctv = 1
  AND COALESCE(cctv_status, 'pending') <> 'confirmed';

UPDATE public.attendance_logs
SET cctv_status = 'pending'
WHERE cctv_status IS NULL
   OR cctv_status = '';

-- 3. Partial index for pending/mismatch CCTV verification queries
CREATE INDEX IF NOT EXISTS idx_attendance_logs_cctv_status
  ON public.attendance_logs (date_key, cctv_status)
  WHERE cctv_status <> 'confirmed';

-- 4. Idempotent RBAC Policy Update:
--    - Strip attendance:self and attendance:kiosk from non-kiosk operational roles
--    - Strip attendance:write from cashier, hall, warehouse, delivery
--    - Ensure attendance:write on manager, supervisor, cctv, security
--    - Ensure attendance:verify on manager, supervisor, cctv
DO $$
DECLARE
  v_now TEXT := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_role TEXT;
  v_existing TEXT;
  v_arr JSONB;
  v_strip TEXT[];
  v_add TEXT[];
  v_perm TEXT;
  v_strip_map JSONB := jsonb_build_object(
    'manager', jsonb_build_array('attendance:self', 'attendance:kiosk'),
    'supervisor', jsonb_build_array('attendance:self', 'attendance:kiosk'),
    'cctv', jsonb_build_array('attendance:self', 'attendance:kiosk'),
    'security', jsonb_build_array('attendance:self', 'attendance:kiosk'),
    'cashier', jsonb_build_array('attendance:self', 'attendance:kiosk', 'attendance:write'),
    'hall', jsonb_build_array('attendance:self', 'attendance:kiosk', 'attendance:write'),
    'warehouse', jsonb_build_array('attendance:self', 'attendance:kiosk', 'attendance:write'),
    'delivery', jsonb_build_array('attendance:self', 'attendance:kiosk', 'attendance:write')
  );
  v_add_map JSONB := jsonb_build_object(
    'manager', jsonb_build_array('attendance:write', 'attendance:verify'),
    'supervisor', jsonb_build_array('attendance:write', 'attendance:verify'),
    'cctv', jsonb_build_array('attendance:write', 'attendance:verify'),
    'security', jsonb_build_array('attendance:write')
  );
BEGIN
  FOR v_role IN SELECT jsonb_object_keys(v_strip_map)
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

        SELECT ARRAY(SELECT jsonb_array_elements_text(v_strip_map -> v_role)) INTO v_strip;
        v_arr := COALESCE(
          (
            SELECT jsonb_agg(elem ORDER BY ord)
            FROM (
              SELECT elem, MIN(ord) AS ord
              FROM jsonb_array_elements_text(v_arr) WITH ORDINALITY AS t(elem, ord)
              WHERE NOT (elem = ANY(v_strip))
              GROUP BY elem
            ) dedup
          ),
          '[]'::jsonb
        );

        IF v_add_map ? v_role THEN
          SELECT ARRAY(SELECT jsonb_array_elements_text(v_add_map -> v_role)) INTO v_add;
          FOREACH v_perm IN ARRAY v_add
          LOOP
            IF NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(v_arr) AS elem(val) WHERE elem.val = v_perm
            ) THEN
              v_arr := v_arr || to_jsonb(v_perm);
            END IF;
          END LOOP;
        END IF;

        UPDATE public.role_policies
        SET permissions_json = v_arr::text,
            updated_at = v_now
        WHERE role = v_role;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

INSERT INTO public.settings (key, value)
VALUES
  ('migration_cctv_verify_v42', 'done'),
  ('migration_rbac_attendance_strict_v42', 'done')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Role Profile Photos, Self-Service Username/Password Security & User Preferences Migration
-- Project: ZayedMart (efeioijgxjyyqplfusub)

-- 1. Extend public.system_users with avatar, preferences & session invalidation versioning
ALTER TABLE public.system_users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_preset TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferences_json TEXT DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS session_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS password_changed_at TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS username_changed_at TEXT DEFAULT '';

-- Normalize any NULLs from legacy rows
UPDATE public.system_users
SET
  avatar_url = COALESCE(avatar_url, ''),
  avatar_preset = COALESCE(avatar_preset, ''),
  preferences_json = COALESCE(NULLIF(preferences_json, ''), '{}'),
  session_version = COALESCE(session_version, 1),
  password_changed_at = COALESCE(password_changed_at, ''),
  username_changed_at = COALESCE(username_changed_at, '')
WHERE avatar_url IS NULL
   OR avatar_preset IS NULL
   OR preferences_json IS NULL
   OR preferences_json = ''
   OR session_version IS NULL
   OR password_changed_at IS NULL
   OR username_changed_at IS NULL;

-- Normalize existing usernames to lowercase safely before adding case-insensitive unique index
UPDATE public.system_users
SET username = LOWER(TRIM(username))
WHERE username <> LOWER(TRIM(username));

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_users_username_lower
  ON public.system_users (LOWER(username));

-- 2. Extend public.employees so custom photos propagate to Attendance, Schedule, QR & Logs
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_preset TEXT DEFAULT '';

-- 3. Extend public.role_policies for Role-Level Default Photos (Each Role has its Photo)
ALTER TABLE public.role_policies
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_preset TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT '';

-- 4. Extend public.walkie_presence so Walkie-Talkie shows live user photos
ALTER TABLE public.walkie_presence
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';

-- 5. Idempotent RBAC Backfill: grant 'profile:edit_self' to all 9 non-kiosk roles
DO $$
DECLARE
  v_now TEXT := to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_role TEXT;
  v_existing TEXT;
  v_arr JSONB;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'manager', 'supervisor', 'cashier', 'cctv',
    'security', 'hall', 'warehouse', 'delivery'
  ]
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
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(v_arr) AS elem(val)
          WHERE elem.val = 'profile:edit_self'
        ) THEN
          v_arr := v_arr || to_jsonb('profile:edit_self'::text);
          UPDATE public.role_policies
          SET permissions_json = v_arr::text,
              updated_at = v_now
          WHERE role = v_role;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

-- 6. Default Settings & Migration Markers
INSERT INTO public.settings (key, value)
VALUES
  ('login_show_role_cards', 'true'),
  ('password_min_length', '4'),
  ('migration_role_profiles_v43', 'done'),
  ('migration_rbac_profile_self_v43', 'done')
ON CONFLICT (key) DO NOTHING;

UPDATE public.settings
SET value = 'done'
WHERE key IN ('migration_role_profiles_v43', 'migration_rbac_profile_self_v43');

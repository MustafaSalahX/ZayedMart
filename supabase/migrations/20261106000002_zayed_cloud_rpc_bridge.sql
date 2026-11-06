-- ZayedMart Cloud RPC SQL Bridge (Zero-Config Serverless & Multi-Device PostgreSQL Sync)
-- Project: ZayedMart (efeioijgxjyyqplfusub)

CREATE OR REPLACE FUNCTION public.zayed_bind_sql_params(
  p_sql text,
  p_params jsonb DEFAULT '[]'::jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_len integer := char_length(COALESCE(p_sql, ''));
  v_i integer := 1;
  v_ch text;
  v_next text;
  v_in_quote boolean := false;
  v_param_idx integer := 0;
  v_elem jsonb;
  v_type text;
  v_out text := '';
BEGIN
  WHILE v_i <= v_len LOOP
    v_ch := substr(p_sql, v_i, 1);
    IF v_ch = '''' THEN
      IF v_in_quote AND v_i < v_len AND substr(p_sql, v_i + 1, 1) = '''' THEN
        v_out := v_out || '''''';
        v_i := v_i + 2;
        CONTINUE;
      END IF;
      v_in_quote := NOT v_in_quote;
      v_out := v_out || v_ch;
    ELSIF v_ch = '?' AND NOT v_in_quote THEN
      v_elem := COALESCE(p_params, '[]'::jsonb) -> v_param_idx;
      v_param_idx := v_param_idx + 1;
      IF v_elem IS NULL OR jsonb_typeof(v_elem) = 'null' THEN
        v_out := v_out || 'NULL';
      ELSE
        v_type := jsonb_typeof(v_elem);
        IF v_type = 'number' THEN
          v_out := v_out || (v_elem #>> '{}');
        ELSIF v_type = 'boolean' THEN
          IF (v_elem::boolean) THEN
            v_out := v_out || '1';
          ELSE
            v_out := v_out || '0';
          END IF;
        ELSE
          v_out := v_out || quote_literal(v_elem #>> '{}');
        END IF;
      END IF;
    ELSE
      v_out := v_out || v_ch;
    END IF;
    v_i := v_i + 1;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.zayed_bind_sql_params(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.zayed_rpc_exec(
  p_key text,
  p_sql text,
  p_params jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_trimmed text;
  v_upper text;
  v_bound_sql text;
  v_rows jsonb := '[]'::jsonb;
  v_changes integer := 0;
BEGIN
  v_hash := encode(sha256(convert_to(COALESCE(p_key, ''), 'UTF8')), 'hex');
  IF v_hash <> 'b6c6b3b1262ec1c60e680fa6c98fefed2df01f5a06fa771694e803e2453e09cc' THEN
    RAISE EXCEPTION 'Unauthorized RPC bridge key';
  END IF;

  v_trimmed := btrim(regexp_replace(COALESCE(p_sql, ''), ';\s*$', ''));
  IF v_trimmed = '' THEN
    RETURN jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'changes', 0);
  END IF;

  v_upper := upper(v_trimmed);
  IF v_upper LIKE 'DROP %'
     OR v_upper LIKE 'ALTER %'
     OR v_upper LIKE 'TRUNCATE %'
     OR v_upper LIKE 'GRANT %'
     OR v_upper LIKE 'REVOKE %'
     OR v_upper LIKE 'COPY %' THEN
    RAISE EXCEPTION 'Forbidden SQL statement in RPC bridge';
  END IF;

  v_bound_sql := public.zayed_bind_sql_params(v_trimmed, COALESCE(p_params, '[]'::jsonb));

  IF v_upper LIKE 'SELECT%' THEN
    EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (' || v_bound_sql || ') t'
      INTO v_rows;
    RETURN jsonb_build_object(
      'ok', true,
      'rows', COALESCE(v_rows, '[]'::jsonb),
      'changes', jsonb_array_length(COALESCE(v_rows, '[]'::jsonb))
    );
  ELSE
    EXECUTE v_bound_sql;
    GET DIAGNOSTICS v_changes = ROW_COUNT;
    RETURN jsonb_build_object(
      'ok', true,
      'rows', '[]'::jsonb,
      'changes', COALESCE(v_changes, 0)
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.zayed_rpc_batch(
  p_key text,
  p_statements jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_item jsonb;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  v_hash := encode(sha256(convert_to(COALESCE(p_key, ''), 'UTF8')), 'hex');
  IF v_hash <> 'b6c6b3b1262ec1c60e680fa6c98fefed2df01f5a06fa771694e803e2453e09cc' THEN
    RAISE EXCEPTION 'Unauthorized RPC bridge key';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_statements, '[]'::jsonb))
  LOOP
    v_res := public.zayed_rpc_exec(
      p_key,
      v_item ->> 'sql',
      COALESCE(v_item -> 'params', '[]'::jsonb)
    );
    v_results := v_results || jsonb_build_array(v_res);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$$;

GRANT EXECUTE ON FUNCTION public.zayed_rpc_exec(text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zayed_rpc_batch(text, jsonb) TO anon, authenticated, service_role;

INSERT INTO public.settings (key, value)
VALUES ('cache_epoch', '2026-11-06-clean-v2')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

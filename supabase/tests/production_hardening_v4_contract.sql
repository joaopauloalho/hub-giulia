-- Hub Giulia 4.0 production hardening contract.
-- Read-only assertions against a rebuilt/local schema or an audited production connection.
DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v_count <> 0 THEN RAISE EXCEPTION 'all public base tables must have RLS: % without RLS', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    AND (
      has_table_privilege('anon', format('public.%I', t.table_name), 'SELECT') OR
      has_table_privilege('anon', format('public.%I', t.table_name), 'INSERT') OR
      has_table_privilege('anon', format('public.%I', t.table_name), 'UPDATE') OR
      has_table_privilege('anon', format('public.%I', t.table_name), 'DELETE')
    );
  IF v_count <> 0 THEN RAISE EXCEPTION 'anon must not have public table CRUD grants: % tables', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    AND (
      has_table_privilege('authenticated', format('public.%I', t.table_name), 'TRUNCATE') OR
      has_table_privilege('authenticated', format('public.%I', t.table_name), 'REFERENCES') OR
      has_table_privilege('authenticated', format('public.%I', t.table_name), 'TRIGGER')
    );
  IF v_count <> 0 THEN RAISE EXCEPTION 'authenticated must not have TRUNCATE/REFERENCES/TRIGGER grants: % tables', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND NOT ('security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[])));
  IF v_count <> 0 THEN RAISE EXCEPTION 'all exposed public views must be security_invoker: % violations', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
    AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
      WHERE cfg LIKE 'search_path=%'
    );
  IF v_count <> 0 THEN RAISE EXCEPTION 'SECURITY DEFINER functions require fixed search_path: % violations', v_count; END IF;

  IF has_function_privilege('anon', 'public.photos_v2_validate_photo_context()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute photos_v2_validate_photo_context';
  END IF;
  IF has_function_privilege('anon', 'public.photos_v2_validate_session_context()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute photos_v2_validate_session_context';
  END IF;

  SELECT count(*) INTO v_count
  FROM storage.buckets
  WHERE id IN ('patient-photos', 'contracts', 'proposals') AND public;
  IF v_count <> 0 THEN RAISE EXCEPTION 'clinical/commercial storage buckets must be private: % public buckets', v_count; END IF;

  WITH fk AS (
    SELECT con.conrelid, con.conkey
    FROM pg_constraint con
    WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
  )
  SELECT count(*) INTO v_count
  FROM fk
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = fk.conrelid AND i.indisvalid AND i.indisready
      AND (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] = fk.conkey
  );
  IF v_count <> 0 THEN RAISE EXCEPTION 'all public foreign keys require a supporting left-prefix index: % missing', v_count; END IF;
END $$;

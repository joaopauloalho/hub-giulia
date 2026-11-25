-- The fallback is 45. Saved preference rows are not rewritten by the migration.
do $$
declare
  v_definition text := pg_get_viewdef('public.relationship_opportunity_sources_v1'::regclass, true);
begin
  if (select column_default::text from information_schema.columns where table_schema = 'public' and table_name = 'relationship_preferences' and column_name = 'reactivation_after_days') not like '%45%' then
    raise exception 'reactivation column default is not 45';
  end if;
  if position(', 45) AS reactivation_after_days' in v_definition) = 0
     and position(',45) reactivation_after_days' in v_definition) = 0 then
    raise exception 'reactivation read-model fallback is not 45';
  end if;
  if to_regclass('public.referrals') is null then raise exception 'referrals table missing'; end if;
  if to_regclass('public.referral_settings') is null then raise exception 'referral settings missing'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.referrals'::regclass) then raise exception 'referrals RLS disabled'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.referral_settings'::regclass) then raise exception 'referral settings RLS disabled'; end if;
  if has_table_privilege('anon', 'public.referrals', 'select') then raise exception 'anon can read referrals'; end if;
  if not has_table_privilege('authenticated', 'public.referrals', 'select') then raise exception 'authenticated cannot read referrals'; end if;
  if has_function_privilege('anon', 'public.list_referrals_v1()', 'execute') then raise exception 'anon can list referrals'; end if;
  if not has_function_privilege('authenticated', 'public.list_referrals_v1()', 'execute') then raise exception 'authenticated cannot list referrals'; end if;
  if has_function_privilege('anon', 'public.get_retention_panel_v1()', 'execute') then raise exception 'anon can read retention'; end if;
  if not has_function_privilege('authenticated', 'public.get_retention_panel_v1()', 'execute') then raise exception 'authenticated cannot read retention'; end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_retention_panel_v1') then
    raise exception 'retention panel must be security invoker';
  end if;
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'list_referrals_v1') then
    raise exception 'referral list must be security invoker';
  end if;
end $$;

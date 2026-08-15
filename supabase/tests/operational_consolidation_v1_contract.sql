-- Hub Giulia 3.9 contract checks. Safe/read-only unless explicitly wrapped in rollback fixtures.
do $$
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='data_quality_issue_suppressions' and c.relrowsecurity) then raise exception 'data quality suppressions must have RLS'; end if;
  if has_table_privilege('anon','public.data_quality_issue_suppressions','select') then raise exception 'anon must not select suppressions'; end if;
  if has_function_privilege('anon','public.list_operational_attention_v1(text,integer,integer)','execute') then raise exception 'anon must not execute operational attention'; end if;
  if has_function_privilege('anon','public.get_data_quality_summary_v1()','execute') then raise exception 'anon must not execute data quality summary'; end if;
  if has_function_privilege('anon','public.dismiss_data_quality_issue_v1(text,text)','execute') then raise exception 'anon must not suppress data quality issues'; end if;
  if has_function_privilege('anon','public.list_operational_reactivation_v1()','execute') then raise exception 'anon must not execute relationship bridge'; end if;
  if not has_function_privilege('authenticated','public.communication_whatsapp_digits_v1(text)','execute') then raise exception 'authenticated must reuse canonical phone normalizer'; end if;
  if has_function_privilege('anon','public.communication_whatsapp_digits_v1(text)','execute') then raise exception 'anon must not execute phone normalizer'; end if;
  if has_table_privilege('authenticated','public.relationship_opportunity_sources_v1','select') then raise exception 'internal Relationship source view must remain unexposed'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_operational_reactivation_v1' and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=public, pg_temp%') then raise exception 'Relationship bridge must be SECURITY DEFINER with fixed search_path'; end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='operational_attention_v1' and 'security_invoker=true'=any(c.reloptions)) then raise exception 'operational attention must be security_invoker'; end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='data_quality_issues_v1' and 'security_invoker=true'=any(c.reloptions)) then raise exception 'data quality issues must be security_invoker'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_patient_next_action_v1' and pg_get_functiondef(p.oid) like '%not exists%public.procedures%') then raise exception 'next action must ignore appointments that already have a procedure'; end if;
end $$;

-- Counts and list must share the same canonical read model.
do $$
declare c jsonb; n bigint;
begin
  if auth.uid() is null then return; end if;
  c := public.get_operational_attention_counts_v1();
  select count(*) into n from public.list_operational_attention_v1(null,100,0);
  if n <> least((c->>'total')::bigint,100) then raise exception 'attention count/list mismatch: % vs %', n, c->>'total'; end if;
end $$;

-- Deterministic pair identity and strong matching: name is deliberately absent as a duplicate join key.
do $$
declare definition text;
begin
  select pg_get_viewdef('public.data_quality_possible_duplicates_v1'::regclass,true) into definition;
  if definition not like '%cpf_norm%' or definition not like '%phone_norm%' or definition not like '%email_norm%' then raise exception 'strong duplicate keys missing'; end if;
  if definition like '%p1.name = p2.name%' then raise exception 'name-only duplicate matching is forbidden'; end if;
  if definition not like '%p1.id::text < p2.id::text%' then raise exception 'duplicate pair ordering must be deterministic'; end if;
end $$;

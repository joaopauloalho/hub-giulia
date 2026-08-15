-- Hub Giulia 3.8 relationship contract. Read-only assertions; run after migrations.
do $$
begin
  if to_regclass('public.relationship_preferences') is null then raise exception 'relationship_preferences missing'; end if;
  if to_regclass('public.relationship_person_context_v1') is null then raise exception 'relationship_person_context_v1 missing'; end if;
  if to_regclass('public.relationship_opportunity_sources_v1') is null then raise exception 'relationship_opportunity_sources_v1 missing'; end if;
  if to_regprocedure('public.list_relationship_opportunities_v1(text,text,boolean,integer,integer)') is null then raise exception 'relationship list RPC missing'; end if;
  if to_regprocedure('public.get_relationship_person_v1(text,uuid)') is null then raise exception 'relationship detail RPC missing'; end if;
  if to_regprocedure('public.get_relationship_opportunity_counts_v1()') is null then raise exception 'relationship counts RPC missing'; end if;
  if to_regprocedure('public.record_relationship_manual_contact_v1(uuid,text,text,uuid)') is null then raise exception 'relationship manual contact RPC missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.relationship_preferences'::regclass) then raise exception 'relationship_preferences RLS disabled'; end if;
  if has_table_privilege('anon','public.relationship_preferences','select') then raise exception 'anon can select relationship_preferences'; end if;
  if has_function_privilege('anon','public.get_relationship_opportunity_counts_v1()','execute') then raise exception 'anon can execute relationship RPC'; end if;
  if has_table_privilege('authenticated','public.relationship_opportunity_sources_v1','select') then raise exception 'internal source view exposed'; end if;
end $$;

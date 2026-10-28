-- Contract: opportunity sources remain internal and CRM/pending receivables are wired.
do $$
declare v_definition text := pg_get_viewdef('public.relationship_opportunity_sources_v1'::regclass,true);
begin
 if position('crm_followup_sources' in v_definition)=0 then raise exception 'CRM follow-up source missing'; end if;
 if position('crm_recontact_sources' in v_definition)=0 then raise exception 'CRM recontact source missing'; end if;
 if position('pending_payment_rollup' in v_definition)=0 then raise exception 'receivables source missing'; end if;
 if has_table_privilege('anon','public.relationship_opportunity_sources_v1','select') then raise exception 'anon can read source view'; end if;
 if has_table_privilege('authenticated','public.relationship_opportunity_sources_v1','select') then raise exception 'client can read internal source view'; end if;
 if has_function_privilege('anon','public.get_relationship_opportunity_counts_v2()','execute') then raise exception 'anon can execute relationship counts'; end if;
 if not has_function_privilege('authenticated','public.get_relationship_opportunity_counts_v2()','execute') then raise exception 'authenticated cannot execute relationship counts'; end if;
 if (select column_default::text from information_schema.columns where table_schema='public' and table_name='relationship_preferences' and column_name='reactivation_after_days') not like '%60%' then raise exception 'reactivation default not 60'; end if;
end $$;

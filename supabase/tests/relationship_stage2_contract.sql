do $$
declare v_definition text:=pg_get_viewdef('public.relationship_opportunity_sources_v1'::regclass,true);
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='services' and column_name='maintenance_days')
  then raise exception 'missing independent maintenance window'; end if;
 if position('voucher_conversion_sources' in v_definition)=0 then raise exception 'missing voucher source'; end if;
 if position('maintenance_sources' in v_definition)=0 then raise exception 'missing maintenance source'; end if;
 if not has_function_privilege('authenticated','public.relationship_service_ticket_v1(uuid,uuid,uuid)','execute')
  then raise exception 'missing ticket access'; end if;
 if has_function_privilege('anon','public.relationship_service_ticket_v1(uuid,uuid,uuid)','execute')
  then raise exception 'anonymous ticket access'; end if;
 if has_table_privilege('authenticated','public.relationship_opportunity_sources_v1','select') then raise exception 'view exposed'; end if;
end $$;

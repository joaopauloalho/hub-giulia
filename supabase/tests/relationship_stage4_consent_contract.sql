do $$
declare v_ctx text:=pg_get_viewdef('public.relationship_person_context_v1'::regclass,true);
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='whatsapp_opt_in') then raise exception 'missing opt-in'; end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patients' and column_name='whatsapp_opt_out_at') then raise exception 'missing opt-out'; end if;
 if position('whatsapp_opt_out_at' in v_ctx)=0 then raise exception 'opt-out is not filtering relationship people'; end if;
 if has_function_privilege('anon','public.set_patient_whatsapp_consent_v1(uuid,boolean,text)','execute') then raise exception 'anon can change consent'; end if;
 if has_function_privilege('anon','public.relationship_today_opt_in_required_v1(uuid)','execute') then raise exception 'anon can query consent'; end if;
 if position('WHATSAPP_CONSENT_REQUIRED' in pg_get_functiondef('public.record_relationship_today_outcome_v1(uuid,text,text,uuid)'::regprocedure))=0 then raise exception 'outreach RPC does not enforce consent'; end if;
end $$;

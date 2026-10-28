do $$
begin
 if has_function_privilege('anon','public.set_crm_won_with_value_v1(uuid,numeric)','execute') then raise exception 'anon can set deal values'; end if;
 if not has_function_privilege('authenticated','public.set_crm_won_with_value_v1(uuid,numeric)','execute') then raise exception 'authenticated cannot set won value'; end if;
 if position('auth.uid()' in pg_get_functiondef('public.set_crm_won_with_value_v1(uuid,numeric)'::regprocedure))=0
 then raise exception 'won RPC missing owner scope'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.deals'::regclass and tgname='trg_crm_won_requires_value_v1' and not tgisinternal)
 then raise exception 'won integrity trigger missing'; end if;
end $$;

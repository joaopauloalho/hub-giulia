-- Daily playbook must be authenticated, owner-scoped and avoid exposing health data.
do $$
declare v_def text:=pg_get_functiondef('public.relationship_today_v1(integer)'::regprocedure);
begin
 if to_regclass('public.relationship_today_actions') is null then raise exception 'missing day scoreboard'; end if;
 if not (select relrowsecurity from pg_class where oid='public.relationship_today_actions'::regclass) then raise exception 'missing action RLS'; end if;
 if has_table_privilege('anon','public.relationship_today_actions','select') then raise exception 'anon can view scoreboard'; end if;
 if has_function_privilege('anon','public.relationship_today_v1(integer)','execute') then raise exception 'anon can execute daily playbook'; end if;
 if not has_function_privilege('authenticated','public.relationship_today_v1(integer)','execute') then raise exception 'authenticated RPC missing'; end if;
 if position('auth.uid()' in v_def)=0 then raise exception 'no auth ownership check'; end if;
 if has_function_privilege('anon','public.record_relationship_today_outcome_v1(uuid,text,text,uuid)','execute') then raise exception 'anon can record contact'; end if;
end $$;

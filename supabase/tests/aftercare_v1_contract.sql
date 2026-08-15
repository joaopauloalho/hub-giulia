-- Hub Giulia 3.7 aftercare contract checks. Run against a migrated database.
do $$
declare v integer;
begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='service_aftercare_protocols' and c.relrowsecurity) then raise exception 'aftercare protocols RLS missing'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='procedure_followup_plans' and c.relrowsecurity) then raise exception 'followup plans RLS missing'; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='procedure_followup_tasks' and c.relrowsecurity) then raise exception 'followup tasks RLS missing'; end if;

  select count(*) into v from information_schema.role_table_grants where table_schema='public' and table_name in ('service_aftercare_protocols','service_aftercare_protocol_steps','procedure_followup_plans','procedure_followup_tasks','aftercare_communication_attention_v1') and grantee='anon';
  if v<>0 then raise exception 'anon aftercare grants: %',v; end if;

  if has_function_privilege('authenticated','public.create_procedure_followup_plan_internal_v1(uuid,uuid)','EXECUTE') then raise exception 'internal generator exposed'; end if;
  if has_function_privilege('anon','public.complete_procedure_followup_task_v1(uuid,text)','EXECUTE') then raise exception 'anon can complete task'; end if;

  select count(*) into v from (select user_id,procedure_id_snapshot,count(*) from public.procedure_followup_plans group by 1,2 having count(*)>1) d;
  if v<>0 then raise exception 'duplicate plans: %',v; end if;
  select count(*) into v from (select user_id,followup_plan_id,task_key,count(*) from public.procedure_followup_tasks group by 1,2,3 having count(*)>1) d;
  if v<>0 then raise exception 'duplicate tasks: %',v; end if;

  select count(*) into v from public.service_aftercare_protocols p left join public.services s on s.id=p.service_id where s.id is null or s.user_id<>p.user_id;
  if v<>0 then raise exception 'cross tenant protocol: %',v; end if;
  select count(*) into v from public.procedure_followup_plans fp left join public.procedures p on p.id=fp.procedure_id where fp.procedure_id is not null and (p.id is null or p.user_id<>fp.user_id);
  if v<>0 then raise exception 'cross tenant plan: %',v; end if;
  select count(*) into v from public.procedure_followup_tasks t left join public.procedure_followup_plans p on p.id=t.followup_plan_id where p.id is null or p.user_id<>t.user_id;
  if v<>0 then raise exception 'cross tenant task: %',v; end if;
end $$;

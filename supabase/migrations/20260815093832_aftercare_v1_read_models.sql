create or replace function public.get_procedure_followup_summary_v1(p_procedure_id uuid)
returns jsonb
language sql
set search_path='public','pg_temp'
as $$
  with plan as (
    select fp.* from public.procedure_followup_plans fp where fp.user_id=auth.uid() and fp.procedure_id_snapshot=p_procedure_id limit 1
  ), comm as (
    select exists(select 1 from public.communication_messages m join plan p on true where m.user_id=auth.uid() and m.source_type='procedure_followup_plan' and m.source_id=p.id and m.context='aftercare_instructions') as whatsapp_sent
  ), returns as materialized (
    select r.* from public.list_procedure_returns_v2() r where r.procedure_id=p_procedure_id
  )
  select jsonb_build_object(
    'id',p.id,'procedure_id',p.procedure_id_snapshot,'patient_id',p.patient_id,'patient_name',p.patient_name_snapshot,'performed_on',p.performed_on,'status',p.status,
    'protocol_snapshot',p.protocol_snapshot,'instructions_snapshot',p.instructions_snapshot,'instructions_snapshot_hash',p.instructions_snapshot_hash,'photo_followup',p.photo_followup_snapshot,
    'orientation_status',case when p.instructions_snapshot is null then 'not_configured' when c.whatsapp_sent then 'sent_whatsapp' when p.manual_delivery_at is not null then 'delivered_manual' else 'pending' end,
    'manual_delivery',case when p.manual_delivery_at is null then null else jsonb_build_object('at',p.manual_delivery_at,'method',p.manual_delivery_method,'note',p.manual_delivery_note) end,
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'task_type',t.task_type,'due_on',t.due_on,'original_due_on',t.original_due_on,'label',t.label,'status',t.status,'completed_at',t.completed_at,'note',t.note,'cancelled_at',t.cancelled_at,'cancel_reason',t.cancel_reason,'requires_professional_review',t.requires_professional_review,'rescheduled_at',t.rescheduled_at,'source_steps_snapshot',t.source_steps_snapshot) order by t.due_on,t.created_at,t.id) from public.procedure_followup_tasks t where t.user_id=auth.uid() and t.followup_plan_id=p.id),'[]'::jsonb),
    'next_task',(select jsonb_build_object('id',t.id,'due_on',t.due_on,'label',t.label,'requires_professional_review',t.requires_professional_review) from public.procedure_followup_tasks t where t.user_id=auth.uid() and t.followup_plan_id=p.id and t.status='pending' order by t.requires_professional_review desc,t.due_on,t.created_at limit 1),
    'returns',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'service_name',r.service_name,'return_type',r.return_type,'window_start',r.window_start,'window_end',r.window_end,'appointment_id',r.appointment_id,'appointment_status',r.appointment_status,'appointment_scheduled_at',r.appointment_scheduled_at,'completed_at',r.completed_at,'dismissed_at',r.dismissed_at) order by r.window_start,r.id) from returns r),'[]'::jsonb)
  )
  from plan p cross join comm c;
$$;

create or replace function public.list_patient_followup_plans_v1(p_patient_id uuid,p_limit integer default 20)
returns table(plan_id uuid,procedure_id uuid,performed_on date,status text,instructions_snapshot text,orientation_status text,photo_followup boolean,tasks jsonb,returns jsonb,created_at timestamptz)
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_user) then raise exception 'AFTERCARE_PATIENT_NOT_FOUND'; end if;
  return query
  with return_rows as materialized (select r.* from public.list_procedure_returns_v2() r where r.patient_id=p_patient_id),
  plans as (select fp.* from public.procedure_followup_plans fp where fp.user_id=v_user and fp.patient_id=p_patient_id order by fp.performed_on desc,fp.created_at desc limit v_limit)
  select p.id,p.procedure_id_snapshot,p.performed_on,p.status,p.instructions_snapshot,
    case when p.instructions_snapshot is null then 'not_configured'
      when exists(select 1 from public.communication_messages m where m.user_id=v_user and m.source_type='procedure_followup_plan' and m.source_id=p.id and m.context='aftercare_instructions') then 'sent_whatsapp'
      when p.manual_delivery_at is not null then 'delivered_manual' else 'pending' end,
    p.photo_followup_snapshot,
    coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'due_on',t.due_on,'original_due_on',t.original_due_on,'label',t.label,'status',t.status,'completed_at',t.completed_at,'note',t.note,'cancelled_at',t.cancelled_at,'requires_professional_review',t.requires_professional_review,'rescheduled_at',t.rescheduled_at) order by t.due_on,t.created_at,t.id) from public.procedure_followup_tasks t where t.user_id=v_user and t.followup_plan_id=p.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'service_name',r.service_name,'return_type',r.return_type,'window_start',r.window_start,'window_end',r.window_end,'appointment_id',r.appointment_id,'appointment_status',r.appointment_status,'appointment_scheduled_at',r.appointment_scheduled_at,'completed_at',r.completed_at,'dismissed_at',r.dismissed_at) order by r.window_start,r.id) from return_rows r where r.procedure_id=p.procedure_id_snapshot),'[]'::jsonb),
    p.created_at
  from plans p order by p.performed_on desc,p.created_at desc;
end; $$;

create or replace function public.get_aftercare_dashboard_attention_v1(p_today date)
returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  if p_today is null then raise exception 'AFTERCARE_TODAY_REQUIRED'; end if;
  return (
    select jsonb_build_object(
      'total',count(*),
      'overdue',count(*) filter(where a.priority='overdue'),
      'today',count(*) filter(where a.priority='today'),
      'orientation_pending',count(*) filter(where a.source_type='procedure_followup_plan'),
      'checkins',count(*) filter(where a.source_type='procedure_followup_task'),
      'review',count(*) filter(where coalesce((a.context->>'requires_professional_review')::boolean,false))
    )
    from public.aftercare_communication_attention_v1 a
    where not a.is_snoozed and not a.is_suppressed_after_contact
  );
end; $$;

create or replace function public.list_patient_timeline_v5(p_patient_id uuid,p_limit integer default 20,p_cursor_at timestamptz default null,p_cursor_key text default null)
returns table(event_key text,event_type text,occurred_at timestamptz,title text,subtitle text,source_id uuid,metadata jsonb)
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_uid uuid:=auth.uid(); v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  if v_uid is null then raise exception 'PATIENT_360_SESSION_REQUIRED'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_uid) then raise exception 'PATIENT_360_NOT_FOUND'; end if;
  return query
  with existing_events as (
    select e.* from public.list_patient_timeline_v4(p_patient_id,50,p_cursor_at,p_cursor_key) e
  ), aftercare_events as (
    select 'aftercare-plan:'||fp.id::text as event_key,'aftercare'::text as event_type,fp.created_at as occurred_at,'Plano pós-atendimento iniciado'::text as title,
      (case when jsonb_array_length(fp.protocol_snapshot)=1 then '1 protocolo aplicado' else jsonb_array_length(fp.protocol_snapshot)::text||' protocolos aplicados' end)::text as subtitle,
      fp.id as source_id,jsonb_build_object('procedure_id',fp.procedure_id_snapshot,'performed_on',fp.performed_on,'photo_followup',fp.photo_followup_snapshot,'status',fp.status) as metadata
    from public.procedure_followup_plans fp where fp.user_id=v_uid and fp.patient_id=p_patient_id
  ), events as (select * from existing_events union all select * from aftercare_events)
  select e.event_key,e.event_type,e.occurred_at,e.title,e.subtitle,e.source_id,e.metadata from events e
  where e.occurred_at is not null and (p_cursor_at is null or e.occurred_at<p_cursor_at or (e.occurred_at=p_cursor_at and e.event_key<coalesce(p_cursor_key,'')))
  order by e.occurred_at desc,e.event_key desc limit v_limit;
end; $$;

revoke all on function public.get_procedure_followup_summary_v1(uuid),public.list_patient_followup_plans_v1(uuid,integer),public.get_aftercare_dashboard_attention_v1(date),public.list_patient_timeline_v5(uuid,integer,timestamptz,text) from public,anon;
grant execute on function public.get_procedure_followup_summary_v1(uuid),public.list_patient_followup_plans_v1(uuid,integer),public.get_aftercare_dashboard_attention_v1(date),public.list_patient_timeline_v5(uuid,integer,timestamptz,text) to authenticated;

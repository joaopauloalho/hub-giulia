alter table public.procedure_followup_tasks add column original_due_on date;
alter table public.procedure_followup_tasks add column rescheduled_at timestamptz;
alter table public.procedure_followup_tasks add column rescheduled_by uuid references auth.users(id);
alter table public.procedure_followup_tasks add column reschedule_reason text;
alter table public.procedure_followup_tasks add constraint procedure_followup_tasks_reschedule_reason_check check (reschedule_reason is null or length(reschedule_reason)<=500);
create index procedure_followup_tasks_rescheduled_by_idx on public.procedure_followup_tasks(rescheduled_by) where rescheduled_by is not null;
grant update(original_due_on,rescheduled_at,rescheduled_by,reschedule_reason) on public.procedure_followup_tasks to authenticated;

create or replace function public.create_procedure_followup_plan_internal_v1(p_user_id uuid,p_procedure_id uuid)
returns uuid
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_plan_id uuid;
  v_performed_on date;
  v_patient_id uuid;
  v_patient_name text;
  v_snapshot jsonb;
  v_instructions text;
  v_photo boolean;
begin
  if p_user_id is null or p_procedure_id is null then return null; end if;

  select (p.performed_at at time zone 'America/Sao_Paulo')::date,p.patient_id,pt.name
    into v_performed_on,v_patient_id,v_patient_name
  from public.procedures p
  join public.patients pt on pt.id=p.patient_id and pt.user_id=p.user_id
  where p.id=p_procedure_id and p.user_id=p_user_id;
  if not found then return null; end if;

  if exists(select 1 from public.procedure_followup_plans fp where fp.user_id=p_user_id and fp.procedure_id_snapshot=p_procedure_id) then
    select fp.id into v_plan_id from public.procedure_followup_plans fp where fp.user_id=p_user_id and fp.procedure_id_snapshot=p_procedure_id;
    return v_plan_id;
  end if;

  with contributing as (
    select pi.id as procedure_item_id,pi.service_id,pi.name as service_name_snapshot,pi.created_at,
      pr.id as protocol_id,pr.name as protocol_name,pr.version,pr.instructions,pr.photo_followup,
      coalesce((select jsonb_agg(jsonb_build_object('step_id',st.id,'step_type',st.step_type,'offset_days',st.offset_days,'label',st.label,'sort_order',st.sort_order) order by st.sort_order,st.offset_days,st.id)
        from public.service_aftercare_protocol_steps st where st.protocol_id=pr.id and st.user_id=p_user_id),'[]'::jsonb) as steps
    from public.procedure_items pi
    join public.service_aftercare_protocols pr on pr.service_id=pi.service_id and pr.user_id=pi.user_id and pr.enabled
    where pi.procedure_id=p_procedure_id and pi.user_id=p_user_id
      and (nullif(btrim(coalesce(pr.instructions,'')),'') is not null or pr.photo_followup or exists(select 1 from public.service_aftercare_protocol_steps st where st.protocol_id=pr.id and st.user_id=p_user_id))
  )
  select jsonb_agg(jsonb_build_object(
      'procedure_item_id',procedure_item_id,'service_id',service_id,'service_name_snapshot',service_name_snapshot,
      'protocol_id',protocol_id,'protocol_name',protocol_name,'protocol_version',version,
      'instructions',instructions,'photo_followup',photo_followup,'steps',steps
    ) order by created_at,procedure_item_id),
    bool_or(photo_followup)
  into v_snapshot,v_photo
  from contributing;

  if v_snapshot is null or jsonb_array_length(v_snapshot)=0 then return null; end if;

  with instruction_rows as (
    select btrim(pr.instructions) as body,min(pi.created_at) as first_at,min(pi.id) as first_id
    from public.procedure_items pi
    join public.service_aftercare_protocols pr on pr.service_id=pi.service_id and pr.user_id=pi.user_id and pr.enabled
    where pi.procedure_id=p_procedure_id and pi.user_id=p_user_id and nullif(btrim(coalesce(pr.instructions,'')),'') is not null
    group by btrim(pr.instructions)
  )
  select string_agg(body,E'\n\n' order by first_at,first_id) into v_instructions from instruction_rows;

  insert into public.procedure_followup_plans(
    user_id,procedure_id,procedure_id_snapshot,patient_id,patient_name_snapshot,performed_on,status,
    protocol_snapshot,instructions_snapshot,instructions_snapshot_hash,photo_followup_snapshot
  ) values(
    p_user_id,p_procedure_id,p_procedure_id,v_patient_id,v_patient_name,v_performed_on,'active',
    v_snapshot,v_instructions,case when v_instructions is null then null else md5(v_instructions) end,coalesce(v_photo,false)
  )
  on conflict (user_id,procedure_id_snapshot) do nothing
  returning id into v_plan_id;

  if v_plan_id is null then
    select id into v_plan_id from public.procedure_followup_plans where user_id=p_user_id and procedure_id_snapshot=p_procedure_id;
    return v_plan_id;
  end if;

  insert into public.procedure_followup_tasks(
    user_id,followup_plan_id,procedure_id,procedure_id_snapshot,patient_id,task_key,task_type,due_on,original_due_on,label,source_steps_snapshot,status
  )
  select p_user_id,v_plan_id,p_procedure_id,p_procedure_id,v_patient_id,
    md5('checkin:'||(v_performed_on+st.offset_days)::text),'checkin',v_performed_on+st.offset_days,v_performed_on+st.offset_days,
    case when count(distinct nullif(btrim(coalesce(st.label,'')),''))=1 then max(nullif(btrim(coalesce(st.label,'')),'')) else 'Check-in pós-atendimento' end,
    jsonb_agg(jsonb_build_object(
      'service_id',pi.service_id,'service_name_snapshot',pi.name,'protocol_id',pr.id,'protocol_version',pr.version,
      'step_id',st.id,'offset_days',st.offset_days,'label',st.label
    ) order by pi.created_at,pi.id,st.sort_order,st.id),
    'pending'
  from public.procedure_items pi
  join public.service_aftercare_protocols pr on pr.service_id=pi.service_id and pr.user_id=pi.user_id and pr.enabled
  join public.service_aftercare_protocol_steps st on st.protocol_id=pr.id and st.user_id=pr.user_id and st.step_type='checkin'
  where pi.procedure_id=p_procedure_id and pi.user_id=p_user_id
  group by st.offset_days
  on conflict (user_id,followup_plan_id,task_key) do nothing;

  return v_plan_id;
end; $$;

create or replace function public.aftercare_generate_from_procedure_items_v1()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_row record;
begin
  for v_row in select distinct user_id,procedure_id from aftercare_new_items loop
    perform public.create_procedure_followup_plan_internal_v1(v_row.user_id,v_row.procedure_id);
  end loop;
  return null;
end; $$;

create trigger procedure_items_aftercare_generate
  after insert on public.procedure_items
  referencing new table as aftercare_new_items
  for each statement execute function public.aftercare_generate_from_procedure_items_v1();

create or replace function public.aftercare_cancel_on_procedure_delete_v1()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_actor uuid:=auth.uid();
begin
  update public.procedure_followup_tasks t
    set status='cancelled',cancelled_at=coalesce(t.cancelled_at,now()),cancelled_by=coalesce(t.cancelled_by,v_actor),cancel_reason=coalesce(t.cancel_reason,'Atendimento removido')
  where t.user_id=old.user_id and t.procedure_id_snapshot=old.id and t.status='pending';
  update public.procedure_followup_plans p
    set status='cancelled',cancelled_at=coalesce(p.cancelled_at,now()),cancelled_by=coalesce(p.cancelled_by,v_actor),cancel_reason=coalesce(p.cancel_reason,'Atendimento removido')
  where p.user_id=old.user_id and p.procedure_id_snapshot=old.id and p.status='active';
  return old;
end; $$;

create trigger procedures_aftercare_cancel before delete on public.procedures for each row execute function public.aftercare_cancel_on_procedure_delete_v1();

create or replace function public.complete_procedure_followup_task_v1(p_task_id uuid,p_note text default null)
returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid(); v_row public.procedure_followup_tasks%rowtype;
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  select * into v_row from public.procedure_followup_tasks where id=p_task_id and user_id=v_user for update;
  if not found then raise exception 'AFTERCARE_TASK_NOT_FOUND'; end if;
  if v_row.status='completed' then return jsonb_build_object('id',v_row.id,'status',v_row.status,'completed_at',v_row.completed_at,'was_changed',false); end if;
  if v_row.status='cancelled' then raise exception 'AFTERCARE_TASK_CANCELLED'; end if;
  update public.procedure_followup_tasks set status='completed',completed_at=now(),completed_by=v_user,note=coalesce(nullif(btrim(coalesce(p_note,'')),''),note),requires_professional_review=false,review_marked_at=null,review_marked_by=null where id=p_task_id and user_id=v_user returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'completed_at',v_row.completed_at,'was_changed',true);
end; $$;

create or replace function public.cancel_procedure_followup_task_v1(p_task_id uuid,p_reason text default null)
returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid(); v_row public.procedure_followup_tasks%rowtype;
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  select * into v_row from public.procedure_followup_tasks where id=p_task_id and user_id=v_user for update;
  if not found then raise exception 'AFTERCARE_TASK_NOT_FOUND'; end if;
  if v_row.status='cancelled' then return jsonb_build_object('id',v_row.id,'status',v_row.status,'cancelled_at',v_row.cancelled_at,'was_changed',false); end if;
  if v_row.status='completed' then raise exception 'AFTERCARE_TASK_COMPLETED'; end if;
  update public.procedure_followup_tasks set status='cancelled',cancelled_at=now(),cancelled_by=v_user,cancel_reason=nullif(btrim(coalesce(p_reason,'')),'') where id=p_task_id and user_id=v_user returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'cancelled_at',v_row.cancelled_at,'was_changed',true);
end; $$;

create or replace function public.reschedule_procedure_followup_task_v1(p_task_id uuid,p_due_on date,p_reason text default null)
returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid(); v_row public.procedure_followup_tasks%rowtype;
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  if p_due_on is null then raise exception 'AFTERCARE_DUE_DATE_REQUIRED'; end if;
  select * into v_row from public.procedure_followup_tasks where id=p_task_id and user_id=v_user for update;
  if not found then raise exception 'AFTERCARE_TASK_NOT_FOUND'; end if;
  if v_row.status<>'pending' then raise exception 'AFTERCARE_TASK_NOT_PENDING'; end if;
  if v_row.due_on=p_due_on then return jsonb_build_object('id',v_row.id,'due_on',v_row.due_on,'was_changed',false); end if;
  update public.procedure_followup_tasks set original_due_on=coalesce(original_due_on,due_on),due_on=p_due_on,rescheduled_at=now(),rescheduled_by=v_user,reschedule_reason=nullif(btrim(coalesce(p_reason,'')),'') where id=p_task_id and user_id=v_user returning * into v_row;
  return jsonb_build_object('id',v_row.id,'due_on',v_row.due_on,'original_due_on',v_row.original_due_on,'rescheduled_at',v_row.rescheduled_at,'was_changed',true);
end; $$;

create or replace function public.set_procedure_followup_task_review_v1(p_task_id uuid,p_requires_review boolean,p_note text default null)
returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid(); v_row public.procedure_followup_tasks%rowtype;
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  select * into v_row from public.procedure_followup_tasks where id=p_task_id and user_id=v_user for update;
  if not found then raise exception 'AFTERCARE_TASK_NOT_FOUND'; end if;
  if v_row.status<>'pending' then raise exception 'AFTERCARE_TASK_NOT_PENDING'; end if;
  update public.procedure_followup_tasks set requires_professional_review=coalesce(p_requires_review,false),review_marked_at=case when coalesce(p_requires_review,false) then now() else null end,review_marked_by=case when coalesce(p_requires_review,false) then v_user else null end,note=coalesce(nullif(btrim(coalesce(p_note,'')),''),note) where id=p_task_id and user_id=v_user returning * into v_row;
  return jsonb_build_object('id',v_row.id,'requires_professional_review',v_row.requires_professional_review,'review_marked_at',v_row.review_marked_at);
end; $$;

create or replace function public.record_followup_manual_delivery_v1(p_plan_id uuid,p_method text,p_note text default null)
returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_user uuid:=auth.uid(); v_row public.procedure_followup_plans%rowtype;
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  if p_method not in ('verbal','printed','other') then raise exception 'AFTERCARE_DELIVERY_METHOD_INVALID'; end if;
  select * into v_row from public.procedure_followup_plans where id=p_plan_id and user_id=v_user for update;
  if not found then raise exception 'AFTERCARE_PLAN_NOT_FOUND'; end if;
  if v_row.status<>'active' then raise exception 'AFTERCARE_PLAN_NOT_ACTIVE'; end if;
  if v_row.instructions_snapshot is null then raise exception 'AFTERCARE_NO_INSTRUCTIONS'; end if;
  if v_row.manual_delivery_at is not null then return jsonb_build_object('id',v_row.id,'manual_delivery_at',v_row.manual_delivery_at,'manual_delivery_method',v_row.manual_delivery_method,'was_changed',false); end if;
  update public.procedure_followup_plans set manual_delivery_at=now(),manual_delivery_method=p_method,manual_delivery_by=v_user,manual_delivery_note=nullif(btrim(coalesce(p_note,'')),'') where id=p_plan_id and user_id=v_user returning * into v_row;
  return jsonb_build_object('id',v_row.id,'manual_delivery_at',v_row.manual_delivery_at,'manual_delivery_method',v_row.manual_delivery_method,'was_changed',true,'instructions_snapshot_hash',v_row.instructions_snapshot_hash);
end; $$;

revoke all on function public.create_procedure_followup_plan_internal_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aftercare_generate_from_procedure_items_v1() from public,anon,authenticated;
revoke all on function public.aftercare_cancel_on_procedure_delete_v1() from public,anon,authenticated;
revoke all on function public.complete_procedure_followup_task_v1(uuid,text) from public,anon;
revoke all on function public.cancel_procedure_followup_task_v1(uuid,text) from public,anon;
revoke all on function public.reschedule_procedure_followup_task_v1(uuid,date,text) from public,anon;
revoke all on function public.set_procedure_followup_task_review_v1(uuid,boolean,text) from public,anon;
revoke all on function public.record_followup_manual_delivery_v1(uuid,text,text) from public,anon;
grant execute on function public.complete_procedure_followup_task_v1(uuid,text), public.cancel_procedure_followup_task_v1(uuid,text), public.reschedule_procedure_followup_task_v1(uuid,date,text), public.set_procedure_followup_task_review_v1(uuid,boolean,text), public.record_followup_manual_delivery_v1(uuid,text,text) to authenticated;

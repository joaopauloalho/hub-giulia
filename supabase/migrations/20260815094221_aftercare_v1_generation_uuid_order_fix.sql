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
    select btrim(pr.instructions) as body,min(pi.created_at) as first_at,min(pi.id::text) as first_id
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

revoke all on function public.create_procedure_followup_plan_internal_v1(uuid,uuid) from public,anon,authenticated;

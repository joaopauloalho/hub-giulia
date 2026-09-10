-- Retornos clínicos não devem herdar o custo-base do serviço original.
-- O retorno mantém apenas custos incrementais: materiais/produtos realmente usados + tempo clínico.

create or replace function public.create_clinical_return_v1(
  p_idempotency_key uuid,
  p_parent_procedure_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_injectable_maps jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text
) returns public.procedures
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_parent public.procedures;
  v_result public.procedures;
  v_service_cost numeric(14,2) := 0;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED'; end if;
  select * into v_parent from public.procedures where id=p_parent_procedure_id and user_id=v_user_id;
  if not found then raise exception using errcode='P0001', message='RETURN_PARENT_FORBIDDEN'; end if;
  if v_parent.patient_id <> p_patient_id then raise exception using errcode='P0001', message='RETURN_PATIENT_MISMATCH'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception using errcode='22023', message='RETURN_ITEM_REQUIRED'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item where coalesce((item->>'final_price')::numeric,0)<>0) then
    raise exception using errcode='22023', message='RETURN_MUST_BE_ZERO_VALUE';
  end if;

  select * into v_result from public.create_procedure_v5(
    p_idempotency_key,p_patient_id,p_appointment_id,p_performed_at,p_items,'[]'::jsonb,
    coalesce(p_injectable_maps,'[]'::jsonb),'[]'::jsonb,coalesce(p_materials,'[]'::jsonb),p_clinical_minutes,p_notes
  );

  select coalesce(sum(coalesce(pi.cost_snapshot,0) * coalesce(pi.qty,1)),0)
    into v_service_cost
  from public.procedure_items pi
  where pi.procedure_id=v_result.id and pi.user_id=v_user_id;

  update public.procedure_items
  set cost_snapshot=0, cost_snapshot_known=true
  where procedure_id=v_result.id and user_id=v_user_id;

  update public.procedures
  set attendance_type='return', parent_procedure_id=p_parent_procedure_id,
      total_value=0, net_value=0, card_fee_pct=null, card_fee_value=null,
      total_cost=greatest(0, round(coalesce(total_cost,0)-v_service_cost,2))
  where id=v_result.id and user_id=v_user_id
  returning * into v_result;

  update public.procedure_returns pr
  set completed_at=coalesce(pr.completed_at,now()),
      completed_by_procedure_id=coalesce(pr.completed_by_procedure_id,v_result.id),
      updated_at=now()
  where pr.user_id=v_user_id and pr.procedure_id=p_parent_procedure_id and pr.patient_id=p_patient_id
    and pr.dismissed_at is null and pr.completed_at is null
    and exists (
      select 1 from public.procedure_items pi
      where pi.procedure_id=v_result.id and pi.user_id=v_user_id and pi.service_id=pr.service_id
    );

  return v_result;
end;
$function$;

create or replace function public.create_clinical_return_with_injectable_draft_v1(
  p_idempotency_key uuid,
  p_parent_procedure_id uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_draft_id uuid,
  p_draft_revision bigint
) returns public.procedures
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_parent public.procedures;
  v_result public.procedures;
  v_service_cost numeric(14,2) := 0;
begin
  if v_user_id is null then raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED'; end if;
  select * into v_parent from public.procedures where id=p_parent_procedure_id and user_id=v_user_id;
  if not found then raise exception using errcode='P0001', message='RETURN_PARENT_FORBIDDEN'; end if;
  if v_parent.patient_id <> p_patient_id then raise exception using errcode='P0001', message='RETURN_PATIENT_MISMATCH'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception using errcode='22023', message='RETURN_ITEM_REQUIRED'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item where coalesce((item->>'final_price')::numeric,0)<>0) then
    raise exception using errcode='22023', message='RETURN_MUST_BE_ZERO_VALUE';
  end if;

  select * into v_result from public.create_procedure_with_injectable_draft_v5(
    p_idempotency_key,p_patient_id,p_appointment_id,p_performed_at,p_items,'[]'::jsonb,'[]'::jsonb,
    coalesce(p_materials,'[]'::jsonb),p_clinical_minutes,p_notes,p_draft_id,p_draft_revision
  );

  select coalesce(sum(coalesce(pi.cost_snapshot,0) * coalesce(pi.qty,1)),0)
    into v_service_cost
  from public.procedure_items pi
  where pi.procedure_id=v_result.id and pi.user_id=v_user_id;

  update public.procedure_items
  set cost_snapshot=0, cost_snapshot_known=true
  where procedure_id=v_result.id and user_id=v_user_id;

  update public.procedures
  set attendance_type='return', parent_procedure_id=p_parent_procedure_id,
      total_value=0, net_value=0, card_fee_pct=null, card_fee_value=null,
      total_cost=greatest(0, round(coalesce(total_cost,0)-v_service_cost,2))
  where id=v_result.id and user_id=v_user_id
  returning * into v_result;

  update public.procedure_returns pr
  set completed_at=coalesce(pr.completed_at,now()),
      completed_by_procedure_id=coalesce(pr.completed_by_procedure_id,v_result.id),
      updated_at=now()
  where pr.user_id=v_user_id and pr.procedure_id=p_parent_procedure_id and pr.patient_id=p_patient_id
    and pr.dismissed_at is null and pr.completed_at is null
    and exists (
      select 1 from public.procedure_items pi
      where pi.procedure_id=v_result.id and pi.user_id=v_user_id and pi.service_id=pr.service_id
    );

  return v_result;
end;
$function$;

with costs as (
  select p.id, coalesce(sum(coalesce(pi.cost_snapshot,0) * coalesce(pi.qty,1)),0) as service_cost
  from public.procedures p
  join public.procedure_items pi on pi.procedure_id=p.id and pi.user_id=p.user_id
  where p.attendance_type='return'
  group by p.id
)
update public.procedures p
set total_cost=greatest(0, round(coalesce(p.total_cost,0)-costs.service_cost,2))
from costs
where p.id=costs.id and costs.service_cost<>0;

update public.procedure_items pi
set cost_snapshot=0, cost_snapshot_known=true
from public.procedures p
where p.id=pi.procedure_id
  and p.user_id=pi.user_id
  and p.attendance_type='return'
  and coalesce(pi.cost_snapshot,0)<>0;

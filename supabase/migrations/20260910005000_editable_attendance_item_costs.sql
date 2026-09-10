-- Per-attendance service cost overrides.
-- Catalog service.cost_per_unit remains the suggested default only.
-- Return attendances keep zero charge to the patient; this RPC changes cost only.

create or replace function public.set_procedure_item_costs_v1(
  p_procedure_id uuid,
  p_costs jsonb
)
returns public.procedures
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result public.procedures;
  v_expected integer := 0;
  v_matched integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;

  select * into v_result
  from public.procedures
  where id = p_procedure_id and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode='P0001', message='ATTENDANCE_PROCEDURE_FORBIDDEN';
  end if;

  if jsonb_typeof(coalesce(p_costs, '[]'::jsonb)) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_COSTS_INVALID';
  end if;

  select count(*) into v_expected
  from jsonb_array_elements(coalesce(p_costs, '[]'::jsonb));

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_costs, '[]'::jsonb)) as c(service_id uuid, cost numeric)
    where c.service_id is null or c.cost is null or c.cost < 0 or c.cost > 1000000
  ) then
    raise exception using errcode='22023', message='ATTENDANCE_COSTS_INVALID';
  end if;

  update public.procedure_items pi
  set cost_snapshot = c.cost,
      cost_snapshot_known = true
  from jsonb_to_recordset(coalesce(p_costs, '[]'::jsonb)) as c(service_id uuid, cost numeric)
  where pi.procedure_id = p_procedure_id
    and pi.user_id = v_user_id
    and pi.service_id = c.service_id;

  get diagnostics v_matched = row_count;
  if v_matched <> v_expected then
    raise exception using errcode='22023', message='ATTENDANCE_COST_SERVICE_MISMATCH';
  end if;

  update public.procedures p
  set total_cost = round(
    coalesce((
      select sum(pi.cost_snapshot * pi.qty)
      from public.procedure_items pi
      where pi.procedure_id = p.id and pi.user_id = v_user_id
    ), 0)
    + coalesce((
      select sum(pm.total_cost_snapshot)
      from public.procedure_materials pm
      where pm.procedure_id = p.id and pm.user_id = v_user_id
    ), 0)
    + coalesce(p.clinical_time_cost, 0),
    2
  )
  where p.id = p_procedure_id and p.user_id = v_user_id
  returning * into v_result;

  return v_result;
end;
$function$;

revoke all on function public.set_procedure_item_costs_v1(uuid, jsonb) from public;
grant execute on function public.set_procedure_item_costs_v1(uuid, jsonb) to authenticated;

-- Em protocolos antigos, o custo cadastrado no combo representa a previsão do tratamento inteiro.
-- Ao vincular um atendimento histórico, esse custo não pode virar custo realizado da sessão.
-- Materiais e tempo clínico continuam compondo normalmente o custo real do atendimento.

create or replace function public.normalize_legacy_protocol_source_cost_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service_id uuid;
begin
  if new.movement_type <> 'redeem'
     or new.source_type <> 'legacy_protocol_link'
     or new.procedure_id_snapshot is null
     or new.procedure_item_id_snapshot is null then
    return new;
  end if;

  select source_catalog_service_id into v_service_id
  from public.patient_packages
  where id = new.package_id and user_id = new.user_id;

  if v_service_id is null then return new; end if;

  update public.procedure_items
  set cost_snapshot = 0,
      cost_snapshot_known = true
  where id = new.procedure_item_id_snapshot
    and procedure_id = new.procedure_id_snapshot
    and user_id = new.user_id
    and service_id = v_service_id;

  update public.procedures p
  set total_cost = round(
    coalesce((
      select sum(pi.cost_snapshot * pi.qty)
      from public.procedure_items pi
      where pi.procedure_id = p.id and pi.user_id = p.user_id
    ), 0)
    + coalesce((
      select sum(pm.total_cost_snapshot)
      from public.procedure_materials pm
      where pm.procedure_id = p.id and pm.user_id = p.user_id
    ), 0)
    + coalesce(p.clinical_time_cost, 0),
    2
  )
  where p.id = new.procedure_id_snapshot and p.user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists patient_credit_ledger_normalize_legacy_protocol_cost on public.patient_credit_ledger;
create trigger patient_credit_ledger_normalize_legacy_protocol_cost
after insert on public.patient_credit_ledger
for each row
execute function public.normalize_legacy_protocol_source_cost_v1();

-- Corrige protocolos antigos já vinculados antes desta regra.
with legacy_sources as (
  select distinct
    l.user_id,
    l.procedure_id_snapshot as procedure_id,
    l.procedure_item_id_snapshot as procedure_item_id,
    p.source_catalog_service_id as service_id
  from public.patient_credit_ledger l
  join public.patient_packages p
    on p.id = l.package_id and p.user_id = l.user_id
  where l.movement_type = 'redeem'
    and l.source_type = 'legacy_protocol_link'
    and l.procedure_id_snapshot is not null
    and l.procedure_item_id_snapshot is not null
)
update public.procedure_items pi
set cost_snapshot = 0,
    cost_snapshot_known = true
from legacy_sources s
where pi.id = s.procedure_item_id
  and pi.procedure_id = s.procedure_id
  and pi.user_id = s.user_id
  and pi.service_id = s.service_id;

with affected as (
  select distinct l.user_id, l.procedure_id_snapshot as procedure_id
  from public.patient_credit_ledger l
  where l.movement_type = 'redeem'
    and l.source_type = 'legacy_protocol_link'
    and l.procedure_id_snapshot is not null
)
update public.procedures p
set total_cost = round(
  coalesce((
    select sum(pi.cost_snapshot * pi.qty)
    from public.procedure_items pi
    where pi.procedure_id = p.id and pi.user_id = p.user_id
  ), 0)
  + coalesce((
    select sum(pm.total_cost_snapshot)
    from public.procedure_materials pm
    where pm.procedure_id = p.id and pm.user_id = p.user_id
  ), 0)
  + coalesce(p.clinical_time_cost, 0),
  2
)
from affected a
where p.id = a.procedure_id and p.user_id = a.user_id;

comment on function public.normalize_legacy_protocol_source_cost_v1() is
  'Remove do custo realizado da sessão histórica o custo do combo usado como previsão total do protocolo.';

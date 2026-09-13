-- Preserva automaticamente a primeira previsão de custo criada para protocolos futuros.

create or replace function public.preserve_protocol_initial_estimated_cost_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.initial_estimated_cost_snapshot is null and new.estimated_cost_snapshot is not null then
    new.initial_estimated_cost_snapshot := new.estimated_cost_snapshot;
  end if;
  return new;
end;
$$;

drop trigger if exists patient_packages_preserve_initial_estimated_cost on public.patient_packages;
create trigger patient_packages_preserve_initial_estimated_cost
before insert or update of estimated_cost_snapshot on public.patient_packages
for each row
execute function public.preserve_protocol_initial_estimated_cost_v1();

comment on function public.preserve_protocol_initial_estimated_cost_v1() is
  'Congela a primeira previsão total de custo do protocolo; alterações futuras mudam somente a previsão atual.';

-- Hub Giulia 4.4 — conservative cost-knowledge normalization.
-- Positive costs are unambiguously configured. Zero remains unknown unless a caller
-- explicitly sets cost_is_configured=true, preserving the distinction zero vs unknown.

create or replace function public.normalize_service_cost_configuration_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
begin
  if new.cost_per_unit<>0 then
    new.cost_is_configured:=true;
  end if;
  return new;
end;
$$;

revoke all on function public.normalize_service_cost_configuration_v1() from public,anon,authenticated;

drop trigger if exists services_cost_configuration_v1 on public.services;
create trigger services_cost_configuration_v1
before insert or update of cost_per_unit,cost_is_configured on public.services
for each row execute function public.normalize_service_cost_configuration_v1();

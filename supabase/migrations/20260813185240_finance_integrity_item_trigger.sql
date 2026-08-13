create or replace function public.snapshot_procedure_items()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if jsonb_typeof(new.services_ids) <> 'array' or jsonb_array_length(new.services_ids) = 0 then
    return new;
  end if;

  insert into public.procedure_items (
    procedure_id, user_id, service_id, name, qty, list_price, final_price, discount, cost_snapshot
  )
  select
    new.id,
    new.user_id,
    e.value::uuid,
    coalesce(s.name, 'Serviço registrado'),
    1,
    coalesce(s.price, case when jsonb_array_length(new.services_ids) = 1 then new.total_value else 0 end),
    case when jsonb_array_length(new.services_ids) = 1 then new.total_value else coalesce(s.price, 0) end,
    greatest(
      coalesce(s.price, 0) - case when jsonb_array_length(new.services_ids) = 1 then new.total_value else coalesce(s.price, 0) end,
      0
    ),
    case when jsonb_array_length(new.services_ids) = 1 then new.total_cost else coalesce(s.cost_per_unit, 0) end
  from jsonb_array_elements_text(new.services_ids) as e(value)
  left join public.services s
    on s.id = e.value::uuid
   and s.user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_snapshot_procedure_items on public.procedures;
create trigger trg_snapshot_procedure_items
after insert on public.procedures
for each row execute function public.snapshot_procedure_items();

insert into public.procedure_items (
  procedure_id, user_id, service_id, name, qty, list_price, final_price, discount, cost_snapshot
)
select
  p.id,
  p.user_id,
  e.value::uuid,
  coalesce(s.name, 'Serviço registrado'),
  1,
  coalesce(s.price, p.total_value),
  p.total_value,
  greatest(coalesce(s.price, p.total_value) - p.total_value, 0),
  p.total_cost
from public.procedures p
cross join lateral jsonb_array_elements_text(p.services_ids) as e(value)
left join public.services s
  on s.id = e.value::uuid
 and s.user_id = p.user_id
where jsonb_typeof(p.services_ids) = 'array'
  and jsonb_array_length(p.services_ids) = 1
  and not exists (
    select 1 from public.procedure_items pi where pi.procedure_id = p.id
  );

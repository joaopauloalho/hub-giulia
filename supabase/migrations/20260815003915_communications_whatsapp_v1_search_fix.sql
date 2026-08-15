create or replace function public.list_communication_attention_v1(
  p_category text default null,
  p_search text default null,
  p_include_snoozed boolean default false,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  item_key text, category text, source_type text, source_id uuid, patient_id uuid, contact_id uuid,
  display_name text, phone text, due_at timestamptz, event_at timestamptz, reason text, priority text,
  template_key text, context jsonb, target_route text, last_contacted_at timestamptz, snoozed_until timestamptz
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select a.item_key, a.category, a.source_type, a.source_id, a.patient_id, a.contact_id,
         a.display_name, a.phone, a.due_at, a.event_at, a.reason, a.priority,
         a.template_key, a.context, a.target_route, a.last_contacted_at, a.snoozed_until
  from public.communication_attention_v1 a
  where (p_category is null or p_category = '' or a.category = p_category)
    and (
      p_search is null or btrim(p_search) = ''
      or a.display_name ilike '%' || btrim(p_search) || '%'
      or (
        regexp_replace(btrim(p_search), '\D', '', 'g') <> ''
        and regexp_replace(coalesce(a.phone, ''), '\D', '', 'g')
            like '%' || regexp_replace(btrim(p_search), '\D', '', 'g') || '%'
      )
    )
    and (p_include_snoozed or not a.is_snoozed)
    and not a.is_suppressed_after_contact
  order by case a.priority when 'overdue' then 0 when 'today' then 1 when 'tomorrow' then 2 else 3 end,
           a.due_at asc nulls last, a.display_name
  limit greatest(1, least(coalesce(p_limit, 100), 100))
  offset greatest(0, least(coalesce(p_offset, 0), 10000));
$$;

revoke all on function public.list_communication_attention_v1(text,text,boolean,integer,integer) from public, anon;
grant execute on function public.list_communication_attention_v1(text,text,boolean,integer,integer) to authenticated;

-- Hub Giulia 2.2 — Contratos 2.0 / Patient 360 timeline

create or replace function public.list_patient_timeline_v3(
  p_patient_id uuid,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table(
  event_key text,
  event_type text,
  occurred_at timestamptz,
  title text,
  subtitle text,
  source_id uuid,
  metadata jsonb
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_uid is null then raise exception 'PATIENT_360_SESSION_REQUIRED'; end if;
  if not exists (
    select 1 from public.patients p where p.id = p_patient_id and p.user_id = v_uid
  ) then raise exception 'PATIENT_360_NOT_FOUND'; end if;

  return query
  with existing_events as (
    select e.*
    from public.list_patient_timeline_v2(p_patient_id, 50, p_cursor_at, p_cursor_key) e
    where e.event_type <> 'contract'
  ),
  contract_events as (
    select
      'contract:' || c.id::text || ':signed' as event_key,
      'contract'::text as event_type,
      c.signed_at as occurred_at,
      'Contrato assinado'::text as title,
      coalesce(c.document_name_snapshot, ct.name, 'Contrato')::text as subtitle,
      c.id as source_id,
      jsonb_build_object(
        'status', c.status,
        'template_id', c.template_id,
        'procedure_id', c.procedure_id,
        'appointment_id', c.appointment_id,
        'source_type', c.source_type
      ) as metadata
    from public.contracts c
    left join public.contract_templates ct on ct.id = c.template_id and ct.user_id = v_uid
    where c.user_id = v_uid
      and c.patient_id = p_patient_id
      and c.signed_at is not null

    union all

    select
      'contract:' || c.id::text || ':voided',
      'contract',
      c.voided_at,
      'Documento anulado',
      coalesce(c.document_name_snapshot, ct.name, 'Contrato'),
      c.id,
      jsonb_build_object(
        'status', c.status,
        'template_id', c.template_id,
        'procedure_id', c.procedure_id,
        'appointment_id', c.appointment_id,
        'source_type', c.source_type
      )
    from public.contracts c
    left join public.contract_templates ct on ct.id = c.template_id and ct.user_id = v_uid
    where c.user_id = v_uid
      and c.patient_id = p_patient_id
      and c.voided_at is not null
      and c.signed_at is not null
  ),
  events as (
    select * from existing_events
    union all
    select * from contract_events
  )
  select e.event_key, e.event_type, e.occurred_at, e.title, e.subtitle, e.source_id, e.metadata
  from events e
  where e.occurred_at is not null
    and (
      p_cursor_at is null
      or e.occurred_at < p_cursor_at
      or (e.occurred_at = p_cursor_at and e.event_key < coalesce(p_cursor_key, ''))
    )
  order by e.occurred_at desc, e.event_key desc
  limit v_limit;
end;
$$;

revoke execute on function public.list_patient_timeline_v3(uuid,integer,timestamptz,text) from public, anon;
grant execute on function public.list_patient_timeline_v3(uuid,integer,timestamptz,text) to authenticated;

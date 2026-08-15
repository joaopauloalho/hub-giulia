-- Hub Giulia 3.5 — Experiência Operacional / Global Search / Modo Atendimento
-- Additive read models only. No clinical or financial write semantics are changed.

create or replace function public.search_hub_v1(
  p_query text,
  p_limit integer default 12
)
returns table (
  result_type text,
  result_id uuid,
  name text,
  subtitle text,
  route text,
  phone text,
  score integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      lower(trim(left(coalesce(p_query, ''), 80))) as q,
      regexp_replace(trim(left(coalesce(p_query, ''), 80)), '[^0-9]', '', 'g') as digits,
      greatest(1, least(coalesce(p_limit, 12), 20)) as lim,
      auth.uid() as uid
  ),
  patient_results as (
    select
      'patient'::text as result_type,
      p.id as result_id,
      p.name,
      'Paciente'::text as subtitle,
      ('/pacientes/' || p.id::text)::text as route,
      null::text as phone,
      case
        when lower(p.name) = x.q then 120
        when lower(p.name) like x.q || '%' then 110
        when lower(p.name) like '%' || x.q || '%' then 95
        when x.digits <> '' and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') like '%' || x.digits || '%' then 85
        when lower(coalesce(p.email, '')) like '%' || x.q || '%' then 70
        else 0
      end::integer as score
    from public.patients p
    cross join params x
    where x.uid is not null
      and x.q <> ''
      and p.user_id = x.uid
      and p.archived_at is null
      and (
        lower(p.name) like '%' || x.q || '%'
        or lower(coalesce(p.email, '')) like '%' || x.q || '%'
        or (x.digits <> '' and regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') like '%' || x.digits || '%')
      )
  ),
  contact_results as (
    select
      case when d.id is null then 'contact' else 'lead' end::text as result_type,
      coalesce(d.id, c.id) as result_id,
      c.name,
      case
        when d.id is null then 'Contato CRM'
        else 'Lead · ' || coalesce(nullif(d.title, ''), 'Oportunidade') || ' · ' || replace(coalesce(d.stage, 'new'), '_', ' ')
      end::text as subtitle,
      case when d.id is null then '/crm' else '/crm?deal_id=' || d.id::text end::text as route,
      null::text as phone,
      (case
        when lower(c.name) = x.q then 115
        when lower(c.name) like x.q || '%' then 105
        when lower(c.name) like '%' || x.q || '%' then 90
        when x.digits <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || x.digits || '%' then 82
        when lower(coalesce(c.email, '')) like '%' || x.q || '%' then 68
        else 0
      end + case when d.id is not null then 3 else 0 end)::integer as score
    from public.contacts c
    cross join params x
    left join lateral (
      select deal.id, deal.title, deal.stage, deal.updated_at, deal.created_at
      from public.deals deal
      where deal.user_id = x.uid
        and deal.contact_id = c.id
      order by
        case when deal.stage in ('won', 'lost') then 1 else 0 end,
        deal.updated_at desc nulls last,
        deal.created_at desc
      limit 1
    ) d on true
    where x.uid is not null
      and x.q <> ''
      and c.user_id = x.uid
      and c.archived_at is null
      and (
        lower(c.name) like '%' || x.q || '%'
        or lower(coalesce(c.email, '')) like '%' || x.q || '%'
        or (x.digits <> '' and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || x.digits || '%')
      )
  ),
  combined as (
    select * from patient_results
    union all
    select * from contact_results
  )
  select c.result_type, c.result_id, c.name, c.subtitle, c.route, c.phone, c.score
  from combined c
  order by c.score desc, c.name asc
  limit (select lim from params);
$$;

revoke all on function public.search_hub_v1(text, integer) from public;
revoke all on function public.search_hub_v1(text, integer) from anon;
grant execute on function public.search_hub_v1(text, integer) to authenticated;

comment on function public.search_hub_v1(text, integer) is
  'Tenant-safe operational search for patients and CRM contacts/deals. Does not search clinical notes, anamnesis, contracts, financial content or CPF.';

create or replace function public.get_attendance_context_v1(
  p_appointment_id uuid
)
returns table (
  appointment_id uuid,
  patient_id uuid,
  patient_name text,
  patient_phone text,
  service_id uuid,
  service_name text,
  service_is_injectable boolean,
  scheduled_at timestamptz,
  duration_minutes integer,
  appointment_status text,
  anamnesis_status text,
  anamnesis_last_saved_at timestamptz,
  photo_count bigint,
  procedure_id uuid,
  procedure_performed_at timestamptz,
  procedure_total_value numeric,
  procedure_gross_value numeric,
  procedure_covered_value numeric,
  procedure_pending_amount numeric,
  contract_count bigint,
  payment_count bigint,
  injectable_map_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.patient_id,
    p.name as patient_name,
    p.phone as patient_phone,
    a.service_id,
    s.name as service_name,
    coalesce(s.is_injectable, false) as service_is_injectable,
    a.scheduled_at,
    coalesce(a.duration_minutes, s.duration_minutes, 60)::integer as duration_minutes,
    a.status as appointment_status,
    an.status as anamnesis_status,
    an.last_saved_at as anamnesis_last_saved_at,
    (select count(*) from public.patient_photos ph where ph.user_id = auth.uid() and ph.patient_id = a.patient_id) as photo_count,
    pr.id as procedure_id,
    pr.performed_at as procedure_performed_at,
    pr.total_value as procedure_total_value,
    pr.gross_value as procedure_gross_value,
    pr.covered_value as procedure_covered_value,
    pr.pending_amount as procedure_pending_amount,
    (select count(*) from public.contracts c where c.user_id = auth.uid() and c.patient_id = a.patient_id and (c.appointment_id = a.id or (pr.id is not null and c.procedure_id = pr.id))) as contract_count,
    (select count(*) from public.procedure_payments pp where pp.user_id = auth.uid() and pr.id is not null and pp.procedure_id = pr.id) as payment_count,
    (select count(*) from public.injectable_maps im where im.user_id = auth.uid() and im.patient_id = a.patient_id and (pr.id is null or im.procedure_id = pr.id)) as injectable_map_count
  from public.appointments a
  join public.patients p
    on p.id = a.patient_id
   and p.user_id = auth.uid()
  left join public.services s
    on s.id = a.service_id
   and s.user_id = auth.uid()
  left join lateral (
    select current_anamnesis.status, current_anamnesis.last_saved_at
    from public.anamnesis current_anamnesis
    where current_anamnesis.user_id = auth.uid()
      and current_anamnesis.patient_id = a.patient_id
    order by current_anamnesis.updated_at desc nulls last, current_anamnesis.created_at desc
    limit 1
  ) an on true
  left join lateral (
    select proc.id, proc.performed_at, proc.total_value, proc.gross_value, proc.covered_value, proc.pending_amount
    from public.procedures proc
    where proc.user_id = auth.uid()
      and proc.appointment_id = a.id
    order by proc.performed_at desc, proc.created_at desc
    limit 1
  ) pr on true
  where auth.uid() is not null
    and a.user_id = auth.uid()
    and a.id = p_appointment_id;
$$;

revoke all on function public.get_attendance_context_v1(uuid) from public;
revoke all on function public.get_attendance_context_v1(uuid) from anon;
grant execute on function public.get_attendance_context_v1(uuid) to authenticated;

comment on function public.get_attendance_context_v1(uuid) is
  'Tenant-safe factual read model for Hub Giulia attendance orchestration. It never mutates appointment, clinical or financial state.';

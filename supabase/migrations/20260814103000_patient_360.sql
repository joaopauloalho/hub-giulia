-- Hub Giulia 2.0 — Paciente 360
-- Read models + safe patient archiving. No duplicated source-of-truth tables.

alter table public.patients
  add column if not exists archived_at timestamptz;

create index if not exists patients_user_active_created_idx
  on public.patients (user_id, created_at desc)
  where archived_at is null;

create index if not exists patients_user_archived_created_idx
  on public.patients (user_id, archived_at desc, created_at desc)
  where archived_at is not null;

create index if not exists patient_notes_user_patient_created_idx
  on public.patient_notes (user_id, patient_id, created_at desc);

create index if not exists anamnesis_user_patient_updated_idx
  on public.anamnesis (user_id, patient_id, updated_at desc);

create index if not exists appointments_user_patient_scheduled_idx
  on public.appointments (user_id, patient_id, scheduled_at);

create index if not exists procedures_user_patient_performed_idx
  on public.procedures (user_id, patient_id, performed_at desc, id desc);

create index if not exists contracts_user_patient_signed_idx
  on public.contracts (user_id, patient_id, signed_at desc);

create index if not exists patient_photos_user_patient_taken_idx
  on public.patient_photos (user_id, patient_id, taken_at desc);

create index if not exists injectable_maps_user_patient_created_idx
  on public.injectable_maps (user_id, patient_id, created_at desc);

create index if not exists procedure_returns_user_patient_open_idx
  on public.procedure_returns (user_id, patient_id, window_end, window_start)
  where completed_at is null and dismissed_at is null;

create or replace function public.get_patient_360_overview_v1(p_patient_id uuid)
returns table (
  next_appointment jsonb,
  last_procedure jsonb,
  active_returns_count bigint,
  priority_return jsonb,
  financial_summary jsonb,
  open_notes_count bigint,
  overdue_notes_count bigint,
  anamnesis_summary jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := timezone('America/Sao_Paulo', now())::date;
begin
  if v_uid is null then
    raise exception 'PATIENT_360_SESSION_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.user_id = v_uid
  ) then
    raise exception 'PATIENT_360_NOT_FOUND';
  end if;

  return query
  with next_apt as (
    select jsonb_build_object(
      'id', a.id,
      'scheduled_at', a.scheduled_at,
      'status', a.status,
      'service_id', a.service_id,
      'service_name', coalesce(s.name, 'Consulta')
    ) as payload
    from public.appointments a
    left join public.services s
      on s.id = a.service_id
     and s.user_id = v_uid
    where a.user_id = v_uid
      and a.patient_id = p_patient_id
      and a.scheduled_at >= now()
      and a.status in ('pendente', 'confirmado')
    order by a.scheduled_at, a.id
    limit 1
  ),
  last_proc as (
    select jsonb_build_object(
      'id', p.id,
      'performed_at', p.performed_at,
      'item_names', coalesce((
        select jsonb_agg(pi.name order by pi.created_at, pi.id)
        from public.procedure_items pi
        where pi.user_id = v_uid
          and pi.procedure_id = p.id
      ), '[]'::jsonb),
      'total_value', p.total_value,
      'paid_amount', p.paid_amount,
      'pending_amount', p.pending_amount
    ) as payload
    from public.procedures p
    where p.user_id = v_uid
      and p.patient_id = p_patient_id
    order by p.performed_at desc, p.id desc
    limit 1
  ),
  open_returns as (
    select pr.*,
      case
        when pr.window_end < v_today then 0
        when pr.window_start <= v_today then 1
        else 2
      end as priority_rank
    from public.procedure_returns pr
    where pr.user_id = v_uid
      and pr.patient_id = p_patient_id
      and pr.completed_at is null
      and pr.dismissed_at is null
  ),
  priority_ret as (
    select jsonb_build_object(
      'id', pr.id,
      'service_name', pr.service_name_snapshot,
      'return_type', pr.return_type,
      'window_start', pr.window_start,
      'window_end', pr.window_end,
      'contacted_at', pr.contacted_at,
      'appointment_id', pr.appointment_id,
      'appointment_status', a.status,
      'appointment_scheduled_at', a.scheduled_at,
      'status', case
        when pr.window_end < v_today then 'overdue'
        when pr.window_start <= v_today then 'in_window'
        else 'upcoming'
      end
    ) as payload
    from open_returns pr
    left join public.appointments a
      on a.id = pr.appointment_id
     and a.user_id = v_uid
    order by pr.priority_rank, pr.window_end, pr.created_at, pr.id
    limit 1
  ),
  finance as (
    select jsonb_build_object(
      'total', coalesce(sum(p.total_value), 0),
      'received', coalesce(sum(p.paid_amount), 0),
      'pending', coalesce(sum(p.pending_amount), 0),
      'last_payment_at', (
        select max(pp.paid_at)
        from public.procedure_payments pp
        join public.procedures px
          on px.id = pp.procedure_id
         and px.user_id = v_uid
        where pp.user_id = v_uid
          and px.patient_id = p_patient_id
          and pp.paid_at is not null
      )
    ) as payload
    from public.procedures p
    where p.user_id = v_uid
      and p.patient_id = p_patient_id
  ),
  note_counts as (
    select
      count(*) filter (where not n.resolved) as open_count,
      count(*) filter (
        where not n.resolved
          and n.remind_at is not null
          and n.remind_at <= v_today
      ) as overdue_count
    from public.patient_notes n
    where n.user_id = v_uid
      and n.patient_id = p_patient_id
  ),
  anam as (
    select jsonb_build_object(
      'completed', true,
      'allergies', nullif(btrim(a.allergies), ''),
      'medications', nullif(btrim(a.medications), ''),
      'updated_at', a.updated_at
    ) as payload
    from public.anamnesis a
    where a.user_id = v_uid
      and a.patient_id = p_patient_id
    order by a.updated_at desc, a.id desc
    limit 1
  )
  select
    coalesce((select payload from next_apt), 'null'::jsonb),
    coalesce((select payload from last_proc), 'null'::jsonb),
    (select count(*) from open_returns),
    coalesce((select payload from priority_ret), 'null'::jsonb),
    coalesce(
      (select payload from finance),
      jsonb_build_object('total', 0, 'received', 0, 'pending', 0, 'last_payment_at', null)
    ),
    coalesce((select open_count from note_counts), 0),
    coalesce((select overdue_count from note_counts), 0),
    coalesce(
      (select payload from anam),
      jsonb_build_object('completed', false, 'allergies', null, 'medications', null, 'updated_at', null)
    );
end;
$$;

create or replace function public.list_patient_timeline_v1(
  p_patient_id uuid,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table (
  event_key text,
  event_type text,
  occurred_at timestamptz,
  title text,
  subtitle text,
  source_id uuid,
  metadata jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if v_uid is null then
    raise exception 'PATIENT_360_SESSION_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.user_id = v_uid
  ) then
    raise exception 'PATIENT_360_NOT_FOUND';
  end if;

  return query
  with events as (
    select
      'appointment:' || a.id::text || ':created' as event_key,
      'appointment'::text as event_type,
      a.created_at as occurred_at,
      'Consulta agendada'::text as title,
      coalesce(s.name, 'Consulta') || ' · para ' ||
        to_char(timezone('America/Sao_Paulo', a.scheduled_at), 'DD/MM/YYYY HH24:MI') as subtitle,
      a.id as source_id,
      jsonb_build_object('scheduled_at', a.scheduled_at, 'status', a.status) as metadata
    from public.appointments a
    left join public.services s
      on s.id = a.service_id
     and s.user_id = v_uid
    where a.user_id = v_uid
      and a.patient_id = p_patient_id

    union all
    select
      'appointment:' || a.id::text || ':confirmed',
      'appointment',
      a.confirmed_at,
      'Consulta confirmada',
      coalesce(s.name, 'Consulta') || ' · ' ||
        to_char(timezone('America/Sao_Paulo', a.scheduled_at), 'DD/MM/YYYY HH24:MI'),
      a.id,
      jsonb_build_object('scheduled_at', a.scheduled_at, 'status', a.status)
    from public.appointments a
    left join public.services s
      on s.id = a.service_id
     and s.user_id = v_uid
    where a.user_id = v_uid
      and a.patient_id = p_patient_id
      and a.confirmed_at is not null

    union all
    select
      'appointment:' || a.id::text || ':canceled',
      'appointment',
      a.canceled_at,
      'Consulta cancelada',
      coalesce(s.name, 'Consulta') || coalesce(' · ' || nullif(a.cancellation_reason, ''), ''),
      a.id,
      jsonb_build_object('scheduled_at', a.scheduled_at, 'status', a.status)
    from public.appointments a
    left join public.services s
      on s.id = a.service_id
     and s.user_id = v_uid
    where a.user_id = v_uid
      and a.patient_id = p_patient_id
      and a.canceled_at is not null

    union all
    select
      'appointment:' || a.id::text || ':no-show',
      'appointment',
      a.no_show_at,
      'Não compareceu',
      coalesce(s.name, 'Consulta') || ' · ' ||
        to_char(timezone('America/Sao_Paulo', a.scheduled_at), 'DD/MM/YYYY HH24:MI'),
      a.id,
      jsonb_build_object('scheduled_at', a.scheduled_at, 'status', a.status)
    from public.appointments a
    left join public.services s
      on s.id = a.service_id
     and s.user_id = v_uid
    where a.user_id = v_uid
      and a.patient_id = p_patient_id
      and a.no_show_at is not null

    union all
    select
      'procedure:' || p.id::text,
      'procedure',
      p.performed_at,
      'Atendimento realizado',
      coalesce((
        select string_agg(pi.name, ' + ' order by pi.created_at, pi.id)
        from public.procedure_items pi
        where pi.user_id = v_uid
          and pi.procedure_id = p.id
      ), 'Atendimento'),
      p.id,
      jsonb_build_object('total_value', p.total_value, 'pending_amount', p.pending_amount)
    from public.procedures p
    where p.user_id = v_uid
      and p.patient_id = p_patient_id

    union all
    select
      'return:' || pr.id::text || ':created',
      'return',
      pr.created_at,
      case when pr.return_type = 'next_session' then 'Próxima sessão prevista' else 'Retorno gerado' end,
      pr.service_name_snapshot || ' · ' || to_char(pr.window_start, 'DD/MM') || '–' || to_char(pr.window_end, 'DD/MM'),
      pr.id,
      jsonb_build_object('procedure_id', pr.procedure_id, 'window_start', pr.window_start, 'window_end', pr.window_end)
    from public.procedure_returns pr
    where pr.user_id = v_uid
      and pr.patient_id = p_patient_id

    union all
    select
      'return:' || pr.id::text || ':contacted',
      'return',
      pr.contacted_at,
      'Retorno contatado',
      pr.service_name_snapshot,
      pr.id,
      jsonb_build_object('contact_method', pr.contact_method)
    from public.procedure_returns pr
    where pr.user_id = v_uid
      and pr.patient_id = p_patient_id
      and pr.contacted_at is not null

    union all
    select
      'return:' || pr.id::text || ':completed',
      'return',
      pr.completed_at,
      'Retorno concluído',
      pr.service_name_snapshot,
      pr.id,
      jsonb_build_object('completed_by_procedure_id', pr.completed_by_procedure_id)
    from public.procedure_returns pr
    where pr.user_id = v_uid
      and pr.patient_id = p_patient_id
      and pr.completed_at is not null

    union all
    select
      'return:' || pr.id::text || ':dismissed',
      'return',
      pr.dismissed_at,
      'Retorno dispensado',
      pr.service_name_snapshot || coalesce(' · ' || nullif(pr.dismissed_reason, ''), ''),
      pr.id,
      '{}'::jsonb
    from public.procedure_returns pr
    where pr.user_id = v_uid
      and pr.patient_id = p_patient_id
      and pr.dismissed_at is not null

    union all
    select
      'note:' || n.id::text,
      'note',
      n.created_at,
      'Nota criada',
      left(n.content, 120),
      n.id,
      jsonb_build_object('remind_at', n.remind_at, 'resolved', n.resolved)
    from public.patient_notes n
    where n.user_id = v_uid
      and n.patient_id = p_patient_id

    union all
    select
      'contract:' || c.id::text,
      'contract',
      c.signed_at,
      'Contrato assinado',
      coalesce(ct.name, 'Contrato'),
      c.id,
      jsonb_build_object('template_id', c.template_id)
    from public.contracts c
    left join public.contract_templates ct
      on ct.id = c.template_id
     and ct.user_id = v_uid
    where c.user_id = v_uid
      and c.patient_id = p_patient_id

    union all
    select
      'photo:' || ph.id::text,
      'photo',
      ph.taken_at,
      'Foto registrada',
      coalesce(
        nullif(ph.label, ''),
        case ph.photo_type
          when 'before' then 'Antes'
          when 'after' then 'Depois'
          else 'Foto clínica'
        end
      ),
      ph.id,
      jsonb_build_object('photo_type', ph.photo_type, 'procedure_id', ph.procedure_id)
    from public.patient_photos ph
    where ph.user_id = v_uid
      and ph.patient_id = p_patient_id

    union all
    select
      'anamnesis:' || a.id::text,
      'anamnesis',
      a.updated_at,
      'Anamnese atualizada',
      null::text,
      a.id,
      '{}'::jsonb
    from public.anamnesis a
    where a.user_id = v_uid
      and a.patient_id = p_patient_id

    union all
    select
      'injectable:' || im.id::text,
      'injectable',
      im.created_at,
      'Mapa de injetáveis registrado',
      null::text,
      im.id,
      jsonb_build_object('procedure_id', im.procedure_id)
    from public.injectable_maps im
    where im.user_id = v_uid
      and im.patient_id = p_patient_id
  )
  select
    e.event_key,
    e.event_type,
    e.occurred_at,
    e.title,
    e.subtitle,
    e.source_id,
    e.metadata
  from events e
  where e.occurred_at is not null
    and (
      p_cursor_at is null
      or e.occurred_at < p_cursor_at
      or (
        e.occurred_at = p_cursor_at
        and e.event_key < coalesce(p_cursor_key, '')
      )
    )
  order by e.occurred_at desc, e.event_key desc
  limit v_limit;
end;
$$;

revoke all on function public.get_patient_360_overview_v1(uuid) from public, anon;
grant execute on function public.get_patient_360_overview_v1(uuid) to authenticated;

revoke all on function public.list_patient_timeline_v1(uuid, integer, timestamptz, text) from public, anon;
grant execute on function public.list_patient_timeline_v1(uuid, integer, timestamptz, text) to authenticated;

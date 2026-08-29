-- Hub Giulia — Jornada da Paciente v1
-- Read model operacional que consolida CRM, propostas, agenda, procedimentos,
-- retornos e pacotes sem duplicar fontes de verdade.

create table if not exists public.patient_journey_manual_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  patient_id uuid not null,
  moment text,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint patient_journey_manual_events_patient_owner_fkey
    foreign key (patient_id, user_id) references public.patients(id, user_id) on delete cascade,
  constraint patient_journey_manual_events_moment_check check (
    moment is null or moment = any (array[
      'assessment_scheduled'::text,
      'awaiting_quote'::text,
      'quote_sent'::text,
      'negotiation'::text,
      'won_waiting_start'::text,
      'in_treatment'::text,
      'treatment_completed'::text,
      'visited_not_closed'::text,
      'unclassified'::text
    ])
  ),
  constraint patient_journey_manual_events_note_length_check
    check (note is null or char_length(note) <= 1000)
);

create unique index if not exists patient_journey_manual_events_id_user_uidx
  on public.patient_journey_manual_events(id, user_id);
create index if not exists patient_journey_manual_events_user_patient_created_idx
  on public.patient_journey_manual_events(user_id, patient_id, created_at desc, id desc);

alter table public.patient_journey_manual_events enable row level security;
drop policy if exists patient_journey_manual_events_select_own on public.patient_journey_manual_events;
create policy patient_journey_manual_events_select_own
  on public.patient_journey_manual_events
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.patient_journey_manual_events from anon, authenticated;
grant select on public.patient_journey_manual_events to authenticated;

create or replace function public.block_patient_journey_event_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_HISTORY_APPEND_ONLY';
end;
$$;

drop trigger if exists patient_journey_manual_events_no_update_delete on public.patient_journey_manual_events;
create trigger patient_journey_manual_events_no_update_delete
before update or delete on public.patient_journey_manual_events
for each row execute function public.block_patient_journey_event_mutation_v1();

create or replace function public.set_patient_journey_moment_v1(
  p_patient_id uuid,
  p_moment text,
  p_note text default null
)
returns table (
  event_id uuid,
  patient_id uuid,
  moment text,
  note text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(btrim(p_note), '');
  v_row public.patient_journey_manual_events%rowtype;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_SESSION_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.user_id = v_uid
      and p.archived_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_PATIENT_NOT_FOUND';
  end if;

  if p_moment is not null and p_moment <> all (array[
    'assessment_scheduled'::text,
    'awaiting_quote'::text,
    'quote_sent'::text,
    'negotiation'::text,
    'won_waiting_start'::text,
    'in_treatment'::text,
    'treatment_completed'::text,
    'visited_not_closed'::text,
    'unclassified'::text
  ]) then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_INVALID_MOMENT';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_NOTE_TOO_LONG';
  end if;

  insert into public.patient_journey_manual_events(user_id, patient_id, moment, note, created_by)
  values (v_uid, p_patient_id, p_moment, v_note, v_uid)
  returning * into v_row;

  return query select v_row.id, v_row.patient_id, v_row.moment, v_row.note, v_row.created_at;
end;
$$;

create or replace function public.list_patient_journey_v1(
  p_search text default null,
  p_moment text default null,
  p_attention_only boolean default false,
  p_patient_id uuid default null
)
returns table (
  patient_id uuid,
  patient_name text,
  phone text,
  profession text,
  photo_url text,
  moment text,
  moment_source text,
  moment_reason text,
  moment_since timestamptz,
  days_in_moment integer,
  attention_level text,
  next_action text,
  deal_id uuid,
  deal_stage text,
  deal_title text,
  proposal_version_id uuid,
  proposal_title text,
  proposal_total_value numeric,
  proposal_status text,
  proposal_valid_until date,
  proposal_sent_at timestamptz,
  available_balance numeric,
  active_package_title text,
  next_appointment_at timestamptz,
  last_procedure_at timestamptz,
  open_returns_count bigint,
  followup_due_on date,
  classification_debug jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := timezone('America/Sao_Paulo', now())::date;
  v_search text := nullif(btrim(p_search), '');
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_SESSION_REQUIRED';
  end if;

  if p_moment is not null and p_moment <> all (array[
    'assessment_scheduled'::text,
    'awaiting_quote'::text,
    'quote_sent'::text,
    'negotiation'::text,
    'won_waiting_start'::text,
    'in_treatment'::text,
    'treatment_completed'::text,
    'visited_not_closed'::text,
    'unclassified'::text
  ]) then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_INVALID_MOMENT';
  end if;

  return query
  with patient_base as (
    select p.id, p.name, p.phone, p.profession, p.photo_url, p.created_at
    from public.patients p
    where p.user_id = v_uid
      and p.archived_at is null
      and (p_patient_id is null or p.id = p_patient_id)
      and (
        v_search is null
        or p.name ilike '%' || v_search || '%'
        or coalesce(p.phone, '') ilike '%' || v_search || '%'
        or coalesce(p.email, '') ilike '%' || v_search || '%'
      )
  ),
  deal_signal as (
    select distinct on (c.patient_id)
      c.patient_id,
      d.id as deal_id,
      d.stage,
      d.title,
      d.updated_at,
      d.won_at,
      d.lost_at
    from public.contacts c
    join public.deals d
      on d.contact_id = c.id
     and d.user_id = v_uid
    where c.user_id = v_uid
      and c.patient_id is not null
    order by c.patient_id, d.updated_at desc, d.created_at desc, d.id desc
  ),
  proposal_signal as (
    select distinct on (c.patient_id)
      c.patient_id,
      v.id as version_id,
      v.title,
      v.total_value,
      v.status,
      v.valid_until,
      v.sent_at,
      v.issued_at,
      v.accepted_at,
      v.updated_at,
      tp.deal_id
    from public.contacts c
    join public.deals d
      on d.contact_id = c.id
     and d.user_id = v_uid
    join public.treatment_proposals tp
      on tp.deal_id = d.id
     and tp.user_id = v_uid
    join public.treatment_proposal_versions v
      on v.proposal_id = tp.id
     and v.user_id = v_uid
    where c.user_id = v_uid
      and c.patient_id is not null
      and v.status <> 'voided'
    order by c.patient_id,
      greatest(
        coalesce(v.accepted_at, '-infinity'::timestamptz),
        coalesce(v.sent_at, '-infinity'::timestamptz),
        coalesce(v.issued_at, '-infinity'::timestamptz),
        coalesce(v.updated_at, '-infinity'::timestamptz),
        v.created_at
      ) desc,
      v.version_number desc,
      v.id desc
  ),
  next_appointment_signal as (
    select distinct on (a.patient_id)
      a.patient_id,
      a.id,
      a.scheduled_at,
      a.created_at
    from public.appointments a
    where a.user_id = v_uid
      and a.scheduled_at >= now()
      and a.canceled_at is null
      and a.no_show_at is null
      and coalesce(a.status, '') not in ('cancelado', 'cancelled', 'no_show', 'nao_compareceu')
    order by a.patient_id, a.scheduled_at, a.id
  ),
  last_procedure_signal as (
    select distinct on (p.patient_id)
      p.patient_id,
      p.id,
      p.performed_at
    from public.procedures p
    where p.user_id = v_uid
    order by p.patient_id, p.performed_at desc, p.id desc
  ),
  return_signal as (
    select pr.patient_id,
      count(*)::bigint as open_count,
      max(pr.created_at) as latest_created_at
    from public.procedure_returns pr
    where pr.user_id = v_uid
      and pr.completed_at is null
      and pr.dismissed_at is null
    group by pr.patient_id
  ),
  package_signal as (
    select b.patient_id,
      coalesce(sum(b.available_balance), 0)::numeric as available_balance,
      max(pp.updated_at) filter (where b.available_balance > 0) as latest_active_at,
      (array_agg(b.package_title order by b.activated_at desc nulls last, b.package_id) filter (where b.available_balance > 0))[1] as active_package_title
    from public.patient_credit_item_balances_v b
    join public.patient_packages pp
      on pp.id = b.package_id
     and pp.user_id = v_uid
    where b.user_id = v_uid
    group by b.patient_id
  ),
  followup_signal as (
    select c.patient_id,
      min(f.due_on) filter (where f.status = 'open') as due_on
    from public.contacts c
    join public.deals d
      on d.contact_id = c.id
     and d.user_id = v_uid
    join public.crm_followups f
      on f.deal_id = d.id
     and f.user_id = v_uid
    where c.user_id = v_uid
      and c.patient_id is not null
    group by c.patient_id
  ),
  manual_signal as (
    select distinct on (m.patient_id)
      m.patient_id,
      m.moment,
      m.note,
      m.created_at
    from public.patient_journey_manual_events m
    where m.user_id = v_uid
    order by m.patient_id, m.created_at desc, m.id desc
  ),
  signal_matrix as (
    select
      pb.*,
      ds.deal_id,
      ds.stage as deal_stage,
      ds.title as deal_title,
      ds.updated_at as deal_updated_at,
      ds.won_at,
      ps.version_id as proposal_version_id,
      ps.title as proposal_title,
      ps.total_value as proposal_total_value,
      ps.status as proposal_status,
      ps.valid_until as proposal_valid_until,
      ps.sent_at as proposal_sent_at,
      ps.issued_at as proposal_issued_at,
      ps.accepted_at as proposal_accepted_at,
      ps.updated_at as proposal_updated_at,
      coalesce(pk.available_balance, 0)::numeric as available_balance,
      pk.active_package_title,
      pk.latest_active_at,
      na.scheduled_at as next_appointment_at,
      na.created_at as next_appointment_created_at,
      lp.performed_at as last_procedure_at,
      coalesce(rs.open_count, 0)::bigint as open_returns_count,
      rs.latest_created_at as open_return_latest_at,
      fs.due_on as followup_due_on,
      ms.moment as manual_moment,
      ms.note as manual_note,
      ms.created_at as manual_created_at,
      case
        when ds.stage = 'negotiation' then 'negotiation'
        when ps.status = 'accepted' or ds.stage = 'won' then 'won_waiting_start'
        when ps.status = 'issued' and (ps.sent_at is not null or ps.issued_at is not null) then 'quote_sent'
        when ds.stage = 'proposal_sent' then 'quote_sent'
        when ds.stage = 'assessment_scheduled' and na.scheduled_at is not null then 'assessment_scheduled'
        when na.scheduled_at is not null and lp.performed_at is null then 'assessment_scheduled'
        else null
      end as commercial_moment,
      case
        when ds.stage = 'negotiation' then ds.updated_at
        when ps.status = 'accepted' then coalesce(ps.accepted_at, ps.updated_at)
        when ds.stage = 'won' then coalesce(ds.won_at, ds.updated_at)
        when ps.status = 'issued' then coalesce(ps.sent_at, ps.issued_at, ps.updated_at)
        when ds.stage = 'proposal_sent' then ds.updated_at
        when ds.stage = 'assessment_scheduled' and na.scheduled_at is not null then greatest(ds.updated_at, na.created_at)
        when na.scheduled_at is not null and lp.performed_at is null then na.created_at
        else null
      end as commercial_at,
      case
        when ds.stage = 'negotiation' then 'Oportunidade em negociação no CRM.'
        when ps.status = 'accepted' then 'Proposta aceita e tratamento ainda não iniciado.'
        when ds.stage = 'won' then 'Oportunidade marcada como fechada no CRM.'
        when ps.status = 'issued' then 'Proposta emitida/enviada e ainda sem aceite.'
        when ds.stage = 'proposal_sent' then 'Oportunidade está na etapa de orçamento.'
        when ds.stage = 'assessment_scheduled' and na.scheduled_at is not null then 'Avaliação vinculada ao CRM está agendada.'
        when na.scheduled_at is not null and lp.performed_at is null then 'Primeiro agendamento futuro sem procedimento anterior.'
        else null
      end as commercial_reason
    from patient_base pb
    left join deal_signal ds on ds.patient_id = pb.id
    left join proposal_signal ps on ps.patient_id = pb.id
    left join next_appointment_signal na on na.patient_id = pb.id
    left join last_procedure_signal lp on lp.patient_id = pb.id
    left join return_signal rs on rs.patient_id = pb.id
    left join package_signal pk on pk.patient_id = pb.id
    left join followup_signal fs on fs.patient_id = pb.id
    left join manual_signal ms on ms.patient_id = pb.id
  ),
  automatic as (
    select sm.*,
      case
        when sm.available_balance > 0
          or (sm.last_procedure_at is not null and sm.open_returns_count > 0)
          or (sm.last_procedure_at is not null and sm.next_appointment_at is not null)
          then 'in_treatment'
        when sm.commercial_moment is not null
          and (sm.last_procedure_at is null or sm.commercial_at > sm.last_procedure_at)
          then sm.commercial_moment
        when sm.last_procedure_at is not null then 'treatment_completed'
        when sm.commercial_moment is not null then sm.commercial_moment
        else 'unclassified'
      end as auto_moment,
      case
        when sm.available_balance > 0
          or (sm.last_procedure_at is not null and sm.open_returns_count > 0)
          or (sm.last_procedure_at is not null and sm.next_appointment_at is not null)
          then greatest(
            coalesce(sm.latest_active_at, '-infinity'::timestamptz),
            coalesce(sm.open_return_latest_at, '-infinity'::timestamptz),
            coalesce(sm.last_procedure_at, '-infinity'::timestamptz),
            coalesce(sm.next_appointment_created_at, '-infinity'::timestamptz)
          )
        when sm.commercial_moment is not null
          and (sm.last_procedure_at is null or sm.commercial_at > sm.last_procedure_at)
          then sm.commercial_at
        when sm.last_procedure_at is not null then sm.last_procedure_at
        when sm.commercial_moment is not null then sm.commercial_at
        else sm.created_at
      end as auto_at,
      case
        when sm.available_balance > 0 then 'Possui sessões/créditos ativos disponíveis.'
        when sm.last_procedure_at is not null and sm.open_returns_count > 0 then 'Possui retorno clínico aberto após procedimento.'
        when sm.last_procedure_at is not null and sm.next_appointment_at is not null then 'Possui procedimento realizado e próximo agendamento.'
        when sm.commercial_moment is not null
          and (sm.last_procedure_at is null or sm.commercial_at > sm.last_procedure_at)
          then sm.commercial_reason
        when sm.last_procedure_at is not null then 'Último tratamento registrado sem sessão, retorno ou agendamento futuro aberto.'
        when sm.commercial_moment is not null then sm.commercial_reason
        else 'Ainda não há evidência suficiente no Hub para classificar automaticamente.'
      end as auto_reason
    from signal_matrix sm
  ),
  resolved as (
    select a.*,
      case
        when a.manual_moment is not null
          and (a.auto_at is null or a.manual_created_at >= a.auto_at)
          then a.manual_moment
        else a.auto_moment
      end as resolved_moment,
      case
        when a.manual_moment is not null
          and (a.auto_at is null or a.manual_created_at >= a.auto_at)
          then 'manual'
        else 'automatic'
      end as resolved_source,
      case
        when a.manual_moment is not null
          and (a.auto_at is null or a.manual_created_at >= a.auto_at)
          then coalesce(a.manual_note, 'Classificação manual registrada pela equipe.')
        else a.auto_reason
      end as resolved_reason,
      case
        when a.manual_moment is not null
          and (a.auto_at is null or a.manual_created_at >= a.auto_at)
          then a.manual_created_at
        else a.auto_at
      end as resolved_since
    from automatic a
  ),
  enriched as (
    select r.*,
      greatest(0, (v_today - timezone('America/Sao_Paulo', coalesce(r.resolved_since, r.created_at))::date))::integer as resolved_days,
      case
        when r.followup_due_on is not null and r.followup_due_on < v_today then 'urgent'
        when r.resolved_moment = 'unclassified' then 'warning'
        when r.resolved_moment = 'awaiting_quote' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 3 then 'urgent'
        when r.resolved_moment = 'awaiting_quote' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 1 then 'warning'
        when r.resolved_moment = 'quote_sent' and r.proposal_valid_until is not null and r.proposal_valid_until < v_today then 'urgent'
        when r.resolved_moment = 'quote_sent' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 7 then 'urgent'
        when r.resolved_moment = 'quote_sent' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 3 then 'warning'
        when r.resolved_moment = 'negotiation' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 5 then 'urgent'
        when r.resolved_moment = 'negotiation' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 2 then 'warning'
        when r.resolved_moment = 'won_waiting_start' and r.next_appointment_at is null and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 7 then 'urgent'
        when r.resolved_moment = 'won_waiting_start' and r.next_appointment_at is null then 'warning'
        when r.resolved_moment = 'in_treatment' and r.available_balance > 0 and r.next_appointment_at is null then 'warning'
        when r.resolved_moment = 'visited_not_closed' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 14 then 'urgent'
        when r.resolved_moment = 'visited_not_closed' and (v_today - timezone('America/Sao_Paulo', r.resolved_since)::date) >= 7 then 'warning'
        when r.resolved_moment = 'assessment_scheduled' and r.next_appointment_at is null then 'warning'
        else 'none'
      end as resolved_attention,
      case
        when r.followup_due_on is not null and r.followup_due_on < v_today then 'Fazer follow-up atrasado'
        when r.resolved_moment = 'unclassified' then 'Classificar paciente'
        when r.resolved_moment = 'assessment_scheduled' then 'Confirmar e realizar avaliação'
        when r.resolved_moment = 'awaiting_quote' then 'Preparar e enviar orçamento'
        when r.resolved_moment = 'quote_sent' and r.proposal_valid_until is not null and r.proposal_valid_until < v_today then 'Revisar orçamento expirado'
        when r.resolved_moment = 'quote_sent' then 'Acompanhar resposta do orçamento'
        when r.resolved_moment = 'negotiation' then 'Retomar negociação'
        when r.resolved_moment = 'won_waiting_start' and r.next_appointment_at is null then 'Agendar início do tratamento'
        when r.resolved_moment = 'won_waiting_start' then 'Aguardar início do tratamento'
        when r.resolved_moment = 'in_treatment' and r.available_balance > 0 and r.next_appointment_at is null then 'Agendar próxima sessão'
        when r.resolved_moment = 'in_treatment' and r.open_returns_count > 0 then 'Acompanhar retorno clínico'
        when r.resolved_moment = 'in_treatment' then 'Acompanhar tratamento'
        when r.resolved_moment = 'treatment_completed' then 'Manter relacionamento e recorrência'
        when r.resolved_moment = 'visited_not_closed' then 'Tentar recuperação'
        else 'Revisar paciente'
      end as resolved_next_action
    from resolved r
  )
  select
    e.id,
    e.name,
    e.phone,
    e.profession,
    e.photo_url,
    e.resolved_moment,
    e.resolved_source,
    e.resolved_reason,
    e.resolved_since,
    e.resolved_days,
    e.resolved_attention,
    e.resolved_next_action,
    e.deal_id,
    e.deal_stage,
    e.deal_title,
    e.proposal_version_id,
    e.proposal_title,
    e.proposal_total_value,
    e.proposal_status,
    e.proposal_valid_until,
    e.proposal_sent_at,
    e.available_balance,
    e.active_package_title,
    e.next_appointment_at,
    e.last_procedure_at,
    e.open_returns_count,
    e.followup_due_on,
    jsonb_build_object(
      'auto_moment', e.auto_moment,
      'auto_at', e.auto_at,
      'manual_moment', e.manual_moment,
      'manual_at', e.manual_created_at,
      'commercial_moment', e.commercial_moment,
      'commercial_at', e.commercial_at
    )
  from enriched e
  where (p_moment is null or e.resolved_moment = p_moment)
    and (not coalesce(p_attention_only, false) or e.resolved_attention <> 'none')
  order by
    case e.resolved_attention when 'urgent' then 0 when 'warning' then 1 else 2 end,
    e.resolved_days desc,
    e.name;
end;
$$;

create or replace function public.list_patient_journey_history_v1(p_patient_id uuid)
returns table (
  id uuid,
  moment text,
  note text,
  created_at timestamptz,
  created_by uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_SESSION_REQUIRED';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.user_id = v_uid
  ) then
    raise exception using errcode = 'P0001', message = 'PATIENT_JOURNEY_PATIENT_NOT_FOUND';
  end if;

  return query
  select m.id, m.moment, m.note, m.created_at, m.created_by
  from public.patient_journey_manual_events m
  where m.user_id = v_uid and m.patient_id = p_patient_id
  order by m.created_at desc, m.id desc;
end;
$$;

revoke all on function public.set_patient_journey_moment_v1(uuid, text, text) from public, anon;
revoke all on function public.list_patient_journey_v1(text, text, boolean, uuid) from public, anon;
revoke all on function public.list_patient_journey_history_v1(uuid) from public, anon;
grant execute on function public.set_patient_journey_moment_v1(uuid, text, text) to authenticated;
grant execute on function public.list_patient_journey_v1(text, text, boolean, uuid) to authenticated;
grant execute on function public.list_patient_journey_history_v1(uuid) to authenticated;

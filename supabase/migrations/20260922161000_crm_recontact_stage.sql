-- CRM: etapa operacional "Retomar contato" sem alterar o contrato persistido de stages.
-- O deal continua em negotiation e ganha uma data explícita de retomada.
-- Assim integrações existentes que conhecem os stages históricos continuam compatíveis.

begin;

alter table public.deals
  add column if not exists recontact_on date,
  add column if not exists recontact_note text;

alter table public.deals drop constraint if exists deals_recontact_note_length_check;
alter table public.deals
  add constraint deals_recontact_note_length_check
  check (recontact_note is null or char_length(recontact_note) <= 1000);

create index if not exists deals_user_recontact_on_idx
  on public.deals(user_id, recontact_on)
  where recontact_on is not null;

create or replace function public.set_crm_stage_v1(
  p_deal_id uuid,
  p_stage text,
  p_lost_reason text default null,
  p_lost_reason_detail text default null
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $
declare
  v_uid uuid := auth.uid();
  v_recontact_on date;
begin
  if v_uid is null then
    raise exception 'CRM_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'CRM_DEAL_REQUIRED' using errcode = '23514';
  end if;
  if p_stage is null or p_stage <> all(array[
    'new'::text,'contacted'::text,'assessment_scheduled'::text,
    'proposal_sent'::text,'negotiation'::text,'won'::text,'lost'::text
  ]) then
    raise exception 'CRM_STAGE_INVALID' using errcode = '23514';
  end if;
  if p_stage = 'lost' and p_lost_reason is null then
    raise exception 'CRM_LOST_REASON_REQUIRED' using errcode = '23514';
  end if;

  select d.recontact_on
  into v_recontact_on
  from public.deals d
  where d.id = p_deal_id
    and d.user_id = v_uid
  for update;

  if not found then
    raise exception 'CRM_DEAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.deals
  set stage = p_stage,
      lost_reason = case when p_stage = 'lost' then p_lost_reason else null end,
      lost_reason_detail = case when p_stage = 'lost' then nullif(btrim(p_lost_reason_detail), '') else null end,
      recontact_on = null,
      recontact_note = null
  where id = p_deal_id
    and user_id = v_uid;

  -- A retomada cria um único follow-up aberto. Ao sair dessa postura,
  -- cancela esse lembrete para ele não continuar aparecendo em atenção.
  if v_recontact_on is not null then
    update public.crm_followups
    set status = 'cancelled'
    where user_id = v_uid
      and deal_id = p_deal_id
      and status = 'open';
  end if;
end;
$;

create or replace function public.schedule_crm_recontact_v1(
  p_deal_id uuid,
  p_due_on date,
  p_channel text default 'whatsapp',
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_followup_id uuid;
  v_note text := nullif(btrim(p_note), '');
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_uid is null then
    raise exception 'CRM_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_deal_id is null then
    raise exception 'CRM_DEAL_REQUIRED' using errcode = '23514';
  end if;
  if p_due_on is null or p_due_on < v_today then
    raise exception 'CRM_RECONTACT_DATE_INVALID' using errcode = '23514';
  end if;
  if p_channel is not null and p_channel <> all(array['whatsapp'::text,'phone'::text,'instagram'::text,'other'::text]) then
    raise exception 'CRM_RECONTACT_CHANNEL_INVALID' using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'CRM_RECONTACT_NOTE_TOO_LONG' using errcode = '23514';
  end if;

  perform 1
  from public.deals d
  where d.id = p_deal_id
    and d.user_id = v_uid
  for update;
  if not found then
    raise exception 'CRM_DEAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- "Retomar contato" é uma postura operacional da negociação, não um novo
  -- stage persistido. Isso preserva todos os consumidores existentes do CRM.
  update public.deals
  set stage = 'negotiation',
      recontact_on = p_due_on,
      recontact_note = v_note
  where id = p_deal_id
    and user_id = v_uid;

  -- Ao reagendar a próxima retomada, substitui lembretes comerciais ainda
  -- abertos deste acompanhamento para manter uma única próxima ação.
  update public.crm_followups
  set status = 'cancelled'
  where user_id = v_uid
    and deal_id = p_deal_id
    and status = 'open';

  insert into public.crm_followups(user_id, deal_id, due_on, status, channel, note)
  values(v_uid, p_deal_id, p_due_on, 'open', coalesce(p_channel, 'whatsapp'), v_note)
  returning id into v_followup_id;

  insert into public.crm_activities(
    user_id, contact_id, deal_id, activity_type, note, metadata, actor_user_id
  )
  select
    v_uid,
    d.contact_id,
    d.id,
    'note',
    'Retomar contato em ' || to_char(p_due_on, 'DD/MM/YYYY') ||
      case when v_note is not null then ' · ' || v_note else '' end,
    jsonb_build_object('kind','recontact','due_on',p_due_on,'followup_id',v_followup_id),
    v_uid
  from public.deals d
  where d.id = p_deal_id
    and d.user_id = v_uid;

  return v_followup_id;
end;
$$;

revoke all on function public.set_crm_stage_v1(uuid,text,text,text) from public, anon;
grant execute on function public.set_crm_stage_v1(uuid,text,text,text) to authenticated, service_role;
revoke all on function public.schedule_crm_recontact_v1(uuid,date,text,text) from public, anon;
grant execute on function public.schedule_crm_recontact_v1(uuid,date,text,text) to authenticated, service_role;

commit;

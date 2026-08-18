-- Hub Giulia 4.1 — recovery: dispensar a oportunidade mais recente não deve ressuscitar uma antiga.
-- A derivação escolhe primeiro o último cancelamento/no-show elegível da paciente e só então aplica o dismiss.

create or replace view public.appointment_recovery_opportunity_sources_v1
with (security_invoker=true)
as
with ranked as (
  select
    a.*,
    coalesce(a.canceled_at,a.no_show_at,a.updated_at,a.scheduled_at) as recovery_at,
    row_number() over (
      partition by a.user_id,a.patient_id
      order by coalesce(a.canceled_at,a.no_show_at,a.updated_at,a.scheduled_at) desc,a.id desc
    ) as rn
  from public.appointments a
  where a.user_id=(select auth.uid())
    and a.status in ('cancelado','nao_compareceu')
    and coalesce(a.canceled_at,a.no_show_at,a.updated_at,a.scheduled_at)>=timestamptz '2026-08-18 12:44:00-03'
    and not exists (
      select 1 from public.appointments future
      where future.user_id=a.user_id
        and future.patient_id=a.patient_id
        and future.status in ('pendente','confirmado')
        and future.scheduled_at>now()
    )
)
select
  pc.user_id,pc.person_type,pc.person_id,pc.patient_id,pc.contact_id,pc.display_name,pc.phone,
  pc.last_visit_at,pc.next_appointment_at,pc.last_contact_at,pc.snoozed_until,
  'recovery:'||a.id::text as opportunity_key,
  'reschedule'::text as opportunity_type,
  case when a.status='nao_compareceu' then 'appointment_no_show_recovery' else 'appointment_cancel_recovery' end::text as priority_class,
  425::integer as priority_rank,
  a.recovery_at as sort_at,
  case when a.status='nao_compareceu' then 'Não compareceu ao atendimento de ' else 'Cancelou o atendimento de ' end
    || to_char(a.scheduled_at at time zone 'America/Sao_Paulo','DD/MM') as label,
  'appointment'::text as source_type,
  a.id as source_id,
  'open'::text as status,
  null::date as due_date,
  greatest(0,floor(extract(epoch from now()-a.recovery_at)/86400))::integer as age_days,
  null::numeric as amount,
  null::jsonb as remaining,
  null::date as expires_on,
  '/agenda?patient_id='||a.patient_id::text||case when a.service_id is null then '' else '&service_id='||a.service_id::text end as route,
  'recovery:appointment:'||a.id::text as communication_item_key,
  'appointment_recovery'::text as template_key,
  jsonb_build_object(
    'appointment_status',a.status,
    'scheduled_at',a.scheduled_at,
    'recovery_at',a.recovery_at,
    'cancellation_reason',a.cancellation_reason,
    'service_id',a.service_id,
    'service_name',s.name
  ) as context
from ranked a
join public.relationship_person_context_v1 pc
  on pc.user_id=a.user_id and pc.person_type='patient' and pc.patient_id=a.patient_id
left join public.services s on s.id=a.service_id and s.user_id=a.user_id
where a.rn=1
  and not exists (
    select 1 from public.appointment_recovery_dismissals d
    where d.user_id=a.user_id and d.appointment_id=a.id
  );

revoke all on public.appointment_recovery_opportunity_sources_v1 from public,anon,authenticated;

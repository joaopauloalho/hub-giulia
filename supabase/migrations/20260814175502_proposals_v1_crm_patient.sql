begin;

alter table public.crm_activities drop constraint if exists crm_activities_type_check;
alter table public.crm_activities add constraint crm_activities_type_check check (
  activity_type in (
    'note','contact','whatsapp_opened','call','stage_changed','followup_created','followup_completed','followup_cancelled','patient_linked',
    'proposal_created','proposal_issued','proposal_sent','proposal_accepted','proposal_declined','proposal_revised','proposal_voided'
  )
);

create or replace view public.treatment_proposal_summary_v
with (security_invoker = true)
as
select
  p.id as proposal_id,
  p.user_id,
  p.deal_id,
  p.name as proposal_name,
  p.created_at as proposal_created_at,
  p.updated_at as proposal_updated_at,
  v.id as version_id,
  v.version_number,
  v.status,
  case
    when v.status='issued' and v.valid_until < (now() at time zone 'America/Sao_Paulo')::date then 'expired'
    else v.status
  end as effective_status,
  v.title,
  v.currency,
  v.subtotal,
  v.item_discount_amount,
  v.net_subtotal,
  v.discount_amount,
  v.total_value,
  v.valid_until,
  v.issued_at,
  v.sent_at,
  v.accepted_at,
  v.declined_at,
  v.voided_at,
  v.pdf_path,
  v.pdf_sha256
from public.treatment_proposals p
join lateral (
  select pv.*
  from public.treatment_proposal_versions pv
  where pv.proposal_id=p.id and pv.user_id=p.user_id
  order by pv.version_number desc
  limit 1
) v on true;

grant select on public.treatment_proposal_summary_v to authenticated;
revoke all on public.treatment_proposal_summary_v from anon;

create or replace view public.crm_pipeline_v
with (security_invoker = true)
as
select
  d.id as deal_id,
  d.user_id,
  d.contact_id,
  d.title,
  d.value as estimated_value,
  d.stage,
  d.expected_close,
  d.lost_reason,
  d.lost_reason_detail,
  d.won_at,
  d.lost_at,
  d.closed_at,
  d.created_at as deal_created_at,
  d.updated_at as deal_updated_at,
  c.patient_id,
  c.name as contact_name,
  c.phone,
  c.email,
  c.instagram,
  c.source,
  c.source_detail,
  c.archived_at as contact_archived_at,
  pat.name as patient_name,
  coalesce(i.interests,'[]'::jsonb) as interests,
  f.next_followup_on,
  a.last_activity_at,
  q.proposal_id,
  q.version_id as proposal_version_id,
  q.title as proposal_title,
  q.version_number as proposal_version_number,
  q.status as proposal_status,
  q.effective_status as proposal_effective_status,
  q.total_value as proposal_total_value,
  q.valid_until as proposal_valid_until,
  q.sent_at as proposal_sent_at
from public.deals d
join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
left join public.patients pat on pat.id=c.patient_id and pat.user_id=c.user_id
left join lateral (
  select jsonb_agg(jsonb_build_object('id',x.id,'service_id',x.service_id,'label',x.label_snapshot) order by x.created_at,x.id) as interests
  from public.crm_deal_interests x
  where x.user_id=d.user_id and x.deal_id=d.id
) i on true
left join lateral (
  select min(fu.due_on) as next_followup_on
  from public.crm_followups fu
  where fu.user_id=d.user_id and fu.deal_id=d.id and fu.status='open'
) f on true
left join lateral (
  select max(ac.occurred_at) as last_activity_at
  from public.crm_activities ac
  where ac.user_id=d.user_id and ac.deal_id=d.id
) a on true
left join lateral (
  select s.*
  from public.treatment_proposal_summary_v s
  where s.user_id=d.user_id and s.deal_id=d.id
  order by s.proposal_updated_at desc,s.proposal_id desc
  limit 1
) q on true;

grant select on public.crm_pipeline_v to authenticated;
revoke all on public.crm_pipeline_v from anon;

create or replace function public.list_patient_treatment_proposals_v1(p_patient_id uuid)
returns table(
  proposal_id uuid,
  deal_id uuid,
  proposal_name text,
  version_id uuid,
  version_number integer,
  status text,
  effective_status text,
  title text,
  total_value numeric,
  valid_until date,
  issued_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  pdf_path text
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select s.proposal_id,s.deal_id,s.proposal_name,s.version_id,s.version_number,s.status,s.effective_status,
         s.title,s.total_value,s.valid_until,s.issued_at,s.sent_at,s.accepted_at,s.declined_at,s.pdf_path
  from public.treatment_proposal_summary_v s
  join public.deals d on d.id=s.deal_id and d.user_id=s.user_id
  join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
  where s.user_id=auth.uid() and c.patient_id=p_patient_id
  order by coalesce(s.accepted_at,s.sent_at,s.issued_at,s.proposal_updated_at) desc,s.proposal_id desc;
$$;

revoke all on function public.list_patient_treatment_proposals_v1(uuid) from public, anon;
grant execute on function public.list_patient_treatment_proposals_v1(uuid) to authenticated;

create or replace function public.list_patient_timeline_v4(
  p_patient_id uuid,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
) returns table(event_key text,event_type text,occurred_at timestamptz,title text,subtitle text,source_id uuid,metadata jsonb)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  if v_uid is null then raise exception 'PATIENT_360_SESSION_REQUIRED'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_uid) then raise exception 'PATIENT_360_NOT_FOUND'; end if;
  return query
  with existing_events as (
    select e.* from public.list_patient_timeline_v3(p_patient_id,50,p_cursor_at,p_cursor_key) e
  ), proposal_events as (
    select
      'proposal:'||v.id::text||':sent' as event_key,
      'proposal'::text as event_type,
      v.sent_at as occurred_at,
      'Proposta enviada'::text as title,
      (v.title||' · '||to_char(v.total_value,'FM999G999G990D00'))::text as subtitle,
      v.id as source_id,
      jsonb_build_object('proposal_id',p.id,'deal_id',p.deal_id,'version_number',v.version_number,'status',v.status,'total_value',v.total_value) as metadata
    from public.treatment_proposals p
    join public.deals d on d.id=p.deal_id and d.user_id=p.user_id
    join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
    join public.treatment_proposal_versions v on v.proposal_id=p.id and v.user_id=p.user_id
    where p.user_id=v_uid and c.patient_id=p_patient_id and v.sent_at is not null
    union all
    select
      'proposal:'||v.id::text||':accepted','proposal',v.accepted_at,'Proposta aceita',
      (v.title||' · '||to_char(v.total_value,'FM999G999G990D00'))::text,v.id,
      jsonb_build_object('proposal_id',p.id,'deal_id',p.deal_id,'version_number',v.version_number,'status',v.status,'total_value',v.total_value)
    from public.treatment_proposals p
    join public.deals d on d.id=p.deal_id and d.user_id=p.user_id
    join public.contacts c on c.id=d.contact_id and c.user_id=d.user_id
    join public.treatment_proposal_versions v on v.proposal_id=p.id and v.user_id=p.user_id
    where p.user_id=v_uid and c.patient_id=p_patient_id and v.accepted_at is not null
  ), events as (
    select * from existing_events
    union all select * from proposal_events
  )
  select e.event_key,e.event_type,e.occurred_at,e.title,e.subtitle,e.source_id,e.metadata
  from events e
  where e.occurred_at is not null
    and (p_cursor_at is null or e.occurred_at<p_cursor_at or (e.occurred_at=p_cursor_at and e.event_key<coalesce(p_cursor_key,'')))
  order by e.occurred_at desc,e.event_key desc
  limit v_limit;
end;
$$;

revoke all on function public.list_patient_timeline_v4(uuid,integer,timestamptz,text) from public, anon;
grant execute on function public.list_patient_timeline_v4(uuid,integer,timestamptz,text) to authenticated;

commit;

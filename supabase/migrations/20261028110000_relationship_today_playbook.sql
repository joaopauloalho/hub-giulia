-- Stage 3: daily commercial playbook, with exactly one ranked opportunity per patient.
begin;
create table if not exists public.relationship_today_actions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 patient_id uuid not null references public.patients(id),
 outcome text not null check (outcome in ('spoke','no_reply','scheduled')),
 message_id uuid null references public.communication_messages(id),
 idempotency_key uuid not null,
 occurred_at timestamptz not null default now(),
 unique(user_id,idempotency_key)
);
alter table public.relationship_today_actions enable row level security;
create policy relationship_today_actions_read_own on public.relationship_today_actions
 for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.relationship_today_actions from public,anon;
grant select on public.relationship_today_actions to authenticated;
create index if not exists relationship_today_actions_user_day_idx on public.relationship_today_actions(user_id,occurred_at);

create or replace function public.relationship_today_v1(p_limit integer default 100)
returns table(
 patient_id uuid, first_name text, phone text, motive text, service_name text,
 days_since_last_visit integer, days_since_last_contact integer,
 estimated_amount numeric, whatsapp_opt_in boolean, suggested_message text,
 source_type text, source_id uuid, opportunity_type text, due_date date,
 last_contact_at timestamptz, service_id uuid
)
language sql stable security definer set search_path=public,pg_temp as $$
with session as (select auth.uid() uid,(now() at time zone 'America/Sao_Paulo')::date today),
candidates as (
 select s.*,
 case
  when s.opportunity_type='return' and s.status='overdue' then 700
  when s.opportunity_type='maintenance_due' and s.status='overdue' then 600
  when s.opportunity_type='voucher_conversion' then 500
  when s.opportunity_type='credit' and s.priority_class='credit_expiry' then 400
  when s.opportunity_type='proposal' then 300
  when s.opportunity_type='payment' and s.status='overdue' then 200
  when s.opportunity_type='reactivation' then 100
  else 0 end as today_priority,
 row_number() over (partition by s.patient_id order by
   case
    when s.opportunity_type='return' and s.status='overdue' then 700
    when s.opportunity_type='maintenance_due' and s.status='overdue' then 600
    when s.opportunity_type='voucher_conversion' then 500
    when s.opportunity_type='credit' and s.priority_class='credit_expiry' then 400
    when s.opportunity_type='proposal' then 300
    when s.opportunity_type='payment' and s.status='overdue' then 200
    when s.opportunity_type='reactivation' then 100
    else 0 end desc,
   s.amount desc nulls last,s.opportunity_key) as person_rank
 from public.relationship_opportunity_sources_v1 s
 join session x on x.uid is not null and x.uid=s.user_id
 where s.patient_id is not null and s.next_appointment_at is null
  and (s.snoozed_until is null or s.snoozed_until<=now())
  and (s.last_contact_at is null or s.last_contact_at<=now()-interval '7 days')
),
ranked as (
 select c.*,pt.name as patient_name,pt.phone as patient_phone,
 coalesce((to_jsonb(pt)->>'whatsapp_opt_in')::boolean,false) consent,
 (to_jsonb(pt)->>'whatsapp_opt_out_at') as opt_out_at
 from candidates c join public.patients pt on pt.id=c.patient_id and pt.user_id=c.user_id and pt.archived_at is null
 where c.today_priority>0 and c.person_rank=1
)
select c.patient_id,
 split_part(btrim(c.patient_name),' ',1),
 coalesce(c.patient_phone,c.phone),
 c.label,
 coalesce(c.context->>'service_name',c.context->>'package_title','Atendimento na clínica'),
 case when c.last_visit_at is null then null else
  (x.today-(c.last_visit_at at time zone 'America/Sao_Paulo')::date)::integer end,
 case when c.last_contact_at is null then null else
  (x.today-(c.last_contact_at at time zone 'America/Sao_Paulo')::date)::integer end,
 c.amount,c.consent,
 'Oi, '||split_part(btrim(c.patient_name),' ',1)||'! Tudo bem? Aqui é da Clínica Dra. Giulia Assis. Temos uma novidade especial e lembrei de você. Posso te contar? 😊',
 c.source_type,c.source_id,c.opportunity_type,c.due_date,c.last_contact_at,
 case when (c.context->>'service_id') ~ '^[0-9a-fA-F-]{36}$' then (c.context->>'service_id')::uuid
      when c.source_type='service' then c.source_id else null end
from ranked c cross join session x
where c.opt_out_at is null
order by c.today_priority desc,c.amount desc nulls last,c.patient_name
limit greatest(1,least(coalesce(p_limit,100),250));
$$;
revoke all on function public.relationship_today_v1(integer) from public,anon;
grant execute on function public.relationship_today_v1(integer) to authenticated;

-- Existing canonical contact RPC continues to record the actual manual contact.
-- This wrapper adds its outcome, mirrors it in CRM and a day scorecard.
create or replace function public.record_relationship_today_outcome_v1(
 p_patient_id uuid,p_outcome text,p_message_body text,p_idempotency_key uuid
)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_uid uuid:=auth.uid();
 v_phone text;
 v_message_id uuid;
 v_contact_id uuid;
 v_row_id uuid;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_idempotency_key is null or p_outcome not in ('spoke','no_reply','scheduled') then
   raise exception 'INVALID_OUTCOME' using errcode='22023';
 end if;
 if exists(select 1 from public.relationship_today_actions where user_id=v_uid and idempotency_key=p_idempotency_key) then return; end if;
 select p.phone into v_phone from public.patients p where p.id=p_patient_id and p.user_id=v_uid and p.archived_at is null;
 if not found then raise exception 'PATIENT_NOT_FOUND' using errcode='42501'; end if;
 if v_phone is null or btrim(v_phone)='' then raise exception 'PATIENT_PHONE_REQUIRED'; end if;
 select cm.message_id into v_message_id
 from public.record_relationship_manual_contact_v1(p_patient_id,v_phone,
   coalesce(nullif(btrim(p_message_body),''),'Contato de acompanhamento da clínica.'),
   p_idempotency_key) cm limit 1;
 insert into public.relationship_today_actions(user_id,patient_id,outcome,message_id,idempotency_key)
 values(v_uid,p_patient_id,p_outcome,v_message_id,p_idempotency_key)
 on conflict (user_id,idempotency_key) do nothing returning id into v_row_id;
 if v_row_id is null then return; end if;
 select c.id into v_contact_id from public.contacts c
 where c.user_id=v_uid and c.patient_id=p_patient_id and c.archived_at is null order by c.created_at desc limit 1;
 if v_contact_id is not null then
  -- The canonical RPC may already have inserted an activity; label that record instead of duplicating it.
  update public.crm_activities a
  set channel='whatsapp',
      metadata=coalesce(a.metadata,'{}'::jsonb)||jsonb_build_object('outcome',p_outcome,'context','relationship_today')
  where a.user_id=v_uid and a.contact_id=v_contact_id
    and a.activity_type='contact' and a.metadata->>'communication_message_id'=v_message_id::text;
  if not found then
   insert into public.crm_activities(user_id,contact_id,activity_type,channel,note,metadata,actor_user_id)
   values(v_uid,v_contact_id,'contact','whatsapp','Contato da fila Hoje',
     jsonb_build_object('outcome',p_outcome,'context','relationship_today','communication_message_id',v_message_id),v_uid);
  end if;
 end if;
end;
$$;
revoke all on function public.record_relationship_today_outcome_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.record_relationship_today_outcome_v1(uuid,text,text,uuid) to authenticated;
commit;

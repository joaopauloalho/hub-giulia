create table if not exists public.relationship_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  returns_enabled boolean not null default true,
  proposals_enabled boolean not null default true,
  credits_enabled boolean not null default true,
  reactivation_enabled boolean not null default true,
  reactivation_after_days integer not null default 180 check (reactivation_after_days between 30 and 1460),
  recent_contact_cooldown_days integer not null default 7 check (recent_contact_cooldown_days between 0 and 90),
  updated_at timestamptz not null default now()
);

alter table public.relationship_preferences enable row level security;
drop policy if exists relationship_preferences_own on public.relationship_preferences;
create policy relationship_preferences_own on public.relationship_preferences for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on table public.relationship_preferences from anon;
grant select, insert, update, delete on table public.relationship_preferences to authenticated;

alter table public.communication_templates drop constraint if exists communication_templates_template_key_check;
alter table public.communication_templates add constraint communication_templates_template_key_check check (template_key = any (array['appointment_confirmation'::text,'crm_followup'::text,'proposal_followup'::text,'procedure_return'::text,'package_expiry'::text,'aftercare_instructions'::text,'post_procedure_checkin'::text,'relationship_reactivation'::text]));
alter table public.communication_messages drop constraint if exists communication_messages_context_check;
alter table public.communication_messages add constraint communication_messages_context_check check (context = any (array['appointment_confirmation'::text,'crm_followup'::text,'procedure_return'::text,'proposal_followup'::text,'package_expiry'::text,'aftercare_instructions'::text,'post_procedure_checkin'::text,'relationship_reactivation'::text]));
alter table public.communication_messages drop constraint if exists communication_messages_source_type_check;
alter table public.communication_messages add constraint communication_messages_source_type_check check (source_type = any (array['appointment'::text,'crm_followup'::text,'procedure_return'::text,'proposal_version'::text,'package'::text,'procedure_followup_plan'::text,'procedure_followup_task'::text,'relationship_patient'::text]));
alter table public.communication_messages drop constraint if exists communication_messages_context_source_check;
alter table public.communication_messages add constraint communication_messages_context_source_check check (((context='appointment_confirmation') and (source_type='appointment')) or ((context='crm_followup') and (source_type='crm_followup')) or ((context='procedure_return') and (source_type='procedure_return')) or ((context='proposal_followup') and (source_type='proposal_version')) or ((context='package_expiry') and (source_type='package')) or ((context='aftercare_instructions') and (source_type='procedure_followup_plan')) or ((context='post_procedure_checkin') and (source_type='procedure_followup_task')) or ((context='relationship_reactivation') and (source_type='relationship_patient')));
alter table public.communication_messages drop constraint if exists communication_messages_template_key_check;
alter table public.communication_messages add constraint communication_messages_template_key_check check (template_key is null or template_key = any (array['appointment_confirmation'::text,'crm_followup'::text,'proposal_followup'::text,'procedure_return'::text,'package_expiry'::text,'aftercare_instructions'::text,'post_procedure_checkin'::text,'relationship_reactivation'::text]));

create or replace function public.record_relationship_manual_contact_v1(p_patient_id uuid,p_recipient_phone text,p_message_body text,p_idempotency_key uuid)
returns table(message_id uuid,sent_at timestamptz,was_created boolean)
language plpgsql security definer set search_path='public','pg_temp' as $function$
declare
  v_uid uuid:=auth.uid(); v_patient public.patients%rowtype; v_contact_id uuid; v_phone text; v_message_id uuid; v_sent_at timestamptz; v_created boolean:=false; v_item_key text; v_person_key text;
begin
  if v_uid is null then raise exception 'RELATIONSHIP_SESSION_REQUIRED'; end if;
  if p_patient_id is null then raise exception 'RELATIONSHIP_PATIENT_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'RELATIONSHIP_IDEMPOTENCY_REQUIRED'; end if;
  if nullif(btrim(p_message_body),'') is null then raise exception 'RELATIONSHIP_MESSAGE_REQUIRED'; end if;
  if length(p_message_body)>12000 then raise exception 'RELATIONSHIP_MESSAGE_TOO_LONG'; end if;
  select p.* into v_patient from public.patients p where p.id=p_patient_id and p.user_id=v_uid and p.archived_at is null;
  if not found then raise exception 'RELATIONSHIP_PATIENT_NOT_FOUND'; end if;
  v_phone:=regexp_replace(coalesce(p_recipient_phone,''),'\D','','g');
  if v_phone !~ '^[0-9]{8,15}$' then raise exception 'RELATIONSHIP_PHONE_INVALID'; end if;
  select c.id into v_contact_id from public.contacts c where c.user_id=v_uid and c.patient_id=p_patient_id and c.archived_at is null order by c.created_at desc limit 1;
  v_item_key:='relationship:patient:'||p_patient_id::text||':reactivation'; v_person_key:='relationship:patient:'||p_patient_id::text;
  insert into public.communication_messages(user_id,patient_id,contact_id,channel,direction,context,source_type,source_id,item_key,template_key,recipient_phone_snapshot,message_body_snapshot,status,sent_at,idempotency_key)
  values(v_uid,p_patient_id,v_contact_id,'whatsapp','outbound','relationship_reactivation','relationship_patient',p_patient_id,v_item_key,'relationship_reactivation',v_phone,p_message_body,'sent_manual',now(),p_idempotency_key)
  on conflict(user_id,idempotency_key) do nothing returning id,communication_messages.sent_at into v_message_id,v_sent_at;
  if v_message_id is not null then v_created:=true; else select m.id,m.sent_at into v_message_id,v_sent_at from public.communication_messages m where m.user_id=v_uid and m.idempotency_key=p_idempotency_key; if v_message_id is null then raise exception 'RELATIONSHIP_CONTACT_RECORD_FAILED'; end if; end if;
  insert into public.communication_attention_state(user_id,item_key,last_contacted_at,snoozed_until,updated_at) values(v_uid,v_person_key,v_sent_at,null,now())
  on conflict(user_id,item_key) do update set last_contacted_at=greatest(coalesce(public.communication_attention_state.last_contacted_at,excluded.last_contacted_at),excluded.last_contacted_at),snoozed_until=null,updated_at=now();
  if v_created and v_contact_id is not null then
    insert into public.crm_activities(user_id,contact_id,activity_type,channel,note,metadata,actor_user_id,occurred_at)
    values(v_uid,v_contact_id,'contact','whatsapp','Contato de relacionamento registrado',jsonb_build_object('communication_message_id',v_message_id,'context','relationship_reactivation','source_type','relationship_patient','source_id',p_patient_id),v_uid,v_sent_at);
  end if;
  return query select v_message_id,v_sent_at,v_created;
end;
$function$;
revoke all on function public.record_relationship_manual_contact_v1(uuid,text,text,uuid) from public,anon;
grant execute on function public.record_relationship_manual_contact_v1(uuid,text,text,uuid) to authenticated;

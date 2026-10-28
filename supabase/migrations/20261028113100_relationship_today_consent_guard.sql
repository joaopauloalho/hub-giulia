begin;
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
 if p_outcome='scheduled' and not public.relationship_today_opt_in_required_v1(p_patient_id) then
   insert into public.relationship_today_actions(user_id,patient_id,outcome,idempotency_key)
   values(v_uid,p_patient_id,'scheduled',p_idempotency_key) on conflict(user_id,idempotency_key) do nothing;
   return;
 end if;
 if not public.relationship_today_opt_in_required_v1(p_patient_id) then raise exception 'WHATSAPP_CONSENT_REQUIRED' using errcode='42501'; end if;
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

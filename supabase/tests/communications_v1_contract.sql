-- Hub Giulia 3.4 communication security/contract checks.
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from pg_class
  where oid in (
    'public.communication_preferences'::regclass,
    'public.communication_templates'::regclass,
    'public.communication_attention_state'::regclass,
    'public.communication_messages'::regclass
  ) and relrowsecurity;
  if v_count <> 4 then raise exception 'COMMUNICATION_RLS_TABLES_INVALID:%', v_count; end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where grantee='anon' and table_schema='public'
    and table_name in ('communication_preferences','communication_templates','communication_attention_state','communication_messages');
  if v_count <> 0 then raise exception 'COMMUNICATION_ANON_TABLE_GRANTS:%', v_count; end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where grantee='authenticated' and table_schema='public' and table_name='communication_messages'
    and privilege_type in ('INSERT','UPDATE','DELETE');
  if v_count <> 0 then raise exception 'COMMUNICATION_MESSAGE_DIRECT_WRITE_GRANTS:%', v_count; end if;

  select count(*) into v_count
  from public.communication_messages m join public.patients p on p.id=m.patient_id
  where m.patient_id is not null and p.user_id<>m.user_id;
  if v_count <> 0 then raise exception 'COMMUNICATION_CROSS_TENANT_PATIENT:%',v_count; end if;

  select count(*) into v_count
  from public.communication_messages m join public.contacts c on c.id=m.contact_id
  where m.contact_id is not null and c.user_id<>m.user_id;
  if v_count <> 0 then raise exception 'COMMUNICATION_CROSS_TENANT_CONTACT:%',v_count; end if;

  select count(*) into v_count
  from public.communication_attention_state
  group by user_id,item_key having count(*)>1;
  if coalesce(v_count,0) <> 0 then raise exception 'COMMUNICATION_DUPLICATE_ATTENTION_STATE'; end if;

  if has_function_privilege('anon','public.record_manual_communication_v1(text,uuid,text,text,text,text,text,uuid)','EXECUTE') then
    raise exception 'COMMUNICATION_ANON_RECORD_RPC_EXECUTE';
  end if;
end $$;

select p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
  'list_communication_attention_v1','get_communication_attention_counts_v1',
  'list_patient_communications_v1','record_manual_communication_v1'
)
order by p.proname;

-- Hub Giulia 3.6 Photos 2.0 contract checks. Read-only assertions.
do $$
begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='patient_photo_sessions' and c.relrowsecurity) then
    raise exception 'patient_photo_sessions RLS must be enabled';
  end if;
  if not exists(select 1 from storage.buckets where id='patient-photos' and public=false) then
    raise exception 'patient-photos bucket must remain private';
  end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'patient_photos%' and cmd='UPDATE') then
    raise exception 'clinical photo storage must not permit UPDATE/overwrite';
  end if;
  if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='patient_photos_delete_unregistered_v2' and cmd='DELETE') then
    raise exception 'safe orphan cleanup policy missing';
  end if;
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('list_patient_photo_sessions_v1','list_photo_session_counts_by_procedure_v1') and p.prosecdef
  ) then
    raise exception 'Photos read models must be SECURITY INVOKER';
  end if;
  if has_table_privilege('anon','public.patient_photo_sessions','SELECT') then
    raise exception 'anon must not read photo sessions';
  end if;
  if has_table_privilege('authenticated','public.patient_photos','DELETE') then
    raise exception 'authenticated must not hard-delete registered clinical photos';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='patient_photos' and column_name='sha256') then
    raise exception 'sha256 metadata missing';
  end if;
end $$;

select
  (select count(*) from public.patient_photos p join public.patients pt on pt.id=p.patient_id where pt.user_id<>p.user_id)::int as cross_tenant_patient_photo,
  (select count(*) from public.patient_photo_sessions s join public.patients pt on pt.id=s.patient_id where pt.user_id<>s.user_id)::int as cross_tenant_session_patient,
  (select count(*) from public.patient_photo_sessions s join public.appointments a on a.id=s.appointment_id where s.appointment_id is not null and (a.user_id<>s.user_id or a.patient_id<>s.patient_id))::int as invalid_appointment_link,
  (select count(*) from public.patient_photo_sessions s join public.procedures p on p.id=s.procedure_id where s.procedure_id is not null and (p.user_id<>s.user_id or p.patient_id<>s.patient_id))::int as invalid_procedure_link,
  (select count(*) from public.patient_photo_sessions s join public.services sv on sv.id=s.service_id where s.service_id is not null and sv.user_id<>s.user_id)::int as invalid_service_link,
  (select count(*) from public.patient_photos p join public.patient_photo_sessions s on s.id=p.photo_session_id where p.photo_session_id is not null and (s.user_id<>p.user_id or s.patient_id<>p.patient_id))::int as invalid_photo_session_owner;

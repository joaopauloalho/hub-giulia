-- A data exibida na galeria é informação clínica digitável pela profissional.
-- Os bytes, paths, hash, formato, dimensões e demais dados canônicos continuam imutáveis.
create or replace function public.photos_v2_validate_photo_context()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_session public.patient_photo_sessions%rowtype;
  v_expected_prefix text;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'PATIENT_PHOTO_OWNER_MISMATCH'; end if;
  if not exists(select 1 from public.patients p where p.id=new.patient_id and p.user_id=new.user_id) then raise exception 'PATIENT_PHOTO_PATIENT_MISMATCH'; end if;

  if new.photo_session_id is not null then
    select * into v_session from public.patient_photo_sessions s
    where s.id=new.photo_session_id and s.user_id=new.user_id and s.patient_id=new.patient_id and s.voided_at is null;
    if not found then raise exception 'PATIENT_PHOTO_SESSION_MISMATCH'; end if;

    if tg_op='UPDATE' and old.photo_session_id is distinct from new.photo_session_id then
      new.appointment_id:=v_session.appointment_id;
      new.procedure_id:=v_session.procedure_id;
      new.service_id:=v_session.service_id;
    else
      if new.appointment_id is null then new.appointment_id:=v_session.appointment_id; elsif v_session.appointment_id is not null and new.appointment_id is distinct from v_session.appointment_id then raise exception 'PATIENT_PHOTO_APPOINTMENT_MISMATCH'; end if;
      if new.procedure_id is null then new.procedure_id:=v_session.procedure_id; elsif v_session.procedure_id is not null and new.procedure_id is distinct from v_session.procedure_id then raise exception 'PATIENT_PHOTO_PROCEDURE_MISMATCH'; end if;
      if new.service_id is null then new.service_id:=v_session.service_id; elsif v_session.service_id is not null and new.service_id is distinct from v_session.service_id then raise exception 'PATIENT_PHOTO_SERVICE_MISMATCH'; end if;
    end if;
  end if;

  if new.appointment_id is not null and not exists(select 1 from public.appointments a where a.id=new.appointment_id and a.user_id=new.user_id and a.patient_id=new.patient_id) then raise exception 'PATIENT_PHOTO_APPOINTMENT_OWNER_MISMATCH'; end if;
  if new.procedure_id is not null and not exists(select 1 from public.procedures p where p.id=new.procedure_id and p.user_id=new.user_id and p.patient_id=new.patient_id) then raise exception 'PATIENT_PHOTO_PROCEDURE_OWNER_MISMATCH'; end if;
  if new.service_id is not null and not exists(select 1 from public.services s where s.id=new.service_id and s.user_id=new.user_id) then raise exception 'PATIENT_PHOTO_SERVICE_OWNER_MISMATCH'; end if;

  if new.source_type<>'legacy' then
    v_expected_prefix:=new.user_id::text||'/patients/'||new.patient_id::text||'/photos/'||new.id::text||'/';
    if new.original_path is null or new.preview_path is null or new.thumbnail_path is null or new.sha256 is null or new.mime_type not in ('image/jpeg','image/png') or new.width is null or new.height is null or new.size_bytes is null or new.client_upload_id is null or new.canonicalized_at is null then raise exception 'PATIENT_PHOTO_CANONICAL_METADATA_REQUIRED'; end if;
    if left(new.original_path,length(v_expected_prefix))<>v_expected_prefix or left(new.preview_path,length(v_expected_prefix))<>v_expected_prefix or left(new.thumbnail_path,length(v_expected_prefix))<>v_expected_prefix then raise exception 'PATIENT_PHOTO_PATH_INVALID'; end if;
    new.photo_url:=new.original_path;
  elsif new.original_path is null then
    new.original_path:=new.photo_url;
  end if;

  if tg_op='UPDATE' then
    if old.id is distinct from new.id
      or old.user_id is distinct from new.user_id
      or old.patient_id is distinct from new.patient_id
      or old.photo_url is distinct from new.photo_url
      or old.original_path is distinct from new.original_path
      or old.preview_path is distinct from new.preview_path
      or old.thumbnail_path is distinct from new.thumbnail_path
      or old.mime_type is distinct from new.mime_type
      or old.width is distinct from new.width
      or old.height is distinct from new.height
      or old.size_bytes is distinct from new.size_bytes
      or old.sha256 is distinct from new.sha256
      or old.source_type is distinct from new.source_type
      or old.client_upload_id is distinct from new.client_upload_id
      or old.canonicalized_at is distinct from new.canonicalized_at
    then
      raise exception 'PATIENT_PHOTO_CANONICAL_IMMUTABLE';
    end if;
    if old.voided_at is not null and new.voided_at is null then raise exception 'PATIENT_PHOTO_VOID_IS_FINAL'; end if;
    if old.voided_at is null and new.voided_at is not null then
      new.voided_by:=auth.uid();
      if length(trim(coalesce(new.void_reason,'')))<3 then raise exception 'PATIENT_PHOTO_VOID_REASON_REQUIRED'; end if;
    end if;
  end if;
  return new;
end;
$$;

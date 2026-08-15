-- Hub Giulia 3.6 — Fotos & Evolução Clínica 2.0
-- Additive model: existing patient_photos stays the source of truth for individual assets.
-- New patient_photo_sessions groups photos without inventing metadata for legacy rows.

create table public.patient_photo_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid,
  procedure_id uuid,
  service_id uuid,
  service_name_snapshot text,
  session_type text not null default 'other' check (session_type in ('baseline','pre_procedure','immediate_post','followup','progress','other')),
  capture_set text not null default 'free' check (capture_set in ('face_standard','free')),
  title text,
  captured_at timestamptz not null default now(),
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references auth.users(id),
  constraint patient_photo_sessions_patient_owner_fkey foreign key (patient_id,user_id) references public.patients(id,user_id),
  constraint patient_photo_sessions_appointment_owner_fkey foreign key (appointment_id,user_id) references public.appointments(id,user_id),
  constraint patient_photo_sessions_procedure_owner_fkey foreign key (procedure_id,user_id) references public.procedures(id,user_id),
  constraint patient_photo_sessions_service_owner_fkey foreign key (service_id,user_id) references public.services(id,user_id),
  constraint patient_photo_sessions_void_reason_check check (voided_at is null or (voided_by is not null and length(trim(coalesce(void_reason,'')))>=3))
);

create unique index patient_photo_sessions_id_user_id_uidx on public.patient_photo_sessions(id,user_id);
create index patient_photo_sessions_user_patient_captured_idx on public.patient_photo_sessions(user_id,patient_id,captured_at desc,id desc) where voided_at is null;
create index patient_photo_sessions_user_appointment_idx on public.patient_photo_sessions(user_id,appointment_id) where appointment_id is not null and voided_at is null;
create index patient_photo_sessions_user_procedure_idx on public.patient_photo_sessions(user_id,procedure_id) where procedure_id is not null and voided_at is null;
create index patient_photo_sessions_user_service_idx on public.patient_photo_sessions(user_id,service_id,captured_at desc) where service_id is not null and voided_at is null;

alter table public.patient_photos
  add column photo_session_id uuid,
  add column appointment_id uuid,
  add column service_id uuid,
  add column angle text,
  add column region text,
  add column pose text,
  add column caption text,
  add column original_path text,
  add column preview_path text,
  add column thumbnail_path text,
  add column mime_type text,
  add column width integer,
  add column height integer,
  add column size_bytes bigint,
  add column sha256 text,
  add column source_type text not null default 'legacy',
  add column client_upload_id uuid,
  add column canonicalized_at timestamptz,
  add column voided_at timestamptz,
  add column void_reason text,
  add column voided_by uuid references auth.users(id);

alter table public.patient_photos
  add constraint patient_photos_session_owner_fkey foreign key (photo_session_id,user_id) references public.patient_photo_sessions(id,user_id),
  add constraint patient_photos_appointment_owner_v2_fkey foreign key (appointment_id,user_id) references public.appointments(id,user_id),
  add constraint patient_photos_service_owner_v2_fkey foreign key (service_id,user_id) references public.services(id,user_id),
  add constraint patient_photos_angle_check check (angle is null or angle in ('front','left_45','right_45','left_profile','right_profile','close_up','detail','other')),
  add constraint patient_photos_pose_check check (pose is null or pose in ('rest','smile','expression','custom')),
  add constraint patient_photos_source_type_check check (source_type in ('legacy','camera','library','upload')),
  add constraint patient_photos_canonical_mime_check check (mime_type is null or mime_type in ('image/jpeg','image/png')),
  add constraint patient_photos_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint patient_photos_dimensions_check check ((width is null and height is null) or (width>0 and height>0)),
  add constraint patient_photos_size_check check (size_bytes is null or size_bytes>0),
  add constraint patient_photos_void_reason_check check (voided_at is null or (voided_by is not null and length(trim(coalesce(void_reason,'')))>=3));

create unique index patient_photos_user_client_upload_uidx on public.patient_photos(user_id,client_upload_id) where client_upload_id is not null;
create index patient_photos_user_patient_taken_v2_idx on public.patient_photos(user_id,patient_id,taken_at desc,id desc) where voided_at is null;
create index patient_photos_session_angle_v2_idx on public.patient_photos(photo_session_id,angle,taken_at,id) where photo_session_id is not null and voided_at is null;
create index patient_photos_user_procedure_v2_idx on public.patient_photos(user_id,procedure_id,taken_at desc) where procedure_id is not null and voided_at is null;

create or replace function public.photos_v2_validate_session_context()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_appointment_patient uuid;
  v_appointment_service uuid;
  v_procedure_patient uuid;
  v_procedure_appointment uuid;
  v_service_name text;
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then raise exception 'PHOTO_SESSION_OWNER_MISMATCH'; end if;
  if new.created_by is distinct from auth.uid() then raise exception 'PHOTO_SESSION_AUTHOR_MISMATCH'; end if;
  if tg_op='UPDATE' and (old.user_id is distinct from new.user_id or old.patient_id is distinct from new.patient_id or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at) then raise exception 'PHOTO_SESSION_IDENTITY_IMMUTABLE'; end if;
  if not exists(select 1 from public.patients p where p.id=new.patient_id and p.user_id=new.user_id) then raise exception 'PHOTO_SESSION_PATIENT_MISMATCH'; end if;

  if new.appointment_id is not null then
    select a.patient_id,a.service_id into v_appointment_patient,v_appointment_service
    from public.appointments a where a.id=new.appointment_id and a.user_id=new.user_id;
    if not found or v_appointment_patient is distinct from new.patient_id then raise exception 'PHOTO_SESSION_APPOINTMENT_MISMATCH'; end if;
    if new.service_id is null then new.service_id:=v_appointment_service; end if;
    if new.service_id is not null and v_appointment_service is not null and new.service_id is distinct from v_appointment_service then raise exception 'PHOTO_SESSION_SERVICE_MISMATCH'; end if;
  end if;

  if new.procedure_id is not null then
    select p.patient_id,p.appointment_id into v_procedure_patient,v_procedure_appointment
    from public.procedures p where p.id=new.procedure_id and p.user_id=new.user_id;
    if not found or v_procedure_patient is distinct from new.patient_id then raise exception 'PHOTO_SESSION_PROCEDURE_MISMATCH'; end if;
    if new.appointment_id is not null and v_procedure_appointment is not null and new.appointment_id is distinct from v_procedure_appointment then raise exception 'PHOTO_SESSION_PROCEDURE_APPOINTMENT_MISMATCH'; end if;
  end if;

  if new.service_id is not null then
    select s.name into v_service_name from public.services s where s.id=new.service_id and s.user_id=new.user_id;
    if not found then raise exception 'PHOTO_SESSION_SERVICE_OWNER_MISMATCH'; end if;
    if tg_op='INSERT' or new.service_name_snapshot is null then new.service_name_snapshot:=v_service_name; end if;
  end if;

  if tg_op='UPDATE' and old.voided_at is not null and new.voided_at is null then raise exception 'PHOTO_SESSION_VOID_IS_FINAL'; end if;
  if tg_op='UPDATE' and old.voided_at is null and new.voided_at is not null then
    new.voided_by:=auth.uid();
    if length(trim(coalesce(new.void_reason,'')))<3 then raise exception 'PHOTO_SESSION_VOID_REASON_REQUIRED'; end if;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

create trigger patient_photo_sessions_validate_v2
before insert or update on public.patient_photo_sessions
for each row execute function public.photos_v2_validate_session_context();

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
    if old.id is distinct from new.id or old.user_id is distinct from new.user_id or old.patient_id is distinct from new.patient_id or old.photo_url is distinct from new.photo_url or old.original_path is distinct from new.original_path or old.preview_path is distinct from new.preview_path or old.thumbnail_path is distinct from new.thumbnail_path or old.mime_type is distinct from new.mime_type or old.width is distinct from new.width or old.height is distinct from new.height or old.size_bytes is distinct from new.size_bytes or old.sha256 is distinct from new.sha256 or old.source_type is distinct from new.source_type or old.client_upload_id is distinct from new.client_upload_id or old.canonicalized_at is distinct from new.canonicalized_at or old.taken_at is distinct from new.taken_at then raise exception 'PATIENT_PHOTO_CANONICAL_IMMUTABLE'; end if;
    if old.voided_at is not null and new.voided_at is null then raise exception 'PATIENT_PHOTO_VOID_IS_FINAL'; end if;
    if old.voided_at is null and new.voided_at is not null then
      new.voided_by:=auth.uid();
      if length(trim(coalesce(new.void_reason,'')))<3 then raise exception 'PATIENT_PHOTO_VOID_REASON_REQUIRED'; end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger patient_photos_validate_v2
before insert or update on public.patient_photos
for each row execute function public.photos_v2_validate_photo_context();

alter table public.patient_photo_sessions enable row level security;
create policy patient_photo_sessions_select_own on public.patient_photo_sessions for select to authenticated using (user_id=(select auth.uid()));
create policy patient_photo_sessions_insert_own on public.patient_photo_sessions for insert to authenticated with check (user_id=(select auth.uid()));
create policy patient_photo_sessions_update_own on public.patient_photo_sessions for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke all on public.patient_photo_sessions from public,anon;
grant select,insert,update on public.patient_photo_sessions to authenticated;
revoke delete on public.patient_photo_sessions from authenticated;

drop policy if exists patient_photos_own on public.patient_photos;
create policy patient_photos_select_own_v2 on public.patient_photos for select to authenticated using (user_id=(select auth.uid()));
create policy patient_photos_insert_own_v2 on public.patient_photos for insert to authenticated with check (user_id=(select auth.uid()));
create policy patient_photos_update_own_v2 on public.patient_photos for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
revoke delete on public.patient_photos from public,anon,authenticated;

-- Bucket remains private. Raw HEIC is allowed only for legacy-client compatibility during rollout;
-- Photos 2.0 canonical rows can only register JPEG/PNG assets after local decoding/canonicalization.
update storage.buckets
set public=false,
    file_size_limit=20971520,
    allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
where id='patient-photos';

drop policy if exists patient_photos_read_own_folder on storage.objects;
drop policy if exists patient_photos_write_own_folder on storage.objects;
drop policy if exists patient_photos_delete_own_folder on storage.objects;
drop policy if exists patient_photos_read_owned_v2 on storage.objects;
drop policy if exists patient_photos_write_owned_v2 on storage.objects;
drop policy if exists patient_photos_delete_unregistered_v2 on storage.objects;

create policy patient_photos_read_owned_v2 on storage.objects
for select to authenticated
using (
  bucket_id='patient-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (
    ((storage.foldername(name))[2]='patients' and (storage.foldername(name))[4]='photos' and exists(select 1 from public.patients p where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(name))[3]))
    or exists(select 1 from public.patients p where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(name))[2])
  )
);

create policy patient_photos_write_owned_v2 on storage.objects
for insert to authenticated
with check (
  bucket_id='patient-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (
    ((storage.foldername(name))[2]='patients' and (storage.foldername(name))[4]='photos' and exists(select 1 from public.patients p where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(name))[3]))
    or exists(select 1 from public.patients p where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(name))[2])
  )
);

-- Registered clinical assets are not deletable or overwritable by clients. DELETE is reserved for
-- cleanup of files that never reached a patient_photos row after a failed upload transaction.
create policy patient_photos_delete_unregistered_v2 on storage.objects
for delete to authenticated
using (
  bucket_id='patient-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and not exists(
    select 1 from public.patient_photos p
    where p.user_id=(select auth.uid())
      and (p.photo_url=name or p.original_path=name or p.preview_path=name or p.thumbnail_path=name)
  )
);

comment on table public.patient_photo_sessions is 'Photos 2.0: tenant-owned clinical photographic sessions. Sessions organize immutable clinical photo assets without aesthetic analysis.';
comment on column public.patient_photos.original_path is 'Immutable canonical clinical image path after one-time ingestion normalization. Never a permanent signed URL.';
comment on column public.patient_photos.sha256 is 'SHA-256 integrity digest of the canonical clinical image; technical integrity only, not a digital signature.';

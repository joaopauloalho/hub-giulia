-- Activity-based ordering for patients without changing clinical history or archive ordering.
-- All actions are recorded by the database; opening a chart is not an activity.
alter table public.patients
  add column if not exists last_activity_at timestamptz;

-- Backfill from existing records. Never overwrite a newer recorded activity.
-- Historical photo dates are editable, so cap them at the migration timestamp.
update public.patients p
set last_activity_at = greatest(
  p.created_at,
  coalesce(p.last_activity_at, p.created_at),
  coalesce((select max(x.created_at) from public.procedures x where x.patient_id=p.id and x.user_id=p.user_id), p.created_at),
  coalesce((select max(least(x.taken_at, now())) from public.patient_photos x where x.patient_id=p.id and x.user_id=p.user_id and x.voided_at is null), p.created_at),
  coalesce((select max(x.created_at) from public.patient_photo_sessions x where x.patient_id=p.id and x.user_id=p.user_id and x.voided_at is null), p.created_at),
  coalesce((select max(x.updated_at) from public.anamnesis x where x.patient_id=p.id and x.user_id=p.user_id), p.created_at),
  coalesce((select max(x.created_at) from public.patient_notes x where x.patient_id=p.id and x.user_id=p.user_id), p.created_at),
  coalesce((select max(x.updated_at) from public.patient_photo_day_notes x where x.patient_id=p.id and x.user_id=p.user_id), p.created_at),
  coalesce((select max(x.updated_at) from public.injectable_maps x where x.patient_id=p.id and x.user_id=p.user_id and x.voided_at is null), p.created_at),
  coalesce((select max(x.created_at) from public.contracts x where x.patient_id=p.id and x.user_id=p.user_id and x.voided_at is null), p.created_at),
  coalesce((select max(x.updated_at) from public.patient_packages x where x.patient_id=p.id and x.user_id=p.user_id and x.voided_at is null), p.created_at)
);

alter table public.patients
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null;

create index if not exists patients_activity_recent_idx
  on public.patients (user_id, last_activity_at desc, created_at desc, id desc)
  where archived_at is null;

-- BEFORE UPDATE guarantees even direct patient edits bump the activity timestamp.
-- Archive/restore and explicit attempts to write the activity timestamp alone do not.
create or replace function public.patient_self_activity_touch_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'last_activity_at' - 'archived_at')
      is distinct from (to_jsonb(old) - 'last_activity_at' - 'archived_at') then
    new.last_activity_at := greatest(old.last_activity_at, clock_timestamp());
  else
    new.last_activity_at := old.last_activity_at;
  end if;
  return new;
end;
$$;

create trigger patient_self_activity_touch_v1
before update on public.patients
for each row execute function public.patient_self_activity_touch_v1();

-- Only an existing child record with matching owner can touch the patient's row.
-- The parent UPDATE is scoped to patient_id AND user_id; public clients cannot call this
-- trigger function directly. Routine server-side operations may have null auth.uid().
create or replace function public.patient_related_activity_touch_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if new.patient_id is null or new.user_id is null then
    return new;
  end if;

  if (select auth.uid()) is not null and new.user_id <> (select auth.uid()) then
    return new;
  end if;

  update public.patients
     set last_activity_at = greatest(last_activity_at, clock_timestamp())
   where id = new.patient_id and user_id = new.user_id;

  return new;
end;
$$;

revoke all on function public.patient_related_activity_touch_v1() from public, anon, authenticated;
revoke all on function public.patient_self_activity_touch_v1() from public, anon;
-- Related records maintained in independent tables; INSERT and meaningful UPDATE count.
create trigger patient_procedure_activity_v1
after insert or update on public.procedures
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_photo_activity_v1
after insert or update on public.patient_photos
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_photo_session_activity_v1
after insert or update on public.patient_photo_sessions
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_anamnesis_activity_v1
after insert or update on public.anamnesis
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_note_activity_v1
after insert or update on public.patient_notes
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_photo_day_note_activity_v1
after insert or update on public.patient_photo_day_notes
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_injectable_map_activity_v1
after insert or update on public.injectable_maps
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_contract_activity_v1
after insert or update on public.contracts
for each row execute function public.patient_related_activity_touch_v1();

create trigger patient_package_activity_v1
after insert or update on public.patient_packages
for each row execute function public.patient_related_activity_touch_v1();

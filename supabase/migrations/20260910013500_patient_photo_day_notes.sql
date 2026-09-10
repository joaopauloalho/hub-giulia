create table if not exists public.patient_photo_day_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  photo_date date not null,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_photo_day_notes_note_length check (char_length(note) <= 2000),
  constraint patient_photo_day_notes_unique_day unique (user_id, patient_id, photo_date)
);

alter table public.patient_photo_day_notes enable row level security;

create policy "patient_photo_day_notes_select_own"
on public.patient_photo_day_notes
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = auth.uid()
  )
);

create policy "patient_photo_day_notes_insert_own"
on public.patient_photo_day_notes
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = auth.uid()
  )
);

create policy "patient_photo_day_notes_update_own"
on public.patient_photo_day_notes
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = auth.uid()
  )
);

create policy "patient_photo_day_notes_delete_own"
on public.patient_photo_day_notes
for delete
to authenticated
using (user_id = auth.uid());

create index if not exists patient_photo_day_notes_patient_date_idx
  on public.patient_photo_day_notes (patient_id, photo_date desc);

create or replace function public.patient_photo_day_notes_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists patient_photo_day_notes_touch_updated_at on public.patient_photo_day_notes;
create trigger patient_photo_day_notes_touch_updated_at
before update on public.patient_photo_day_notes
for each row execute function public.patient_photo_day_notes_touch_updated_at();

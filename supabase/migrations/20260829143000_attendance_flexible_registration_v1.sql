-- Hub Giulia — Flexible attendance registration v1
-- Server-backed drafts for patient-context attendance registration.
-- Financial receivables keep using procedure_payments: future scheduled_date + paid_at null.

create table if not exists public.attendance_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_drafts_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint attendance_drafts_user_patient_unique unique (user_id, patient_id)
);

create index if not exists attendance_drafts_patient_idx
  on public.attendance_drafts (patient_id, updated_at desc);

alter table public.attendance_drafts enable row level security;

revoke all on table public.attendance_drafts from anon, authenticated;
grant select, insert, update, delete on table public.attendance_drafts to authenticated;

create policy attendance_drafts_select_own
  on public.attendance_drafts for select to authenticated
  using (user_id = auth.uid());

create policy attendance_drafts_insert_own
  on public.attendance_drafts for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.user_id = auth.uid()
    )
  );

create policy attendance_drafts_update_own
  on public.attendance_drafts for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.patients p
      where p.id = patient_id and p.user_id = auth.uid()
    )
  );

create policy attendance_drafts_delete_own
  on public.attendance_drafts for delete to authenticated
  using (user_id = auth.uid());

comment on table public.attendance_drafts is
  'One active server-backed attendance draft per patient/owner. Deleted after atomic attendance finalization.';
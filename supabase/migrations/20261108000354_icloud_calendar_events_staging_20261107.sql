-- Staging area for iCloud CalDAV events. It never writes to Apple's calendar.
-- Only backend service-role importers may create, change provider fields or soft-delete rows.
-- Patients are linked manually by the clinic. Never auto-create appointments.
create table public.icloud_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null check (length(calendar_id) > 0),
  resource_href text not null check (length(resource_href) > 0),
  event_uid text not null check (length(event_uid) > 0),
  recurrence_id text not null default '',
  etag text,
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_all_day boolean not null default false,
  is_private boolean not null default false,
  is_deleted boolean not null default false,
  linked_patient_id uuid,
  linked_appointment_id uuid,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint icloud_calendar_events_range_check check (ends_at > starts_at),
  constraint icloud_calendar_events_external_unique unique (user_id, calendar_id, resource_href, recurrence_id),
  constraint icloud_calendar_events_patient_owner_fkey
    foreign key (linked_patient_id, user_id) references public.patients (id, user_id)
    on delete set null (linked_patient_id),
  constraint icloud_calendar_events_appointment_owner_fkey
    foreign key (linked_appointment_id, user_id) references public.appointments (id, user_id)
    on delete set null (linked_appointment_id)
);

create index icloud_calendar_events_range_idx
  on public.icloud_calendar_events (user_id, starts_at, ends_at)
  where is_deleted = false;
create index icloud_calendar_events_patient_idx
  on public.icloud_calendar_events (user_id, linked_patient_id)
  where linked_patient_id is not null;

alter table public.icloud_calendar_events enable row level security;
revoke all on table public.icloud_calendar_events from public, anon, authenticated;
grant select on public.icloud_calendar_events to authenticated;
grant update (linked_patient_id) on public.icloud_calendar_events to authenticated;

create policy icloud_calendar_events_own_select on public.icloud_calendar_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy icloud_calendar_events_own_link on public.icloud_calendar_events
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

comment on table public.icloud_calendar_events is
  'Imported iCloud CalDAV events; soft deletion and immutable external identity. Imported data must never auto-convert into clinical appointments.';

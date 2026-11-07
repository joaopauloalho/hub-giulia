-- Account credentials are encrypted in Edge Functions with ICLOUD_ENCRYPTION_KEY.
-- No credential is exposed to anon/authenticated SQL API or clients.
create table public.icloud_calendar_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  apple_id text not null check (length(trim(apple_id)) between 3 and 254),
  password_ciphertext text not null,
  calendar_home_url text not null,
  connected boolean not null default false,
  write_enabled boolean not null default false,
  write_calendar_id text,
  last_sync_at timestamptz,
  last_error_code text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.icloud_calendar_collections (
  user_id uuid not null references auth.users(id) on delete cascade,
  calendar_id text not null,
  calendar_url text not null,
  display_name text not null,
  is_selected boolean not null default true,
  is_writable boolean not null default false,
  last_sync_at timestamptz,
  primary key(user_id, calendar_id),
  foreign key (user_id) references public.icloud_calendar_accounts(user_id) on delete cascade
);

alter table public.icloud_calendar_accounts
  add constraint icloud_write_calendar_owner_fkey
  foreign key(user_id, write_calendar_id)
  references public.icloud_calendar_collections(user_id, calendar_id)
  deferrable initially immediate;

create table public.icloud_appointment_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid not null,
  calendar_id text not null,
  resource_href text not null,
  event_uid text not null,
  etag text,
  source_kind text not null default 'hub' check(source_kind in ('hub','imported')),
  sync_status text not null default 'pending' check(sync_status in ('pending','synced','error')),
  last_error_code text,
  updated_at timestamptz not null default now(),
  primary key (user_id, appointment_id),
  unique(user_id, calendar_id, resource_href),
  foreign key (appointment_id,user_id) references public.appointments(id,user_id) on delete cascade,
  foreign key (user_id,calendar_id) references public.icloud_calendar_collections(user_id,calendar_id)
);

create index icloud_appointment_links_resource_idx
  on public.icloud_appointment_links (user_id,calendar_id,resource_href);

alter table public.icloud_calendar_accounts enable row level security;
alter table public.icloud_calendar_collections enable row level security;
alter table public.icloud_appointment_links enable row level security;
revoke all on public.icloud_calendar_accounts from public, anon, authenticated;
revoke all on public.icloud_calendar_collections from public, anon, authenticated;
revoke all on public.icloud_appointment_links from public, anon, authenticated;
grant select on public.icloud_calendar_collections to authenticated;
grant select on public.icloud_appointment_links to authenticated;
create policy icloud_collections_own_read on public.icloud_calendar_collections
  for select to authenticated using (user_id=(select auth.uid()));
create policy icloud_links_own_read on public.icloud_appointment_links
  for select to authenticated using (user_id=(select auth.uid()));

-- Explicit conversion: never auto-create a patient or clinic appointment on import.
-- The imported event retains its original CalDAV identity and is not rewritten in iCloud.
create or replace function public.convert_icloud_event_v1(
  p_event_id uuid,
  p_service_id uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_event public.icloud_calendar_events%rowtype;
  v_appointment uuid;
  v_minutes integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_event from public.icloud_calendar_events
    where id=p_event_id and user_id=v_user and is_deleted=false for update;
  if not found then raise exception 'ICLOUD_EVENT_NOT_FOUND'; end if;
  if v_event.linked_appointment_id is not null then
    return v_event.linked_appointment_id;
  end if;
  if v_event.linked_patient_id is null then
    raise exception 'LINK_PATIENT_FIRST';
  end if;
  if v_event.is_all_day then raise exception 'ALL_DAY_NOT_APPOINTMENT'; end if;
  v_minutes := round(extract(epoch from (v_event.ends_at-v_event.starts_at))/60)::integer;
  if v_minutes < 5 or v_minutes > 1440 then raise exception 'DURATION_NOT_SUPPORTED'; end if;
  if p_service_id is not null and not exists (
    select 1 from public.services where id=p_service_id and user_id=v_user
  ) then raise exception 'SERVICE_NOT_FOUND'; end if;

  insert into public.appointments (
    user_id, patient_id, service_id, scheduled_at, duration_minutes, status, source
  ) values (
    v_user,v_event.linked_patient_id,p_service_id,v_event.starts_at,v_minutes,'pendente','manual'
  ) returning id into v_appointment;

  insert into public.icloud_appointment_links (
    user_id,appointment_id,calendar_id,resource_href,event_uid,etag,source_kind,sync_status
  ) values (
    v_user,v_appointment,v_event.calendar_id,v_event.resource_href,
    v_event.event_uid,v_event.etag,'imported','synced'
  );

  update public.icloud_calendar_events
    set linked_appointment_id=v_appointment, updated_at=now()
    where id=v_event.id;
  return v_appointment;
end;
$$;
revoke all on function public.convert_icloud_event_v1(uuid,uuid) from public, anon;
grant execute on function public.convert_icloud_event_v1(uuid,uuid) to authenticated;

comment on table public.icloud_calendar_accounts is 'Apple ID and AES-GCM ciphertext are backend-only; no frontend SQL grants.';
comment on table public.icloud_appointment_links is 'External identity for iCloud sync; imported events remain read-only to avoid rewriting personal calendar details.';

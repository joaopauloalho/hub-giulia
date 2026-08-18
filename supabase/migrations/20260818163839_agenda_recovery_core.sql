-- Hub Giulia 4.1 — Agenda Recovery / Lista de Encaixe
-- Core persistente mínimo: histórico da lista + estado manual de dismiss.

create table public.appointment_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  patient_id uuid not null,
  service_id uuid,
  source_appointment_id uuid,
  preferred_period text,
  preferred_weekdays smallint[],
  expires_on date,
  notes text,
  status text not null default 'active',
  fulfilled_appointment_id uuid,
  fulfilled_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_waitlist_status_check check (status in ('active','fulfilled','dismissed','expired')),
  constraint appointment_waitlist_period_check check (preferred_period is null or preferred_period in ('morning','afternoon','evening')),
  constraint appointment_waitlist_weekdays_check check (
    preferred_weekdays is null or (
      cardinality(preferred_weekdays) between 1 and 7
      and preferred_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
    )
  ),
  constraint appointment_waitlist_notes_check check (notes is null or length(notes) <= 1000),
  constraint appointment_waitlist_fulfilled_shape_check check (
    (status = 'fulfilled') = (fulfilled_appointment_id is not null and fulfilled_at is not null)
  ),
  constraint appointment_waitlist_dismissed_shape_check check (status <> 'dismissed' or dismissed_at is not null),
  constraint appointment_waitlist_patient_owner_fkey foreign key (patient_id,user_id) references public.patients(id,user_id),
  constraint appointment_waitlist_service_owner_fkey foreign key (service_id,user_id) references public.services(id,user_id),
  constraint appointment_waitlist_source_owner_fkey foreign key (source_appointment_id,user_id) references public.appointments(id,user_id),
  constraint appointment_waitlist_fulfilled_owner_fkey foreign key (fulfilled_appointment_id,user_id) references public.appointments(id,user_id)
);

-- Uma paciente tem uma preferência operacional ativa por vez. Editar reaproveita a mesma linha.
create unique index appointment_waitlist_one_active_patient_uidx
  on public.appointment_waitlist_entries(user_id,patient_id)
  where status='active';
create index appointment_waitlist_active_created_idx
  on public.appointment_waitlist_entries(user_id,status,created_at,id);

create table public.appointment_recovery_dismissals (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  appointment_id uuid not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id,appointment_id),
  constraint appointment_recovery_dismissal_owner_fkey
    foreign key (appointment_id,user_id) references public.appointments(id,user_id)
);

alter table public.appointment_waitlist_entries enable row level security;
alter table public.appointment_recovery_dismissals enable row level security;

create policy appointment_waitlist_entries_own
on public.appointment_waitlist_entries for all to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

create policy appointment_recovery_dismissals_own
on public.appointment_recovery_dismissals for all to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

revoke all on public.appointment_waitlist_entries from anon;
revoke all on public.appointment_recovery_dismissals from anon;
grant select,insert,update on public.appointment_waitlist_entries to authenticated;
grant select,insert on public.appointment_recovery_dismissals to authenticated;

create or replace function public.validate_appointment_waitlist_entry_v1()
returns trigger
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_source record;
  v_fulfilled record;
begin
  if tg_op='UPDATE' and old.status <> 'active' and new.status is distinct from old.status then
    raise exception 'WAITLIST_FINAL_STATUS_IMMUTABLE';
  end if;

  if new.status='active' then
    new.fulfilled_appointment_id:=null;
    new.fulfilled_at:=null;
    new.dismissed_at:=null;
    if new.expires_on is not null and new.expires_on < (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'WAITLIST_EXPIRY_IN_PAST';
    end if;
    if new.source_appointment_id is not null then
      select a.patient_id,a.status,a.scheduled_at
        into v_source
      from public.appointments a
      where a.id=new.source_appointment_id and a.user_id=new.user_id;
      if not found or v_source.patient_id<>new.patient_id then raise exception 'WAITLIST_SOURCE_INVALID'; end if;
      if v_source.status not in ('pendente','confirmado') or v_source.scheduled_at<=now() then
        raise exception 'WAITLIST_SOURCE_NOT_ACTIVE';
      end if;
    end if;
  elsif new.status='fulfilled' then
    select a.patient_id into v_fulfilled
    from public.appointments a
    where a.id=new.fulfilled_appointment_id and a.user_id=new.user_id;
    if not found or v_fulfilled.patient_id<>new.patient_id then
      raise exception 'WAITLIST_FULFILLED_APPOINTMENT_INVALID';
    end if;
    new.fulfilled_at:=coalesce(new.fulfilled_at,now());
    new.dismissed_at:=null;
  elsif new.status='dismissed' then
    new.dismissed_at:=coalesce(new.dismissed_at,now());
    new.fulfilled_appointment_id:=null;
    new.fulfilled_at:=null;
  elsif new.status='expired' then
    new.fulfilled_appointment_id:=null;
    new.fulfilled_at:=null;
    new.dismissed_at:=null;
  end if;
  new.updated_at:=now();
  return new;
end $$;

create trigger trg_validate_appointment_waitlist_entry_v1
before insert or update on public.appointment_waitlist_entries
for each row execute function public.validate_appointment_waitlist_entry_v1();

revoke all on function public.validate_appointment_waitlist_entry_v1() from public,anon;

create or replace function public.upsert_appointment_waitlist_entry_v1(
  p_patient_id uuid,
  p_service_id uuid default null,
  p_source_appointment_id uuid default null,
  p_preferred_period text default null,
  p_preferred_weekdays smallint[] default null,
  p_expires_on date default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_service uuid:=p_service_id;
  v_source record;
  v_id uuid;
begin
  if v_uid is null then raise exception 'WAITLIST_SESSION_REQUIRED'; end if;
  if p_patient_id is null or not exists(
    select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_uid and p.archived_at is null
  ) then raise exception 'WAITLIST_PATIENT_NOT_FOUND'; end if;
  if p_preferred_period is not null and p_preferred_period not in ('morning','afternoon','evening') then
    raise exception 'WAITLIST_PERIOD_INVALID';
  end if;
  if p_preferred_weekdays is not null and not (
    cardinality(p_preferred_weekdays) between 1 and 7
    and p_preferred_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ) then raise exception 'WAITLIST_WEEKDAYS_INVALID'; end if;
  if p_expires_on is not null and p_expires_on < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'WAITLIST_EXPIRY_IN_PAST';
  end if;

  if p_source_appointment_id is not null then
    select a.patient_id,a.service_id,a.status,a.scheduled_at
      into v_source
    from public.appointments a
    where a.id=p_source_appointment_id and a.user_id=v_uid;
    if not found or v_source.patient_id<>p_patient_id then raise exception 'WAITLIST_SOURCE_INVALID'; end if;
    if v_source.status not in ('pendente','confirmado') or v_source.scheduled_at<=now() then
      raise exception 'WAITLIST_SOURCE_NOT_ACTIVE';
    end if;
    v_service:=coalesce(v_service,v_source.service_id);
  end if;
  if v_service is not null and not exists(
    select 1 from public.services s where s.id=v_service and s.user_id=v_uid
  ) then raise exception 'WAITLIST_SERVICE_NOT_FOUND'; end if;

  insert into public.appointment_waitlist_entries(
    user_id,patient_id,service_id,source_appointment_id,preferred_period,preferred_weekdays,expires_on,notes,status
  ) values (
    v_uid,p_patient_id,v_service,p_source_appointment_id,p_preferred_period,p_preferred_weekdays,p_expires_on,nullif(btrim(p_notes),''),'active'
  )
  on conflict (user_id,patient_id) where status='active'
  do update set
    service_id=excluded.service_id,
    source_appointment_id=excluded.source_appointment_id,
    preferred_period=excluded.preferred_period,
    preferred_weekdays=excluded.preferred_weekdays,
    expires_on=excluded.expires_on,
    notes=excluded.notes,
    updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.dismiss_appointment_waitlist_entry_v1(p_entry_id uuid)
returns boolean
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'WAITLIST_SESSION_REQUIRED'; end if;
  update public.appointment_waitlist_entries
  set status='dismissed',dismissed_at=now()
  where id=p_entry_id and user_id=auth.uid() and status='active';
  get diagnostics v_count=row_count;
  return v_count>0;
end $$;

create or replace function public.fulfill_appointment_waitlist_entry_v1(p_entry_id uuid,p_appointment_id uuid)
returns boolean
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_uid uuid:=auth.uid();
  v_entry record;
  v_appt record;
  v_count int;
begin
  if v_uid is null then raise exception 'WAITLIST_SESSION_REQUIRED'; end if;
  select id,patient_id,status,fulfilled_appointment_id into v_entry
  from public.appointment_waitlist_entries
  where id=p_entry_id and user_id=v_uid;
  if not found then raise exception 'WAITLIST_ENTRY_NOT_FOUND'; end if;
  if v_entry.status='fulfilled' then return v_entry.fulfilled_appointment_id=p_appointment_id; end if;
  if v_entry.status<>'active' then raise exception 'WAITLIST_ENTRY_NOT_ACTIVE'; end if;
  select patient_id,status into v_appt
  from public.appointments
  where id=p_appointment_id and user_id=v_uid;
  if not found or v_appt.patient_id<>v_entry.patient_id or v_appt.status not in ('pendente','confirmado') then
    raise exception 'WAITLIST_FULFILLED_APPOINTMENT_INVALID';
  end if;
  update public.appointment_waitlist_entries
  set status='fulfilled',fulfilled_appointment_id=p_appointment_id,fulfilled_at=now()
  where id=p_entry_id and user_id=v_uid and status='active';
  get diagnostics v_count=row_count;
  return v_count>0;
end $$;

create or replace function public.get_appointment_waitlist_entry_v1(p_patient_id uuid)
returns table(
  id uuid,patient_id uuid,service_id uuid,service_name text,source_appointment_id uuid,source_scheduled_at timestamptz,
  preferred_period text,preferred_weekdays smallint[],expires_on date,notes text,status text,created_at timestamptz,updated_at timestamptz
)
language sql
security invoker
set search_path=public,pg_temp
as $$
select
  e.id,e.patient_id,e.service_id,s.name,e.source_appointment_id,a.scheduled_at,e.preferred_period,e.preferred_weekdays,e.expires_on,e.notes,
  case
    when e.status='active' and (
      e.expires_on is not null and e.expires_on < (now() at time zone 'America/Sao_Paulo')::date
      or e.source_appointment_id is not null and (a.id is null or a.status not in ('pendente','confirmado') or a.scheduled_at<=now())
    ) then 'expired'
    else e.status
  end,
  e.created_at,e.updated_at
from public.appointment_waitlist_entries e
left join public.services s on s.id=e.service_id and s.user_id=e.user_id
left join public.appointments a on a.id=e.source_appointment_id and a.user_id=e.user_id
where e.user_id=(select auth.uid()) and e.patient_id=p_patient_id
order by (e.status='active') desc,e.created_at desc,e.id desc
limit 1;
$$;

create or replace function public.list_appointment_waitlist_candidates_v1(
  p_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_service_id uuid default null
)
returns table(
  entry_id uuid,patient_id uuid,patient_name text,phone text,service_id uuid,service_name text,preferred_period text,
  preferred_weekdays smallint[],expires_on date,notes text,created_at timestamptz,source_appointment_id uuid,
  source_scheduled_at timestamptz,source_duration_minutes integer,source_service_id uuid,source_service_name text
)
language sql
security invoker
set search_path=public,pg_temp
as $$
with target as (
  select
    p_scheduled_at slot_at,
    greatest(5,coalesce(p_duration_minutes,60)) duration_minutes,
    extract(hour from p_scheduled_at at time zone 'America/Sao_Paulo')::int slot_hour,
    extract(isodow from p_scheduled_at at time zone 'America/Sao_Paulo')::smallint slot_dow,
    (p_scheduled_at at time zone 'America/Sao_Paulo')::date slot_date
)
select
  e.id,e.patient_id,p.name,p.phone,e.service_id,s.name,e.preferred_period,e.preferred_weekdays,e.expires_on,e.notes,e.created_at,
  e.source_appointment_id,src.scheduled_at,src.duration_minutes,src.service_id,srcs.name
from public.appointment_waitlist_entries e
join public.patients p on p.id=e.patient_id and p.user_id=e.user_id and p.archived_at is null
cross join target t
left join public.services s on s.id=e.service_id and s.user_id=e.user_id
left join public.appointments src on src.id=e.source_appointment_id and src.user_id=e.user_id
left join public.services srcs on srcs.id=src.service_id and srcs.user_id=src.user_id
where e.user_id=(select auth.uid())
  and e.status='active'
  and (e.expires_on is null or t.slot_date<=e.expires_on)
  and (p_service_id is null or e.service_id is null or e.service_id=p_service_id)
  and (
    e.preferred_period is null
    or e.preferred_period='morning' and t.slot_hour<12
    or e.preferred_period='afternoon' and t.slot_hour>=12 and t.slot_hour<18
    or e.preferred_period='evening' and t.slot_hour>=18
  )
  and (e.preferred_weekdays is null or t.slot_dow=any(e.preferred_weekdays))
  and (
    e.source_appointment_id is null
    or src.id is not null
      and src.status in ('pendente','confirmado')
      and src.scheduled_at>now()
      and p_scheduled_at<src.scheduled_at
      and src.duration_minutes<=t.duration_minutes
  )
  and not exists (
    select 1 from public.appointments conflict
    where conflict.user_id=e.user_id
      and conflict.patient_id=e.patient_id
      and conflict.status in ('pendente','confirmado')
      and conflict.id is distinct from e.source_appointment_id
      and conflict.scheduled_at < p_scheduled_at + make_interval(mins=>t.duration_minutes)
      and conflict.end_at > p_scheduled_at
  )
order by
  case when p_service_id is not null and e.service_id=p_service_id then 0 when e.service_id is null then 1 else 2 end,
  e.created_at,e.id;
$$;

revoke all on function public.upsert_appointment_waitlist_entry_v1(uuid,uuid,uuid,text,smallint[],date,text) from public,anon;
revoke all on function public.dismiss_appointment_waitlist_entry_v1(uuid) from public,anon;
revoke all on function public.fulfill_appointment_waitlist_entry_v1(uuid,uuid) from public,anon;
revoke all on function public.get_appointment_waitlist_entry_v1(uuid) from public,anon;
revoke all on function public.list_appointment_waitlist_candidates_v1(timestamptz,integer,uuid) from public,anon;

grant execute on function public.upsert_appointment_waitlist_entry_v1(uuid,uuid,uuid,text,smallint[],date,text) to authenticated;
grant execute on function public.dismiss_appointment_waitlist_entry_v1(uuid) to authenticated;
grant execute on function public.fulfill_appointment_waitlist_entry_v1(uuid,uuid) to authenticated;
grant execute on function public.get_appointment_waitlist_entry_v1(uuid) to authenticated;
grant execute on function public.list_appointment_waitlist_candidates_v1(timestamptz,integer,uuid) to authenticated;

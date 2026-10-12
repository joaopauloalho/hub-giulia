-- Agenda de contatos: lembretes comerciais opcionais, sem filas obrigatórias.
create table if not exists public.contact_calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  patient_id uuid not null,
  procedure_id uuid not null,
  service_id uuid not null,
  service_name text not null check (length(trim(service_name)) between 1 and 200),
  performed_at timestamptz not null,
  months_after integer not null check (months_after between 1 and 24),
  due_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, procedure_id, service_id),
  foreign key (patient_id,user_id) references public.patients (id,user_id) on delete cascade,
  foreign key (procedure_id,user_id) references public.procedures (id,user_id) on delete cascade
);
create index if not exists contact_calendar_reminders_due_idx on public.contact_calendar_reminders(user_id,due_on);
alter table public.contact_calendar_reminders enable row level security;
create policy "contact_calendar_reminders_own_select" on public.contact_calendar_reminders
  for select to authenticated using (user_id=(select auth.uid()));
create policy "contact_calendar_reminders_own_insert" on public.contact_calendar_reminders
  for insert to authenticated with check (
    user_id=(select auth.uid()) and exists (
      select 1 from public.procedures p
      where p.id=procedure_id and p.user_id=user_id and p.patient_id=patient_id and p.attendance_type='procedure'
    )
  );
create table if not exists public.contact_calendar_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  patient_id uuid not null,
  item_key text not null check (length(item_key) between 10 and 150),
  contacted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id,item_key),
  foreign key (patient_id,user_id) references public.patients (id,user_id) on delete cascade
);
create index if not exists contact_calendar_marks_patient_idx on public.contact_calendar_marks(user_id,patient_id,contacted_at desc);
alter table public.contact_calendar_marks enable row level security;
create policy "contact_calendar_marks_own_select" on public.contact_calendar_marks
  for select to authenticated using (user_id=(select auth.uid()));
create policy "contact_calendar_marks_own_insert" on public.contact_calendar_marks
  for insert to authenticated with check (user_id=(select auth.uid()));
create policy "contact_calendar_marks_own_update" on public.contact_calendar_marks
  for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy "contact_calendar_marks_own_delete" on public.contact_calendar_marks
  for delete to authenticated using (user_id=(select auth.uid()));
grant select,insert on public.contact_calendar_reminders to authenticated;
grant select,insert,update,delete on public.contact_calendar_marks to authenticated;

-- Cada sugestão fica somente na data de origem; um procedimento mais novo
-- do mesmo serviço deixa automaticamente de mostrar o lembrete antigo.
create or replace function public.list_contact_calendar_v1(p_start date, p_end date)
returns table(
  item_key text, event_date date, kind text, patient_id uuid,
  patient_name text, phone text, service_name text, contacted_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
 with dates as (
  select day::date as day from generate_series(p_start,p_end,interval '1 day') as days(day)
  where p_end>=p_start and p_end <= p_start + 41 and (select auth.uid()) is not null
 ), events as (
  select ('birthday:' || p.id::text || ':' || extract(year from d.day)::int::text) as item_key,
      d.day as event_date, 'birthday'::text as kind, p.id as patient_id, p.name as patient_name,p.phone,null::text as service_name
   from dates d join public.patients p on p.user_id=(select auth.uid()) and p.archived_at is null and p.birth_date is not null
    and (to_char(p.birth_date,'MM-DD')=to_char(d.day,'MM-DD')
      or (to_char(p.birth_date,'MM-DD')='02-29' and to_char(d.day,'MM-DD')='02-28'
        and extract(month from d.day + interval '1 day')=3))
  union all
  select 'procedure:' || r.id::text,r.due_on,'procedure'::text,p.id,p.name,p.phone,r.service_name
   from public.contact_calendar_reminders r
   join dates d on d.day=r.due_on
   join public.patients p on p.id=r.patient_id and p.user_id=r.user_id and p.archived_at is null
   where r.user_id=(select auth.uid())
    and not exists (
      select 1 from public.procedure_items newer_item
      join public.procedures newer on newer.id=newer_item.procedure_id and newer.user_id=r.user_id
      where newer.patient_id=r.patient_id and newer.attendance_type='procedure' and newer.id<>r.procedure_id
       and newer_item.service_id=r.service_id
       and newer.performed_at > r.performed_at
    )
 )
 select e.item_key,e.event_date,e.kind,e.patient_id,e.patient_name,e.phone,e.service_name,m.contacted_at
 from events e left join public.contact_calendar_marks m on m.user_id=(select auth.uid()) and m.item_key=e.item_key
 order by e.event_date,e.kind,e.patient_name
$$;
revoke all on function public.list_contact_calendar_v1(date,date) from public;
grant execute on function public.list_contact_calendar_v1(date,date) to authenticated;
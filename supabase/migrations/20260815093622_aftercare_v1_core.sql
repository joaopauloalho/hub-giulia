create table public.service_aftercare_protocols (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  service_id uuid not null,
  name text not null default 'Pós-atendimento',
  enabled boolean not null default false,
  version integer not null default 1 check (version >= 1),
  instructions text,
  photo_followup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_aftercare_protocols_name_check check (length(btrim(name)) between 1 and 120),
  constraint service_aftercare_protocols_instructions_check check (instructions is null or length(instructions) <= 12000),
  constraint service_aftercare_protocols_service_owner_fkey foreign key (service_id,user_id) references public.services(id,user_id) on delete cascade,
  constraint service_aftercare_protocols_user_service_key unique (user_id,service_id),
  constraint service_aftercare_protocols_id_user_key unique (id,user_id)
);

create table public.service_aftercare_protocol_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  protocol_id uuid not null,
  step_type text not null default 'checkin' check (step_type = 'checkin'),
  offset_days integer not null check (offset_days between 0 and 3650),
  label text,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint service_aftercare_protocol_steps_label_check check (label is null or length(btrim(label)) between 1 and 120),
  constraint service_aftercare_protocol_steps_protocol_owner_fkey foreign key (protocol_id,user_id) references public.service_aftercare_protocols(id,user_id) on delete cascade,
  constraint service_aftercare_protocol_steps_protocol_offset_key unique (protocol_id,offset_days),
  constraint service_aftercare_protocol_steps_id_user_key unique (id,user_id)
);

create table public.procedure_followup_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid,
  procedure_id_snapshot uuid not null,
  patient_id uuid,
  patient_name_snapshot text not null,
  performed_on date not null,
  status text not null default 'active' check (status in ('active','cancelled')),
  protocol_snapshot jsonb not null,
  instructions_snapshot text,
  instructions_snapshot_hash text,
  photo_followup_snapshot boolean not null default false,
  manual_delivery_at timestamptz,
  manual_delivery_method text,
  manual_delivery_by uuid references auth.users(id),
  manual_delivery_note text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedure_followup_plans_patient_name_check check (length(btrim(patient_name_snapshot)) between 1 and 240),
  constraint procedure_followup_plans_protocol_snapshot_check check (jsonb_typeof(protocol_snapshot) = 'array' and jsonb_array_length(protocol_snapshot) > 0),
  constraint procedure_followup_plans_instructions_check check (instructions_snapshot is null or length(instructions_snapshot) <= 24000),
  constraint procedure_followup_plans_hash_check check (instructions_snapshot_hash is null or instructions_snapshot_hash ~ '^[0-9a-f]{32}$'),
  constraint procedure_followup_plans_delivery_check check ((manual_delivery_at is null and manual_delivery_method is null and manual_delivery_by is null) or (manual_delivery_at is not null and manual_delivery_method in ('verbal','printed','other') and manual_delivery_by is not null)),
  constraint procedure_followup_plans_cancel_check check ((status = 'active' and cancelled_at is null) or (status = 'cancelled' and cancelled_at is not null)),
  constraint procedure_followup_plans_procedure_owner_fkey foreign key (procedure_id,user_id) references public.procedures(id,user_id) on delete set null (procedure_id),
  constraint procedure_followup_plans_patient_owner_fkey foreign key (patient_id,user_id) references public.patients(id,user_id) on delete set null (patient_id),
  constraint procedure_followup_plans_user_procedure_snapshot_key unique (user_id,procedure_id_snapshot),
  constraint procedure_followup_plans_id_user_key unique (id,user_id)
);

create table public.procedure_followup_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  followup_plan_id uuid not null,
  procedure_id uuid,
  procedure_id_snapshot uuid not null,
  patient_id uuid,
  task_key text not null,
  task_type text not null default 'checkin' check (task_type = 'checkin'),
  due_on date not null,
  label text,
  source_steps_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  note text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  cancel_reason text,
  requires_professional_review boolean not null default false,
  review_marked_at timestamptz,
  review_marked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint procedure_followup_tasks_key_check check (length(task_key) between 8 and 80),
  constraint procedure_followup_tasks_label_check check (label is null or length(btrim(label)) between 1 and 160),
  constraint procedure_followup_tasks_source_steps_check check (jsonb_typeof(source_steps_snapshot) = 'array' and jsonb_array_length(source_steps_snapshot) > 0),
  constraint procedure_followup_tasks_note_check check (note is null or length(note) <= 4000),
  constraint procedure_followup_tasks_cancel_reason_check check (cancel_reason is null or length(cancel_reason) <= 500),
  constraint procedure_followup_tasks_terminal_check check (
    (status='pending' and completed_at is null and cancelled_at is null) or
    (status='completed' and completed_at is not null and cancelled_at is null) or
    (status='cancelled' and cancelled_at is not null and completed_at is null)
  ),
  constraint procedure_followup_tasks_review_check check ((not requires_professional_review) or (review_marked_at is not null and review_marked_by is not null)),
  constraint procedure_followup_tasks_plan_owner_fkey foreign key (followup_plan_id,user_id) references public.procedure_followup_plans(id,user_id) on delete cascade,
  constraint procedure_followup_tasks_procedure_owner_fkey foreign key (procedure_id,user_id) references public.procedures(id,user_id) on delete set null (procedure_id),
  constraint procedure_followup_tasks_patient_owner_fkey foreign key (patient_id,user_id) references public.patients(id,user_id) on delete set null (patient_id),
  constraint procedure_followup_tasks_user_plan_key unique (user_id,followup_plan_id,task_key),
  constraint procedure_followup_tasks_id_user_key unique (id,user_id)
);

create index service_aftercare_protocols_user_service_idx on public.service_aftercare_protocols(user_id,service_id);
create index service_aftercare_protocol_steps_user_protocol_idx on public.service_aftercare_protocol_steps(user_id,protocol_id,sort_order,offset_days);
create index procedure_followup_plans_user_patient_created_idx on public.procedure_followup_plans(user_id,patient_id,created_at desc) where patient_id is not null;
create index procedure_followup_plans_procedure_owner_idx on public.procedure_followup_plans(procedure_id,user_id) where procedure_id is not null;
create index procedure_followup_plans_patient_owner_idx on public.procedure_followup_plans(patient_id,user_id) where patient_id is not null;
create index procedure_followup_tasks_user_due_status_idx on public.procedure_followup_tasks(user_id,due_on,status);
create index procedure_followup_tasks_user_patient_due_idx on public.procedure_followup_tasks(user_id,patient_id,due_on) where patient_id is not null;
create index procedure_followup_tasks_plan_owner_idx on public.procedure_followup_tasks(followup_plan_id,user_id);
create index procedure_followup_tasks_procedure_owner_idx on public.procedure_followup_tasks(procedure_id,user_id) where procedure_id is not null;
create index procedure_followup_tasks_patient_owner_idx on public.procedure_followup_tasks(patient_id,user_id) where patient_id is not null;
create index procedure_followup_tasks_completed_by_idx on public.procedure_followup_tasks(completed_by) where completed_by is not null;
create index procedure_followup_tasks_cancelled_by_idx on public.procedure_followup_tasks(cancelled_by) where cancelled_by is not null;
create index procedure_followup_tasks_review_marked_by_idx on public.procedure_followup_tasks(review_marked_by) where review_marked_by is not null;
create index procedure_followup_plans_manual_delivery_by_idx on public.procedure_followup_plans(manual_delivery_by) where manual_delivery_by is not null;
create index procedure_followup_plans_cancelled_by_idx on public.procedure_followup_plans(cancelled_by) where cancelled_by is not null;

alter table public.service_aftercare_protocols enable row level security;
alter table public.service_aftercare_protocol_steps enable row level security;
alter table public.procedure_followup_plans enable row level security;
alter table public.procedure_followup_tasks enable row level security;

create policy service_aftercare_protocols_own on public.service_aftercare_protocols for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy service_aftercare_protocol_steps_own on public.service_aftercare_protocol_steps for all to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy procedure_followup_plans_read_own on public.procedure_followup_plans for select to authenticated using (user_id=(select auth.uid()));
create policy procedure_followup_plans_update_own on public.procedure_followup_plans for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy procedure_followup_tasks_read_own on public.procedure_followup_tasks for select to authenticated using (user_id=(select auth.uid()));
create policy procedure_followup_tasks_update_own on public.procedure_followup_tasks for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

revoke all on public.service_aftercare_protocols, public.service_aftercare_protocol_steps, public.procedure_followup_plans, public.procedure_followup_tasks from public, anon, authenticated;
grant select,insert,update,delete on public.service_aftercare_protocols, public.service_aftercare_protocol_steps to authenticated;
grant select on public.procedure_followup_plans, public.procedure_followup_tasks to authenticated;
grant update(manual_delivery_at,manual_delivery_method,manual_delivery_by,manual_delivery_note,status,cancelled_at,cancelled_by,cancel_reason,updated_at) on public.procedure_followup_plans to authenticated;
grant update(due_on,status,completed_at,completed_by,note,cancelled_at,cancelled_by,cancel_reason,requires_professional_review,review_marked_at,review_marked_by,updated_at) on public.procedure_followup_tasks to authenticated;

create or replace function public.aftercare_touch_updated_at_v1()
returns trigger language plpgsql set search_path='public','pg_temp' as $$
begin new.updated_at:=now(); return new; end; $$;

create trigger service_aftercare_protocols_touch before update on public.service_aftercare_protocols for each row execute function public.aftercare_touch_updated_at_v1();
create trigger procedure_followup_plans_touch before update on public.procedure_followup_plans for each row execute function public.aftercare_touch_updated_at_v1();
create trigger procedure_followup_tasks_touch before update on public.procedure_followup_tasks for each row execute function public.aftercare_touch_updated_at_v1();

create or replace function public.save_service_aftercare_protocol_v1(
  p_service_id uuid,
  p_enabled boolean,
  p_instructions text default null,
  p_photo_followup boolean default false,
  p_steps jsonb default '[]'::jsonb,
  p_name text default 'Pós-atendimento'
) returns jsonb
language plpgsql
set search_path='public','pg_temp'
as $$
declare
  v_user uuid:=auth.uid();
  v_protocol_id uuid;
  v_version integer;
  v_step jsonb;
  v_offset numeric;
  v_count integer:=0;
begin
  if v_user is null then raise exception 'AFTERCARE_SESSION_REQUIRED'; end if;
  if p_service_id is null or not exists(select 1 from public.services s where s.id=p_service_id and s.user_id=v_user) then raise exception 'AFTERCARE_SERVICE_NOT_FOUND'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then raise exception 'AFTERCARE_NAME_INVALID'; end if;
  if p_instructions is not null and length(p_instructions)>12000 then raise exception 'AFTERCARE_INSTRUCTIONS_TOO_LONG'; end if;
  if p_steps is null or jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps)>20 then raise exception 'AFTERCARE_STEPS_INVALID'; end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_count:=v_count+1;
    if jsonb_typeof(v_step)<>'object' or not (v_step ? 'offset_days') or jsonb_typeof(v_step->'offset_days')<>'number' then raise exception 'AFTERCARE_STEP_OFFSET_INVALID'; end if;
    v_offset:=(v_step->>'offset_days')::numeric;
    if v_offset<>trunc(v_offset) or v_offset<0 or v_offset>3650 then raise exception 'AFTERCARE_STEP_OFFSET_INVALID'; end if;
    if nullif(btrim(coalesce(v_step->>'label','')),'') is not null and length(btrim(v_step->>'label'))>120 then raise exception 'AFTERCARE_STEP_LABEL_INVALID'; end if;
  end loop;

  select id,version into v_protocol_id,v_version from public.service_aftercare_protocols where user_id=v_user and service_id=p_service_id for update;
  if found then
    v_version:=v_version+1;
    update public.service_aftercare_protocols set name=btrim(p_name),enabled=coalesce(p_enabled,false),version=v_version,instructions=nullif(btrim(coalesce(p_instructions,'')),''),photo_followup=coalesce(p_photo_followup,false) where id=v_protocol_id and user_id=v_user;
  else
    insert into public.service_aftercare_protocols(user_id,service_id,name,enabled,version,instructions,photo_followup)
    values(v_user,p_service_id,btrim(p_name),coalesce(p_enabled,false),1,nullif(btrim(coalesce(p_instructions,'')),''),coalesce(p_photo_followup,false))
    returning id,version into v_protocol_id,v_version;
  end if;

  delete from public.service_aftercare_protocol_steps where protocol_id=v_protocol_id and user_id=v_user;
  insert into public.service_aftercare_protocol_steps(user_id,protocol_id,step_type,offset_days,label,sort_order)
  select v_user,v_protocol_id,'checkin',(x.step->>'offset_days')::integer,nullif(btrim(coalesce(x.step->>'label','')),''),(x.ord-1)::integer
  from jsonb_array_elements(p_steps) with ordinality as x(step,ord);

  return jsonb_build_object('id',v_protocol_id,'version',v_version,'enabled',coalesce(p_enabled,false),'step_count',v_count);
end; $$;

create or replace function public.get_service_aftercare_protocol_v1(p_service_id uuid)
returns jsonb
language sql
set search_path='public','pg_temp'
as $$
  select jsonb_build_object(
    'id',p.id,'service_id',p.service_id,'name',p.name,'enabled',p.enabled,'version',p.version,
    'instructions',p.instructions,'photo_followup',p.photo_followup,'updated_at',p.updated_at,
    'steps',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'offset_days',s.offset_days,'label',s.label,'sort_order',s.sort_order) order by s.sort_order,s.offset_days,s.id) from public.service_aftercare_protocol_steps s where s.protocol_id=p.id and s.user_id=auth.uid()),'[]'::jsonb)
  )
  from public.service_aftercare_protocols p
  where p.user_id=auth.uid() and p.service_id=p_service_id;
$$;

revoke all on function public.aftercare_touch_updated_at_v1() from public,anon,authenticated;
revoke all on function public.save_service_aftercare_protocol_v1(uuid,boolean,text,boolean,jsonb,text) from public,anon;
revoke all on function public.get_service_aftercare_protocol_v1(uuid) from public,anon;
grant execute on function public.save_service_aftercare_protocol_v1(uuid,boolean,text,boolean,jsonb,text) to authenticated;
grant execute on function public.get_service_aftercare_protocol_v1(uuid) to authenticated;

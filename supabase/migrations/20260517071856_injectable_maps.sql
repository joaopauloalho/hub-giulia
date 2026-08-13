alter table public.services
  add column if not exists is_injectable boolean not null default false;

create table if not exists public.injectable_maps (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid references procedures(id) on delete set null,
  patient_id uuid references patients(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  points jsonb not null default '[]'
);

alter table public.injectable_maps enable row level security;

drop policy if exists "injectable_maps_select_own" on public.injectable_maps;
create policy "injectable_maps_select_own" on public.injectable_maps for select to authenticated using (user_id = auth.uid());

drop policy if exists "injectable_maps_insert_own" on public.injectable_maps;
create policy "injectable_maps_insert_own" on public.injectable_maps for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "injectable_maps_update_own" on public.injectable_maps;
create policy "injectable_maps_update_own" on public.injectable_maps for update to authenticated using (user_id = auth.uid());

drop policy if exists "injectable_maps_delete_own" on public.injectable_maps;
create policy "injectable_maps_delete_own" on public.injectable_maps for delete to authenticated using (user_id = auth.uid());

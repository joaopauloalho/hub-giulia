create table if not exists public.procedure_items (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id uuid not null,
  name text not null check (btrim(name) <> ''),
  qty numeric(10,3) not null default 1 check (qty > 0),
  list_price numeric(12,2) not null check (list_price >= 0),
  final_price numeric(12,2) not null check (final_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  cost_snapshot numeric(12,2) not null default 0 check (cost_snapshot >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_procedure_items_procedure_id on public.procedure_items(procedure_id);
create index if not exists idx_procedure_items_user_id on public.procedure_items(user_id);

alter table public.procedure_items enable row level security;

drop policy if exists "procedure_items_select_own" on public.procedure_items;
create policy "procedure_items_select_own"
on public.procedure_items for select to authenticated
using (user_id = auth.uid());

drop policy if exists "procedure_items_insert_own" on public.procedure_items;
create policy "procedure_items_insert_own"
on public.procedure_items for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.procedures p
    where p.id = procedure_items.procedure_id
      and p.user_id = auth.uid()
  )
);

grant select, insert on table public.procedure_items to authenticated;

create table if not exists public.patient_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  remind_at date,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.patient_notes enable row level security;

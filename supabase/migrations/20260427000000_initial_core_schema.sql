-- Hub Giulia baseline reconstructed from the production schema before the first 20260516 migration.
-- Existing production records this version as already applied; this SQL is for fresh environments.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  email text,
  phone text,
  company text,
  status text default 'active',
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null,
  value numeric,
  stage text default 'lead',
  expected_close date,
  created_at timestamptz default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  birth_date date,
  phone text,
  email text,
  profession text,
  civil_status text,
  weight text,
  height text,
  instagram text,
  emergency_name text,
  emergency_phone text,
  convenio text,
  notes text,
  photo_url text,
  start_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.anamnesis (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conditions jsonb not null default '{}'::jsonb,
  medications text,
  allergies text,
  surgical_history jsonb not null default '{}'::jsonb,
  habits jsonb not null default '{}'::jsonb,
  aesthetics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_photos (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_url text not null,
  label text,
  taken_at timestamptz not null default now()
);

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid references public.contract_templates(id) on delete set null,
  signed_at timestamptz not null default now(),
  signature_data text,
  pdf_url text
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'servico' check (type in ('servico', 'combo', 'plano', 'produto')),
  price numeric not null default 0,
  cost_per_unit numeric not null default 0,
  duration_minutes integer,
  return_min_days integer,
  return_max_days integer,
  technical_sheet text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  scheduled_at timestamptz not null,
  status text not null default 'pendente' check (status in ('pendente', 'confirmado', 'realizado', 'cancelado')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.procedures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  performed_at timestamptz not null default now(),
  services_ids jsonb not null default '[]'::jsonb,
  total_value numeric not null,
  total_cost numeric not null,
  payment_method text not null check (payment_method in ('dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'pix_parcelado')),
  card_fee_pct numeric,
  card_fee_value numeric,
  net_value numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.pix_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid not null references public.procedures(id) on delete cascade,
  installment_num integer not null,
  total_installments integer not null,
  amount numeric not null,
  due_date date not null,
  paid_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_procedures_user_id on public.procedures(user_id);
create index if not exists idx_procedures_patient_id on public.procedures(patient_id);
create index if not exists idx_procedures_performed_at on public.procedures(performed_at);
create index if not exists idx_pix_installments_procedure_id on public.pix_installments(procedure_id);
create index if not exists idx_pix_installments_due_date on public.pix_installments(due_date);
create index if not exists idx_pix_installments_paid_at on public.pix_installments(paid_at);

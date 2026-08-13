alter table public.maquininha_configs
  add column if not exists elo_credito_pct numeric not null default 3.24;

alter table public.maquininha_configs
  add column if not exists elo_debito_pct numeric not null default 1.45;

alter table public.procedure_payments
  drop constraint if exists procedure_payments_user_id_fkey;

alter table public.procedure_payments
  add constraint procedure_payments_user_id_fkey
  foreign key (user_id) references auth.users(id);

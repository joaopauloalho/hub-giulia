alter table public.maquininha_configs
  add column if not exists elo_credito_pct numeric not null default 3.24;

alter table public.maquininha_configs
  add column if not exists elo_debito_pct numeric not null default 1.45;

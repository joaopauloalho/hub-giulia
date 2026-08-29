-- Hub Giulia — ANVISA medication catalog / autocomplete v1
-- Global read-only reference data. Patient anamnesis continues storing medication
-- notes as free text for backwards compatibility; this catalog only powers suggestions.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.normalize_medication_search_v1(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.translate(
        pg_catalog.lower(pg_catalog.coalesce(p_value, '')),
        'áàâãäéèêëíìîïóòôõöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc'
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$$;

revoke all on function public.normalize_medication_search_v1(text) from public, anon;
grant execute on function public.normalize_medication_search_v1(text) to authenticated, service_role;

create table public.medication_catalog (
  source_key text primary key,
  registration_number text,
  product_name text not null,
  active_ingredient text,
  company_name text,
  company_cnpj text,
  category text,
  therapeutic_class text,
  registration_status text not null,
  registration_expiry date,
  process_number text,
  source_name text not null default 'ANVISA',
  source_updated_at timestamptz not null default now(),
  sync_run_id uuid not null,
  search_text text generated always as (
    public.normalize_medication_search_v1(
      product_name || ' ' || pg_catalog.coalesce(active_ingredient, '') || ' ' || pg_catalog.coalesce(company_name, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_catalog_product_name_not_blank check (pg_catalog.btrim(product_name) <> ''),
  constraint medication_catalog_source_key_not_blank check (pg_catalog.btrim(source_key) <> '')
);

create index medication_catalog_search_trgm_idx
  on public.medication_catalog using gin (search_text extensions.gin_trgm_ops);
create index medication_catalog_product_name_idx
  on public.medication_catalog (product_name);
create index medication_catalog_registration_number_idx
  on public.medication_catalog (registration_number)
  where registration_number is not null;

alter table public.medication_catalog enable row level security;

create policy medication_catalog_read_authenticated
  on public.medication_catalog
  for select
  to authenticated
  using (true);

revoke all on table public.medication_catalog from anon;
grant select on table public.medication_catalog to authenticated;
grant all on table public.medication_catalog to service_role;

create table public.medication_catalog_sync_status (
  id smallint primary key default 1,
  source_url text not null,
  source_last_modified text,
  source_etag text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  imported_rows integer not null default 0,
  sync_in_progress boolean not null default false,
  current_run_id uuid,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint medication_catalog_sync_status_singleton check (id = 1),
  constraint medication_catalog_sync_status_rows_nonnegative check (imported_rows >= 0)
);

insert into public.medication_catalog_sync_status (id, source_url)
values (1, 'https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv')
on conflict (id) do nothing;

alter table public.medication_catalog_sync_status enable row level security;

create policy medication_catalog_sync_status_read_authenticated
  on public.medication_catalog_sync_status
  for select
  to authenticated
  using (true);

revoke all on table public.medication_catalog_sync_status from anon;
grant select on table public.medication_catalog_sync_status to authenticated;
grant all on table public.medication_catalog_sync_status to service_role;

create or replace function public.search_medication_catalog_v1(
  p_query text,
  p_limit integer default 12
)
returns table (
  source_key text,
  registration_number text,
  product_name text,
  active_ingredient text,
  company_name text,
  category text,
  therapeutic_class text
)
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_query text := public.normalize_medication_search_v1(p_query);
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 20);
begin
  if char_length(v_query) < 3 then
    return;
  end if;

  return query
  select
    mc.source_key,
    mc.registration_number,
    mc.product_name,
    mc.active_ingredient,
    mc.company_name,
    mc.category,
    mc.therapeutic_class
  from public.medication_catalog mc
  where mc.search_text like '%' || v_query || '%'
  order by
    case
      when public.normalize_medication_search_v1(mc.product_name) = v_query then 0
      when public.normalize_medication_search_v1(mc.product_name) like v_query || '%' then 1
      when public.normalize_medication_search_v1(mc.active_ingredient) like v_query || '%' then 2
      else 3
    end,
    greatest(
      similarity(public.normalize_medication_search_v1(mc.product_name), v_query),
      similarity(public.normalize_medication_search_v1(mc.active_ingredient), v_query)
    ) desc,
    mc.product_name asc
  limit v_limit;
end;
$$;

revoke all on function public.search_medication_catalog_v1(text, integer) from public, anon;
grant execute on function public.search_medication_catalog_v1(text, integer) to authenticated, service_role;

create or replace function public.claim_medication_catalog_sync_v1()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_claimed boolean := false;
begin
  update public.medication_catalog_sync_status
  set sync_in_progress = true,
      current_run_id = v_run_id,
      last_attempt_at = now(),
      last_error = null,
      updated_at = now()
  where id = 1
    and (
      sync_in_progress = false
      or last_attempt_at is null
      or last_attempt_at < now() - interval '20 minutes'
    )
    and (
      last_success_at is null
      or last_success_at < now() - interval '6 hours'
    );

  v_claimed := found;
  if not v_claimed then
    return null;
  end if;
  return v_run_id;
end;
$$;

revoke all on function public.claim_medication_catalog_sync_v1() from public, anon, authenticated;
grant execute on function public.claim_medication_catalog_sync_v1() to service_role;

create or replace function public.finish_medication_catalog_sync_v1(
  p_run_id uuid,
  p_imported_rows integer,
  p_source_last_modified text default null,
  p_source_etag text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.medication_catalog_sync_status
  set sync_in_progress = false,
      current_run_id = null,
      imported_rows = case when p_error is null then greatest(coalesce(p_imported_rows, 0), 0) else imported_rows end,
      last_success_at = case when p_error is null then now() else last_success_at end,
      source_last_modified = case when p_error is null then p_source_last_modified else source_last_modified end,
      source_etag = case when p_error is null then p_source_etag else source_etag end,
      last_error = p_error,
      updated_at = now()
  where id = 1
    and current_run_id = p_run_id;
end;
$$;

revoke all on function public.finish_medication_catalog_sync_v1(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_medication_catalog_sync_v1(uuid, integer, text, text, text) to service_role;

comment on table public.medication_catalog is 'Read-only reference catalog synchronized from ANVISA open medication data.';
comment on function public.search_medication_catalog_v1(text, integer) is 'Autocomplete search for valid ANVISA medication names and active ingredients.';

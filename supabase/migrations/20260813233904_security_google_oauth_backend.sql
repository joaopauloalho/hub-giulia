create table if not exists public.oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'google',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  constraint oauth_states_hash_format_check check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_states_provider_check check (provider = 'google'),
  constraint oauth_states_expiry_check check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint oauth_states_consumed_check check (consumed_at is null or consumed_at >= created_at),
  constraint oauth_states_completed_check check (completed_at is null or consumed_at is not null)
);

create index if not exists oauth_states_user_provider_idx on public.oauth_states (user_id, provider, created_at desc);
create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);

alter table public.oauth_states enable row level security;
drop policy if exists oauth_states_backend_only on public.oauth_states;
create policy oauth_states_backend_only on public.oauth_states for all to authenticated using (false) with check (false);

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  connected boolean not null default false,
  needs_reauth boolean not null default false,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint google_calendar_connections_state_check check (not (connected and needs_reauth))
);

alter table public.google_calendar_connections enable row level security;
drop policy if exists google_calendar_connections_backend_only on public.google_calendar_connections;
create policy google_calendar_connections_backend_only on public.google_calendar_connections for all to authenticated using (false) with check (false);

alter table public.google_calendar_tokens add column if not exists updated_at timestamptz not null default now();

insert into public.google_calendar_connections (user_id, connected, needs_reauth, connected_at, disconnected_at, updated_at)
select user_id, true, false, coalesce(created_at, now()), null, now()
from public.google_calendar_tokens
on conflict (user_id) do update
set connected = true,
    needs_reauth = false,
    connected_at = coalesce(public.google_calendar_connections.connected_at, excluded.connected_at),
    disconnected_at = null,
    updated_at = now();

drop policy if exists google_calendar_tokens_own on public.google_calendar_tokens;
drop policy if exists google_calendar_tokens_select_own_status on public.google_calendar_tokens;
drop policy if exists google_calendar_tokens_delete_own_compat on public.google_calendar_tokens;
create policy google_calendar_tokens_select_own_status on public.google_calendar_tokens
  for select to authenticated using (user_id = (select auth.uid()));
create policy google_calendar_tokens_delete_own_compat on public.google_calendar_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on table public.oauth_states from public, anon, authenticated;
revoke all on table public.google_calendar_connections from public, anon, authenticated;
revoke all on table public.google_calendar_tokens from public, anon, authenticated;
grant all on table public.oauth_states to service_role;
grant all on table public.google_calendar_connections to service_role;
grant all on table public.google_calendar_tokens to service_role;
grant select (user_id) on table public.google_calendar_tokens to authenticated;
grant delete on table public.google_calendar_tokens to authenticated;

create or replace function public.finalize_google_oauth_callback(
  p_state_hash text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_state public.oauth_states;
  v_existing_refresh text;
  v_refresh text;
begin
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'OAUTH_STATE_INVALID';
  end if;
  if p_access_token is null or btrim(p_access_token) = '' or p_expires_at is null then
    raise exception using errcode = '22023', message = 'OAUTH_TOKEN_INVALID';
  end if;

  select * into v_state
  from public.oauth_states
  where state_hash = p_state_hash
    and provider = 'google'
    and consumed_at is not null
    and completed_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'OAUTH_STATE_NOT_CLAIMED';
  end if;

  select refresh_token into v_existing_refresh
  from public.google_calendar_tokens
  where user_id = v_state.user_id
  for update;

  v_refresh := coalesce(nullif(btrim(p_refresh_token), ''), v_existing_refresh);
  if v_refresh is null or btrim(v_refresh) = '' then
    raise exception using errcode = 'P0001', message = 'OAUTH_REFRESH_TOKEN_REQUIRED';
  end if;

  insert into public.google_calendar_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
  values (v_state.user_id, p_access_token, v_refresh, p_expires_at, now())
  on conflict (user_id) do update
  set access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      updated_at = now();

  insert into public.google_calendar_connections (user_id, connected, needs_reauth, connected_at, disconnected_at, updated_at)
  values (v_state.user_id, true, false, now(), null, now())
  on conflict (user_id) do update
  set connected = true,
      needs_reauth = false,
      connected_at = coalesce(public.google_calendar_connections.connected_at, now()),
      disconnected_at = null,
      updated_at = now();

  update public.oauth_states set completed_at = now(), failure_code = null where state_hash = p_state_hash;
end;
$$;

create or replace function public.mark_google_calendar_needs_reauth(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'GOOGLE_USER_REQUIRED';
  end if;
  delete from public.google_calendar_tokens where user_id = p_user_id;
  insert into public.google_calendar_connections (user_id, connected, needs_reauth, connected_at, disconnected_at, updated_at)
  values (p_user_id, false, true, null, now(), now())
  on conflict (user_id) do update
  set connected = false, needs_reauth = true, disconnected_at = now(), updated_at = now();
end;
$$;

create or replace function public.finalize_google_calendar_disconnect(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'GOOGLE_USER_REQUIRED';
  end if;
  delete from public.google_calendar_tokens where user_id = p_user_id;
  insert into public.google_calendar_connections (user_id, connected, needs_reauth, connected_at, disconnected_at, updated_at)
  values (p_user_id, false, false, null, now(), now())
  on conflict (user_id) do update
  set connected = false, needs_reauth = false, disconnected_at = now(), updated_at = now();
end;
$$;

revoke all on function public.finalize_google_oauth_callback(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_google_calendar_needs_reauth(uuid) from public, anon, authenticated;
revoke all on function public.finalize_google_calendar_disconnect(uuid) from public, anon, authenticated;
grant execute on function public.finalize_google_oauth_callback(text, text, text, timestamptz) to service_role;
grant execute on function public.mark_google_calendar_needs_reauth(uuid) to service_role;
grant execute on function public.finalize_google_calendar_disconnect(uuid) to service_role;

-- iCloud v2: classify events without ever changing their original Apple identity.
-- Discarding an item only removes it from the Hub's "to organize" queue.
alter table public.icloud_calendar_events
  add column review_state text not null default 'pending'
  check(review_state in ('pending','personal','dismissed'));
grant update (review_state) on public.icloud_calendar_events to authenticated;

-- Provider imports must preserve patient links, classification and treatment history.
-- In particular, PostgREST upsert with missing columns could otherwise reset links.
create or replace function public.ingest_icloud_events_v2(
  p_user uuid, p_calendar_id text, p_events jsonb, p_seen_at timestamptz
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_affected integer;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',
              current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'BACKEND_ONLY';
  end if;
  if p_user is null or p_calendar_id is null or length(p_calendar_id)=0
     or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 150
     or p_seen_at is null then raise exception 'INVALID_IMPORT'; end if;
  insert into public.icloud_calendar_events (
    user_id,calendar_id,resource_href,recurrence_id,event_uid,etag,title,
    starts_at,ends_at,is_all_day,is_private,is_deleted,last_seen_at,updated_at
  )
  select p_user,p_calendar_id,e.resource_href,coalesce(e.recurrence_id,''),
    e.event_uid,e.etag,coalesce(e.title,''),e.starts_at,e.ends_at,
    coalesce(e.is_all_day,false),coalesce(e.is_private,false),false,
    p_seen_at,p_seen_at
  from jsonb_to_recordset(p_events) as e(
    resource_href text,recurrence_id text,event_uid text,etag text,title text,
    starts_at timestamptz,ends_at timestamptz,is_all_day boolean,is_private boolean
  )
  on conflict (user_id,calendar_id,resource_href,recurrence_id) do update
    set event_uid=excluded.event_uid,
        etag=excluded.etag,
        title=excluded.title,
        starts_at=excluded.starts_at,
        ends_at=excluded.ends_at,
        is_all_day=excluded.is_all_day,
        is_private=excluded.is_private,
        is_deleted=false,
        last_seen_at=excluded.last_seen_at,
        updated_at=excluded.updated_at;
  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;
revoke all on function public.ingest_icloud_events_v2(uuid,text,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.ingest_icloud_events_v2(uuid,text,jsonb,timestamptz)
  to service_role;

-- Only after every item from a calendar has been read and imported successfully
-- may old copies in the queried time range be soft-deleted. Clinical appointments
-- and patient records are never deleted or cancelled by this function.
create or replace function public.finish_icloud_calendar_sync_v2(
  p_user uuid,p_calendar_id text,p_seen_at timestamptz,
  p_from timestamptz,p_to timestamptz
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_affected integer;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',
              current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'BACKEND_ONLY';
  end if;
  if p_user is null or p_calendar_id is null or p_seen_at is null
     or p_from is null or p_to is null or p_to <= p_from
     or p_to-p_from > interval '3 years' then raise exception 'INVALID_SYNC_RANGE'; end if;
  update public.icloud_calendar_events e set is_deleted=true,updated_at=p_seen_at
   where e.user_id=p_user and e.calendar_id=p_calendar_id
     and e.last_seen_at < p_seen_at and e.is_deleted=false
     and e.starts_at < p_to and e.ends_at > p_from;
  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;
revoke all on function public.finish_icloud_calendar_sync_v2(uuid,text,timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.finish_icloud_calendar_sync_v2(uuid,text,timestamptz,timestamptz,timestamptz)
  to service_role;

-- Hourly scheduler authenticates with a random 256-bit Vault token, never
-- a user Apple credential or hardcoded Supabase service-role key.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32),'hex'),
  'hub_giulia_icloud_hourly_token',
  'Hourly iCloud CalDAV sync signed scheduler request'
)
where not exists (select 1 from vault.secrets where name='hub_giulia_icloud_hourly_token');

create or replace function public.verify_icloud_hourly_token_v1(p_token text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_actual text;
begin
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',
              current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'BACKEND_ONLY';
  end if;
  if p_token is null or length(p_token) <> 64 then return false; end if;
  select v.decrypted_secret into v_actual
    from vault.decrypted_secrets v where v.name='hub_giulia_icloud_hourly_token';
  return v_actual is not null and
    extensions.digest(convert_to(p_token,'UTF8'),'sha256') =
    extensions.digest(convert_to(v_actual,'UTF8'),'sha256');
end;
$$;
revoke all on function public.verify_icloud_hourly_token_v1(text)
  from public,anon,authenticated;
grant execute on function public.verify_icloud_hourly_token_v1(text)
  to service_role;

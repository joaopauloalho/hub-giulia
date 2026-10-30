-- Ensure a related record can advance activity without being reset by the
-- patient row's own BEFORE UPDATE trigger. No-op updates stay no-ops.
create or replace function public.patient_self_activity_touch_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'last_activity_at' - 'archived_at')
      is distinct from (to_jsonb(old) - 'last_activity_at' - 'archived_at') then
    new.last_activity_at := greatest(old.last_activity_at, clock_timestamp());
  else
    new.last_activity_at := greatest(
      old.last_activity_at,
      least(coalesce(new.last_activity_at, old.last_activity_at), clock_timestamp())
    );
  end if;
  return new;
end;
$$;

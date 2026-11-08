-- Read-only privilege contract for iCloud event staging.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.icloud_calendar_events'::regclass) then
    raise exception 'RLS must be on for imported iCloud events';
  end if;
  if has_table_privilege('anon', 'public.icloud_calendar_events', 'select')
     or has_table_privilege('anon', 'public.icloud_calendar_events', 'insert')
     or has_table_privilege('anon', 'public.icloud_calendar_events', 'update')
     or has_table_privilege('anon', 'public.icloud_calendar_events', 'delete') then
    raise exception 'Anonymous users must have no iCloud calendar access';
  end if;
  if has_table_privilege('authenticated', 'public.icloud_calendar_events', 'insert')
     or has_table_privilege('authenticated', 'public.icloud_calendar_events', 'delete')
     or has_column_privilege('authenticated', 'public.icloud_calendar_events', 'title', 'update')
     or not has_column_privilege('authenticated', 'public.icloud_calendar_events', 'linked_patient_id', 'update') then
    raise exception 'Provider fields must be server-only; UI may only link patients';
  end if;
end;
$$;

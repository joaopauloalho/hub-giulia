-- Security/read-only contract, run after connection migration.
do $$
begin
  if has_table_privilege('authenticated','public.icloud_calendar_accounts','select') or
     has_table_privilege('anon','public.icloud_calendar_accounts','select') then
    raise exception 'Never expose Apple ID, credentials or encryption ciphertext';
  end if;
  if has_table_privilege('authenticated','public.icloud_calendar_collections','update') or
     has_table_privilege('authenticated','public.icloud_appointment_links','update') then
    raise exception 'External provider identities are backend-owned';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.icloud_calendar_accounts'::regclass) or
     not (select relrowsecurity from pg_class where oid='public.icloud_calendar_collections'::regclass) or
     not (select relrowsecurity from pg_class where oid='public.icloud_appointment_links'::regclass) then
    raise exception 'RLS is required on all iCloud tables';
  end if;
end;
$$;

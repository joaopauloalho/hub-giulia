-- The backend's service_role must be able to perform CalDAV imports.
-- Do not grant these provider-owned writes to anon or authenticated.
grant select, insert, update, delete on table public.icloud_calendar_accounts to service_role;
grant select, insert, update, delete on table public.icloud_calendar_collections to service_role;
grant select, insert, update, delete on table public.icloud_appointment_links to service_role;
grant select, insert, update, delete on table public.icloud_calendar_events to service_role;

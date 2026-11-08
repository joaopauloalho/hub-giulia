-- Run after applying 20261107193000_agenda_overlap_advisory.sql.
-- This test reads metadata only; it does not create or alter patient appointments.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_no_active_overlap'
  ) then
    raise exception 'Overlap must be advisory, not enforced by DB exclusion constraint';
  end if;
end;
$$;

-- A single transaction may insert multiple new patients.
-- Use the wall clock for patient activity to preserve insertion ordering even then.
alter table public.patients
  alter column last_activity_at set default clock_timestamp();

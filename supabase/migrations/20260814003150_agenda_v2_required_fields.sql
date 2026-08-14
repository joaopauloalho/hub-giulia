-- Trigger is already installed by the previous migration, so legacy clients that
-- omit duration/end_at remain compatible before these columns become required.
alter table public.appointments
  alter column duration_minutes set not null,
  alter column end_at set not null;

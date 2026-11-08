-- Hub Giulia: clinic staff may intentionally schedule overlapping appointments.
-- Overlap detection remains an advisory confirmation in the frontend.
-- Preserves all existing appointments and their status/history.
-- The original constraint is in 20260814003200_agenda_v2_overlap.sql.
alter table public.appointments
  drop constraint if exists appointments_no_active_overlap;

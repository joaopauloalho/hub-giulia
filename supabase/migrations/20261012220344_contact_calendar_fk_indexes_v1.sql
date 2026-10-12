-- Indexes for same-owner foreign keys (Supabase performance advisor).
create index if not exists contact_calendar_marks_patient_owner_idx on public.contact_calendar_marks(patient_id,user_id);
create index if not exists contact_calendar_reminders_patient_owner_idx on public.contact_calendar_reminders(patient_id,user_id);
create index if not exists contact_calendar_reminders_procedure_owner_idx on public.contact_calendar_reminders(procedure_id,user_id);

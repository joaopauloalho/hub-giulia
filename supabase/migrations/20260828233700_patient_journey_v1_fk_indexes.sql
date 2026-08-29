-- Cobertura explícita das FKs da Jornada para manter deletes/joins eficientes.
create index if not exists patient_journey_manual_events_patient_owner_idx
  on public.patient_journey_manual_events(patient_id, user_id);

create index if not exists patient_journey_manual_events_created_by_idx
  on public.patient_journey_manual_events(created_by);

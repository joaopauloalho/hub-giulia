-- Hub Giulia 3.6 — covering indexes for Photos 2.0 foreign keys flagged by Performance Advisor.
-- Functional gallery/read indexes remain unchanged; these cover referential maintenance paths.

create index patient_photo_sessions_patient_owner_idx on public.patient_photo_sessions(patient_id,user_id);
create index patient_photo_sessions_appointment_owner_idx on public.patient_photo_sessions(appointment_id,user_id) where appointment_id is not null;
create index patient_photo_sessions_procedure_owner_idx on public.patient_photo_sessions(procedure_id,user_id) where procedure_id is not null;
create index patient_photo_sessions_service_owner_idx on public.patient_photo_sessions(service_id,user_id) where service_id is not null;
create index patient_photo_sessions_created_by_idx on public.patient_photo_sessions(created_by);
create index patient_photo_sessions_voided_by_idx on public.patient_photo_sessions(voided_by) where voided_by is not null;

create index patient_photos_appointment_owner_v2_idx on public.patient_photos(appointment_id,user_id) where appointment_id is not null;
create index patient_photos_service_owner_v2_idx on public.patient_photos(service_id,user_id) where service_id is not null;
create index patient_photos_session_owner_v2_idx on public.patient_photos(photo_session_id,user_id) where photo_session_id is not null;
create index patient_photos_voided_by_idx on public.patient_photos(voided_by) where voided_by is not null;

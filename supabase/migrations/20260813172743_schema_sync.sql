create unique index if not exists patients_id_user_id_uidx
  on public.patients(id, user_id);

alter table public.patient_notes
  drop constraint if exists patient_notes_patient_owner_fkey;

alter table public.patient_notes
  add constraint patient_notes_patient_owner_fkey
  foreign key (patient_id, user_id)
  references public.patients(id, user_id)
  on delete cascade;

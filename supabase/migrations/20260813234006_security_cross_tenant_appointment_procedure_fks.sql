alter table public.appointments drop constraint if exists appointments_patient_owner_fkey;
alter table public.appointments add constraint appointments_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id) not valid;
alter table public.appointments validate constraint appointments_patient_owner_fkey;
alter table public.appointments drop constraint if exists appointments_service_owner_fkey;
alter table public.appointments add constraint appointments_service_owner_fkey foreign key (service_id, user_id) references public.services(id, user_id) not valid;
alter table public.appointments validate constraint appointments_service_owner_fkey;

alter table public.procedures drop constraint if exists procedures_patient_owner_fkey;
alter table public.procedures add constraint procedures_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id) not valid;
alter table public.procedures validate constraint procedures_patient_owner_fkey;
alter table public.procedures drop constraint if exists procedures_appointment_owner_fkey;
alter table public.procedures add constraint procedures_appointment_owner_fkey foreign key (appointment_id, user_id) references public.appointments(id, user_id) not valid;
alter table public.procedures validate constraint procedures_appointment_owner_fkey;

create index if not exists appointments_user_patient_idx on public.appointments(user_id, patient_id);
create index if not exists appointments_user_service_idx on public.appointments(user_id, service_id);
create index if not exists procedures_user_patient_idx on public.procedures(user_id, patient_id);
create index if not exists procedures_user_appointment_idx on public.procedures(user_id, appointment_id);

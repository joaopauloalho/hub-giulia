alter table public.patient_photos add column if not exists procedure_id uuid references public.procedures(id) on delete set null;
alter table public.patient_photos add column if not exists photo_type text not null default 'general' check (photo_type in ('before', 'after', 'general'));

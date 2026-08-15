-- Hub Giulia 3.6 — qualify the outer storage object path inside patient ownership subqueries.
-- The original migration is left immutable; this additive fix prevents patients.name from shadowing storage.objects.name.

drop policy if exists patient_photos_read_owned_v2 on storage.objects;
drop policy if exists patient_photos_write_owned_v2 on storage.objects;

create policy patient_photos_read_owned_v2 on storage.objects
for select to authenticated
using (
  bucket_id='patient-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (
    ((storage.foldername(name))[2]='patients' and (storage.foldername(name))[4]='photos' and exists(
      select 1 from public.patients p
      where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(objects.name))[3]
    ))
    or exists(
      select 1 from public.patients p
      where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(objects.name))[2]
    )
  )
);

create policy patient_photos_write_owned_v2 on storage.objects
for insert to authenticated
with check (
  bucket_id='patient-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and (
    ((storage.foldername(name))[2]='patients' and (storage.foldername(name))[4]='photos' and exists(
      select 1 from public.patients p
      where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(objects.name))[3]
    ))
    or exists(
      select 1 from public.patients p
      where p.user_id=(select auth.uid()) and p.id::text=(storage.foldername(objects.name))[2]
    )
  )
);

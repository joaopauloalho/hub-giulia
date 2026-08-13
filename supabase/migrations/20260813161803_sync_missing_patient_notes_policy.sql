create policy "patient_notes_own" on public.patient_notes
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

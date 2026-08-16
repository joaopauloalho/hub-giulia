-- Hub Giulia 3.9.1: resolve package-specific Supabase Performance Advisor findings.
-- Cover FK columns used by signature lifecycle and avoid per-row auth.uid() re-evaluation.

create index if not exists anamnesis_signature_links_version_fk_idx
  on public.anamnesis_signature_links(anamnesis_version_id);

create index if not exists anamnesis_signature_links_created_by_fk_idx
  on public.anamnesis_signature_links(created_by);

create index if not exists anamnesis_signature_links_patient_fk_idx
  on public.anamnesis_signature_links(patient_id);

create index if not exists anamnesis_signatures_patient_fk_idx
  on public.anamnesis_signatures(patient_id);

drop policy if exists anamnesis_signature_links_select_own_v1
  on public.anamnesis_signature_links;
create policy anamnesis_signature_links_select_own_v1
  on public.anamnesis_signature_links
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists anamnesis_signatures_select_own_v1
  on public.anamnesis_signatures;
create policy anamnesis_signatures_select_own_v1
  on public.anamnesis_signatures
  for select
  to authenticated
  using (user_id = (select auth.uid()));

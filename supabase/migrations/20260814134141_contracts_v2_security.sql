-- Hub Giulia 2.2 — Contratos 2.0 / Security, immutability and Storage

alter table public.professional_profiles enable row level security;
alter table public.contract_template_versions enable row level security;

-- Templates are mutated only through controlled versioning RPCs.
drop policy if exists contract_templates_own on public.contract_templates;
drop policy if exists contract_templates_select_own_v2 on public.contract_templates;
create policy contract_templates_select_own_v2 on public.contract_templates
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Immutable template versions: read-only to the owner from the API.
drop policy if exists contract_template_versions_select_own_v2 on public.contract_template_versions;
create policy contract_template_versions_select_own_v2 on public.contract_template_versions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Minimal professional profile is also changed only through its RPC.
drop policy if exists professional_profiles_select_own_v2 on public.professional_profiles;
create policy professional_profiles_select_own_v2 on public.professional_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Contracts: v2 writes are RPC-only. The narrow legacy compatibility path remains
-- available during rollout so the production UI can finish a just-created PDF.
drop policy if exists contracts_own on public.contracts;
drop policy if exists contracts_select_own_v2 on public.contracts;
drop policy if exists contracts_insert_legacy_compat on public.contracts;
drop policy if exists contracts_update_legacy_compat on public.contracts;
drop policy if exists contracts_delete_incomplete_legacy_compat on public.contracts;

create policy contracts_select_own_v2 on public.contracts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy contracts_insert_legacy_compat on public.contracts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and source_type = 'legacy'
    and document_schema_version = 1
    and status = 'signed'
  );

create policy contracts_update_legacy_compat on public.contracts
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and source_type = 'legacy'
    and pdf_url is null
  )
  with check (
    user_id = (select auth.uid())
    and source_type = 'legacy'
    and document_schema_version = 1
    and status = 'signed'
  );

create policy contracts_delete_incomplete_legacy_compat on public.contracts
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and source_type = 'legacy'
    and pdf_url is null
  );

create or replace function public.contract_template_version_immutable_guard_v2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'CONTRACT_TEMPLATE_VERSION_IMMUTABLE';
end;
$$;

drop trigger if exists contract_template_version_immutable_guard_v2 on public.contract_template_versions;
create trigger contract_template_version_immutable_guard_v2
before update or delete on public.contract_template_versions
for each row execute function public.contract_template_version_immutable_guard_v2();

create or replace function public.contract_immutability_guard_v2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.source_type = 'legacy' and old.pdf_url is null then
      return old;
    end if;
    if old.source_type = 'v2' and old.status in ('draft','ready') then
      return old;
    end if;
    raise exception 'CONTRACT_IMMUTABLE';
  end if;

  if new.source_type = 'v2' and new.status in ('ready','signed') then
    if new.document_schema_version < 2
      or new.template_id is null
      or new.template_version_id is null
      or new.document_name_snapshot is null
      or new.patient_snapshot is null
      or new.professional_snapshot is null
      or new.services_snapshot is null
      or new.variables_snapshot is null
      or new.rendered_content_snapshot is null
      or char_length(new.rendered_content_snapshot) = 0
      or new.content_sha256 !~ '^[0-9a-f]{64}$'
    then
      raise exception 'CONTRACT_V2_SNAPSHOT_INCOMPLETE';
    end if;
  end if;

  if new.source_type = 'v2' and new.status = 'signed' then
    if new.signed_at is null
      or new.signature_path is null
      or new.signature_sha256 !~ '^[0-9a-f]{64}$'
      or new.pdf_path is null
      or new.pdf_sha256 !~ '^[0-9a-f]{64}$'
      or new.finalize_idempotency_key is null
    then
      raise exception 'CONTRACT_V2_SIGNED_INCOMPLETE';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if old.source_type = 'legacy' then
      if old.pdf_url is not null then
        if new is distinct from old then raise exception 'CONTRACT_LEGACY_IMMUTABLE'; end if;
      else
        if new.patient_id is distinct from old.patient_id
          or new.user_id is distinct from old.user_id
          or new.template_id is distinct from old.template_id
          or new.signed_at is distinct from old.signed_at
          or new.signature_data is distinct from old.signature_data
          or new.status is distinct from old.status
          or new.source_type is distinct from old.source_type
          or new.document_schema_version is distinct from old.document_schema_version
        then
          raise exception 'CONTRACT_LEGACY_MUTATION_BLOCKED';
        end if;
      end if;
      return new;
    end if;

    if old.status in ('signed','voided') then
      if new.patient_id is distinct from old.patient_id
        or new.user_id is distinct from old.user_id
        or new.template_id is distinct from old.template_id
        or new.template_version_id is distinct from old.template_version_id
        or new.appointment_id is distinct from old.appointment_id
        or new.procedure_id is distinct from old.procedure_id
        or new.document_name_snapshot is distinct from old.document_name_snapshot
        or new.patient_snapshot is distinct from old.patient_snapshot
        or new.professional_snapshot is distinct from old.professional_snapshot
        or new.services_snapshot is distinct from old.services_snapshot
        or new.financial_snapshot is distinct from old.financial_snapshot
        or new.context_snapshot is distinct from old.context_snapshot
        or new.variables_snapshot is distinct from old.variables_snapshot
        or new.rendered_content_snapshot is distinct from old.rendered_content_snapshot
        or new.content_sha256 is distinct from old.content_sha256
        or new.signature_path is distinct from old.signature_path
        or new.signature_sha256 is distinct from old.signature_sha256
        or new.pdf_path is distinct from old.pdf_path
        or new.pdf_sha256 is distinct from old.pdf_sha256
        or new.signed_at is distinct from old.signed_at
        or new.document_schema_version is distinct from old.document_schema_version
        or new.source_type is distinct from old.source_type
        or new.prepare_idempotency_key is distinct from old.prepare_idempotency_key
        or new.prepare_payload_hash is distinct from old.prepare_payload_hash
        or new.finalize_idempotency_key is distinct from old.finalize_idempotency_key
      then
        raise exception 'CONTRACT_IMMUTABLE';
      end if;

      if old.status = 'signed' then
        if new.status not in ('signed','voided') then raise exception 'CONTRACT_INVALID_TRANSITION'; end if;
        if new.status = 'signed' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
          raise exception 'CONTRACT_INVALID_TRANSITION';
        end if;
        if new.status = 'voided' and (new.voided_at is null or char_length(btrim(coalesce(new.void_reason, ''))) = 0) then
          raise exception 'CONTRACT_VOID_REASON_REQUIRED';
        end if;
      else
        if new.status <> 'voided'
          or new.voided_at is distinct from old.voided_at
          or new.void_reason is distinct from old.void_reason
        then
          raise exception 'CONTRACT_IMMUTABLE';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists contract_immutability_guard_v2 on public.contracts;
create trigger contract_immutability_guard_v2
before insert or update or delete on public.contracts
for each row execute function public.contract_immutability_guard_v2();

-- API grants are explicit. No anon access to clinical/legal documents.
revoke all on table public.contract_template_versions from public, anon;
revoke all on table public.professional_profiles from public, anon;
revoke all on table public.contract_templates from anon;
revoke all on table public.contracts from anon;

revoke insert, update, delete on table public.contract_templates from authenticated;
revoke insert, update, delete on table public.contract_template_versions from authenticated;
revoke insert, update, delete on table public.professional_profiles from authenticated;

grant select on table public.contract_templates to authenticated;
grant select on table public.contract_template_versions to authenticated;
grant select on table public.professional_profiles to authenticated;
grant select, insert, update, delete on table public.contracts to authenticated;

revoke execute on function public.contract_template_variables_v2(text) from public, anon, authenticated;
revoke execute on function public.contract_assert_template_placeholders_v2(text) from public, anon, authenticated;
revoke execute on function public.contract_render_v2(text, jsonb) from public, anon, authenticated;
revoke execute on function public.contract_template_version_immutable_guard_v2() from public, anon, authenticated;
revoke execute on function public.contract_immutability_guard_v2() from public, anon, authenticated;

revoke execute on function public.save_contract_template_v2(uuid,text,text) from public, anon;
revoke execute on function public.set_contract_template_active_v2(uuid,boolean) from public, anon;
revoke execute on function public.upsert_professional_profile_v2(text,text,text) from public, anon;
revoke execute on function public.prepare_contract_v2(uuid,uuid,uuid,uuid,uuid) from public, anon;
revoke execute on function public.finalize_contract_v2(uuid,text,text,text,text,uuid) from public, anon;
revoke execute on function public.void_contract_v2(uuid,text) from public, anon;

grant execute on function public.save_contract_template_v2(uuid,text,text) to authenticated;
grant execute on function public.set_contract_template_active_v2(uuid,boolean) to authenticated;
grant execute on function public.upsert_professional_profile_v2(text,text,text) to authenticated;
grant execute on function public.prepare_contract_v2(uuid,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.finalize_contract_v2(uuid,text,text,text,text,uuid) to authenticated;
grant execute on function public.void_contract_v2(uuid,text) to authenticated;

-- Private contracts bucket: only PDFs and PNG signatures, bounded size.
update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf','image/png']::text[]
where id = 'contracts';

drop policy if exists contracts_read_own_folder on storage.objects;
drop policy if exists contracts_write_own_folder on storage.objects;
drop policy if exists contracts_update_own_folder on storage.objects;
drop policy if exists contracts_read_own_folder_v2 on storage.objects;
drop policy if exists contracts_write_owned_artifact_v2 on storage.objects;
drop policy if exists contracts_update_pending_artifact_v2 on storage.objects;

create policy contracts_read_own_folder_v2 on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy contracts_write_owned_artifact_v2 on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      exists (
        select 1 from public.contracts c
        where c.user_id = (select auth.uid())
          and c.source_type = 'v2'
          and c.status in ('draft','ready')
          and c.id::text = (storage.foldername(name))[2]
          and storage.filename(name) in ('signature.png','document.pdf')
      )
      or exists (
        select 1 from public.contracts c
        where c.user_id = (select auth.uid())
          and c.source_type = 'legacy'
          and c.pdf_url is null
          and storage.filename(name) = c.id::text || '.pdf'
      )
    )
  );

create policy contracts_update_pending_artifact_v2 on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      exists (
        select 1 from public.contracts c
        where c.user_id = (select auth.uid())
          and c.source_type = 'v2'
          and c.status in ('draft','ready')
          and c.id::text = (storage.foldername(name))[2]
      )
      or exists (
        select 1 from public.contracts c
        where c.user_id = (select auth.uid())
          and c.source_type = 'legacy'
          and c.pdf_url is null
          and storage.filename(name) = c.id::text || '.pdf'
      )
    )
  )
  with check (
    bucket_id = 'contracts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
      exists (
        select 1 from public.contracts c
        where c.user_id = (select auth.uid())
          and c.source_type = 'v2'
          and c.status in ('draft','ready')
          and c.id::text = (storage.foldername(name))[2]
          and storage.filename(name) in ('signature.png','document.pdf')
      )
      or exists (
        select 1 from public.contracts c
        where c.user_id = (select auth.uid())
          and c.source_type = 'legacy'
          and c.pdf_url is null
          and storage.filename(name) = c.id::text || '.pdf'
      )
    )
  );

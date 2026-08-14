-- Hub Giulia 2.2 — Contratos 2.0 / legacy void compatibility
-- Completed legacy documents remain immutable, with one explicit historical
-- transition allowed: signed -> voided with reason. The original PDF/signature
-- and every legacy field remain untouched.

create or replace function public.contract_immutability_guard_v2()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.source_type = 'legacy' and old.pdf_url is null then return old; end if;
    if old.source_type = 'v2' and old.status in ('draft','ready') then return old; end if;
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
        if old.status = 'signed'
          and new.status = 'voided'
          and new.voided_at is not null
          and char_length(btrim(coalesce(new.void_reason, ''))) > 0
          and new.patient_id is not distinct from old.patient_id
          and new.user_id is not distinct from old.user_id
          and new.template_id is not distinct from old.template_id
          and new.signed_at is not distinct from old.signed_at
          and new.signature_data is not distinct from old.signature_data
          and new.pdf_url is not distinct from old.pdf_url
          and new.pdf_path is not distinct from old.pdf_path
          and new.source_type is not distinct from old.source_type
          and new.document_schema_version is not distinct from old.document_schema_version
          and new.created_at is not distinct from old.created_at
        then
          return new;
        end if;
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

revoke execute on function public.contract_immutability_guard_v2() from public, anon, authenticated;

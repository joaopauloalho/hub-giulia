-- Hub Giulia 2.2 — Contratos 2.0 / backend-only artifact finalization
-- The public finalizer is no longer client-callable. Actual artifact hashes are
-- computed by the authenticated Edge Function, then committed through this
-- service-role-only transactional operation.

revoke execute on function public.finalize_contract_v2(uuid,text,text,text,text,uuid) from authenticated;
revoke execute on function public.finalize_contract_v2(uuid,text,text,text,text,uuid) from public, anon;

create or replace function public.finalize_contract_backend_v2(
  p_user_id uuid,
  p_contract_id uuid,
  p_signature_path text,
  p_signature_sha256 text,
  p_pdf_path text,
  p_pdf_sha256 text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_contract public.contracts%rowtype;
  v_expected_signature text;
  v_expected_pdf text;
begin
  if p_user_id is null then raise exception 'CONTRACT_BACKEND_USER_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'CONTRACT_FINALIZE_IDEMPOTENCY_REQUIRED'; end if;
  if p_signature_sha256 !~ '^[0-9a-f]{64}$' or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'CONTRACT_ARTIFACT_HASH_INVALID';
  end if;

  select * into v_contract
  from public.contracts
  where id = p_contract_id and user_id = p_user_id
  for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;

  if v_contract.status = 'signed' then
    if v_contract.finalize_idempotency_key = p_idempotency_key
      and v_contract.signature_sha256 = p_signature_sha256
      and v_contract.pdf_sha256 = p_pdf_sha256
    then
      return jsonb_build_object(
        'id', v_contract.id,
        'status', v_contract.status,
        'signed_at', v_contract.signed_at,
        'pdf_path', v_contract.pdf_path,
        'content_sha256', v_contract.content_sha256,
        'signature_sha256', v_contract.signature_sha256,
        'pdf_sha256', v_contract.pdf_sha256
      );
    end if;
    raise exception 'CONTRACT_ALREADY_FINALIZED';
  end if;

  if v_contract.status <> 'ready' or v_contract.source_type <> 'v2' then
    raise exception 'CONTRACT_NOT_READY';
  end if;

  v_expected_signature := p_user_id::text || '/' || p_contract_id::text || '/signature.png';
  v_expected_pdf := p_user_id::text || '/' || p_contract_id::text || '/document.pdf';
  if p_signature_path <> v_expected_signature or p_pdf_path <> v_expected_pdf then
    raise exception 'CONTRACT_ARTIFACT_PATH_INVALID';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'contracts' and name = v_expected_signature) then
    raise exception 'CONTRACT_SIGNATURE_NOT_FOUND';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'contracts' and name = v_expected_pdf) then
    raise exception 'CONTRACT_PDF_NOT_FOUND';
  end if;

  update public.contracts
  set signature_path = p_signature_path,
      signature_sha256 = p_signature_sha256,
      pdf_path = p_pdf_path,
      pdf_url = p_pdf_path,
      pdf_sha256 = p_pdf_sha256,
      finalize_idempotency_key = p_idempotency_key,
      signed_at = now(),
      status = 'signed'
  where id = p_contract_id and user_id = p_user_id
  returning * into v_contract;

  return jsonb_build_object(
    'id', v_contract.id,
    'status', v_contract.status,
    'signed_at', v_contract.signed_at,
    'pdf_path', v_contract.pdf_path,
    'content_sha256', v_contract.content_sha256,
    'signature_sha256', v_contract.signature_sha256,
    'pdf_sha256', v_contract.pdf_sha256
  );
end;
$$;

revoke execute on function public.finalize_contract_backend_v2(uuid,uuid,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.finalize_contract_backend_v2(uuid,uuid,text,text,text,text,uuid) to service_role;

import {
  HttpError,
  assertMethod,
  authenticate,
  createAdminClient,
  json,
  logSafe,
  preflight,
} from '../_shared/google-calendar-security.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    assertMethod(req, 'POST');
    const { user, client } = await authenticate(req);
    const body = await req.json().catch(() => ({})) as { contract_id?: string; idempotency_key?: string };
    const contractId = body.contract_id ?? '';
    const idempotencyKey = body.idempotency_key ?? '';

    if (!UUID_RE.test(contractId) || !UUID_RE.test(idempotencyKey)) {
      throw new HttpError(400, 'contract_finalize_invalid_request', 'Dados de finalizacao invalidos.');
    }

    const signaturePath = `${user.id}/${contractId}/signature.png`;
    const pdfPath = `${user.id}/${contractId}/document.pdf`;
    const [{ data: signature, error: signatureError }, { data: pdf, error: pdfError }] = await Promise.all([
      client.storage.from('contracts').download(signaturePath),
      client.storage.from('contracts').download(pdfPath),
    ]);

    if (signatureError || !signature) {
      throw new HttpError(409, 'contract_signature_missing', 'Nao foi possivel validar a assinatura.');
    }
    if (pdfError || !pdf) {
      throw new HttpError(409, 'contract_pdf_missing', 'Nao foi possivel validar o PDF.');
    }

    const [signatureHash, pdfHash] = await Promise.all([sha256Hex(signature), sha256Hex(pdf)]);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('finalize_contract_backend_v2', {
      p_user_id: user.id,
      p_contract_id: contractId,
      p_signature_path: signaturePath,
      p_signature_sha256: signatureHash,
      p_pdf_path: pdfPath,
      p_pdf_sha256: pdfHash,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const code = /ALREADY_FINALIZED/.test(error.message) ? 'contract_already_finalized' : 'contract_finalize_failed';
      throw new HttpError(409, code, code === 'contract_already_finalized' ? 'Este documento ja foi finalizado.' : 'Nao foi possivel finalizar o contrato.');
    }

    return json(req, { contract: data });
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'contract_finalize_failed', 'Nao foi possivel finalizar o contrato.');
    logSafe('contract-finalize', httpError.code, httpError.status);
    return json(req, { error: httpError.code, message: httpError.message }, httpError.status);
  }
});

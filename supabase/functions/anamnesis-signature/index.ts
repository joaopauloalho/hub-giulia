import {
  HttpError,
  authenticate,
  createAdminClient,
  isAllowedOrigin,
  logSafe,
  randomOpaqueState,
  sha256Hex,
} from '../_shared/google-calendar-security.ts';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_BYTES = 1_500_000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const VERIFICATION_LOCK_MS = 15 * 60 * 1000;

type DeliveryMode = 'legacy' | 'in_person' | 'remote';
type VerificationMethod = 'birth_date' | 'phone_last4';
type AdminClient = ReturnType<typeof createAdminClient>;
type SignatureLink = {
  id: string;
  user_id: string;
  patient_id: string;
  anamnesis_version_id: string;
  content_sha256: string;
  delivery_mode: DeliveryMode;
  verification_attempts: number;
  verification_locked_until: string | null;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
};

function headers(req: Request) {
  const origin = req.headers.get('Origin');
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://hub-giulia.vercel.app').replace(/\/$/, '');
  const allowed = origin && isAllowedOrigin(origin) ? origin : appUrl;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private, max-age=0',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function reply(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}

function decodeSignature(dataUrl: string) {
  if (!dataUrl.startsWith(PNG_PREFIX)) throw new HttpError(400, 'signature_invalid', 'Assinatura inválida.');
  const encoded = dataUrl.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length > Math.ceil(MAX_SIGNATURE_BYTES * 4 / 3) + 16) {
    throw new HttpError(413, 'signature_too_large', 'Assinatura muito grande.');
  }
  let binary = '';
  try { binary = atob(encoded); } catch { throw new HttpError(400, 'signature_invalid', 'Assinatura inválida.'); }
  if (!binary || binary.length > MAX_SIGNATURE_BYTES) throw new HttpError(413, 'signature_too_large', 'Assinatura muito grande.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new HttpError(400, 'signature_invalid', 'Assinatura inválida.');
  }
  return new Blob([bytes], { type: 'image/png' });
}

async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function signatureTtlHours() {
  const configured = Number(Deno.env.get('ANAMNESIS_SIGNATURE_TTL_HOURS') ?? '168');
  if (!Number.isFinite(configured)) return 168;
  return Math.max(1, Math.min(720, Math.round(configured)));
}

function phoneDigits(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '');
}

function recipientMethod(patient: { birth_date: string | null; phone: string | null }): VerificationMethod | null {
  if (patient.birth_date) return 'birth_date';
  return phoneDigits(patient.phone).length >= 4 ? 'phone_last4' : null;
}

async function loadByToken(admin: AdminClient, token: string): Promise<SignatureLink> {
  if (!TOKEN_RE.test(token)) throw new HttpError(404, 'signature_link_invalid', 'Link inválido.');
  const tokenHash = await sha256Hex(token);
  const { data: link, error } = await admin
    .from('anamnesis_signature_links')
    .select('id,user_id,patient_id,anamnesis_version_id,content_sha256,delivery_mode,verification_attempts,verification_locked_until,expires_at,revoked_at,consumed_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !link) throw new HttpError(404, 'signature_link_invalid', 'Link inválido.');
  if (link.revoked_at) throw new HttpError(410, 'signature_link_revoked', 'Este link foi revogado.');
  if (new Date(link.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'signature_link_expired', 'Este link expirou. Solicite um novo link à clínica.');
  return link as SignatureLink;
}

async function loadPatientForVerification(admin: AdminClient, userId: string, patientId: string) {
  const { data: patient, error } = await admin
    .from('patients')
    .select('name,birth_date,phone')
    .eq('id', patientId)
    .eq('user_id', userId)
    .single();
  if (error || !patient) throw new HttpError(404, 'signature_content_not_found', 'Conteúdo não encontrado.');
  return patient as { name: string; birth_date: string | null; phone: string | null };
}

async function requireRecipientVerification(admin: AdminClient, link: SignatureLink, patient: { birth_date: string | null; phone: string | null }, supplied: string) {
  if (link.delivery_mode !== 'remote') return { verified: true as const, method: null };
  const method = recipientMethod(patient);
  if (!method) throw new HttpError(409, 'signature_recipient_verification_unavailable', 'A clínica precisa cadastrar data de nascimento ou telefone antes de enviar a assinatura remotamente.');
  if (!supplied.trim()) return { verified: false as const, method };

  if (link.verification_locked_until && new Date(link.verification_locked_until).getTime() > Date.now()) {
    throw new HttpError(429, 'signature_verification_locked', 'Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
  }

  const expected = method === 'birth_date'
    ? String(patient.birth_date ?? '').slice(0, 10)
    : phoneDigits(patient.phone).slice(-4);
  const normalized = method === 'birth_date' ? supplied.trim().slice(0, 10) : phoneDigits(supplied).slice(-4);

  if (!expected || normalized !== expected) {
    const attempts = Math.min(Number(link.verification_attempts ?? 0) + 1, MAX_VERIFICATION_ATTEMPTS);
    const lockedUntil = attempts >= MAX_VERIFICATION_ATTEMPTS ? new Date(Date.now() + VERIFICATION_LOCK_MS).toISOString() : null;
    await admin.from('anamnesis_signature_links').update({ verification_attempts: attempts, verification_locked_until: lockedUntil }).eq('id', link.id);
    if (lockedUntil) throw new HttpError(429, 'signature_verification_locked', 'Muitas tentativas incorretas. Aguarde alguns minutos e tente novamente.');
    throw new HttpError(401, 'signature_verification_failed', 'Os dados informados não conferem. Revise e tente novamente.');
  }

  if (link.verification_attempts || link.verification_locked_until) {
    await admin.from('anamnesis_signature_links').update({ verification_attempts: 0, verification_locked_until: null }).eq('id', link.id);
  }
  return { verified: true as const, method };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  if (origin && !isAllowedOrigin(origin)) return reply(req, { error: 'origin_not_allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: headers(req) });

  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Método não permitido.');
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? '');
    const admin = createAdminClient();

    if (action === 'create') {
      const { user } = await authenticate(req);
      const versionId = String(body.version_id ?? '');
      const deliveryMode = String(body.delivery_mode ?? '') as DeliveryMode;
      if (!UUID_RE.test(versionId)) throw new HttpError(400, 'signature_version_invalid', 'Versão inválida.');
      if (!['in_person', 'remote'].includes(deliveryMode)) throw new HttpError(400, 'signature_delivery_mode_invalid', 'Escolha como a paciente fará a assinatura.');

      const { data: version, error: versionError } = await admin
        .from('anamnesis_versions')
        .select('id,user_id,patient_id,version_number,completed_at')
        .eq('id', versionId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (versionError || !version) throw new HttpError(404, 'signature_version_not_found', 'Versão da anamnese não encontrada.');

      const { data: existingSignature } = await admin
        .from('anamnesis_signatures')
        .select('id,signed_at')
        .eq('anamnesis_version_id', versionId)
        .maybeSingle();
      if (existingSignature) throw new HttpError(409, 'signature_already_signed', 'Esta versão já foi assinada.');

      if (deliveryMode === 'remote') {
        const patient = await loadPatientForVerification(admin, user.id, version.patient_id);
        if (!recipientMethod(patient)) throw new HttpError(409, 'signature_recipient_verification_unavailable', 'Cadastre a data de nascimento ou o telefone da paciente antes de enviar a assinatura remotamente.');
      }

      const { data: hashRows, error: hashError } = await admin.rpc('anamnesis_version_content_sha256_v1', { p_version_id: versionId });
      const contentHash = typeof hashRows === 'string' ? hashRows : null;
      if (hashError || !contentHash) throw new HttpError(500, 'signature_hash_failed', 'Não foi possível preparar o conteúdo para assinatura.');

      await admin
        .from('anamnesis_signature_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('anamnesis_version_id', versionId)
        .is('revoked_at', null)
        .is('consumed_at', null);

      const token = randomOpaqueState();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + signatureTtlHours() * 60 * 60 * 1000).toISOString();
      const { data: link, error: insertError } = await admin
        .from('anamnesis_signature_links')
        .insert({
          user_id: user.id,
          patient_id: version.patient_id,
          anamnesis_version_id: version.id,
          token_hash: tokenHash,
          content_sha256: contentHash,
          delivery_mode: deliveryMode,
          expires_at: expiresAt,
          created_by: user.id,
        })
        .select('id,expires_at,delivery_mode')
        .single();
      if (insertError || !link) throw new HttpError(500, 'signature_link_create_failed', 'Não foi possível gerar o acesso.');
      return reply(req, { link_id: link.id, token, expires_at: link.expires_at, version_number: version.version_number, delivery_mode: link.delivery_mode });
    }

    if (action === 'revoke') {
      const { user } = await authenticate(req);
      const linkId = String(body.link_id ?? '');
      if (!UUID_RE.test(linkId)) throw new HttpError(400, 'signature_link_invalid', 'Link inválido.');
      const { data, error } = await admin
        .from('anamnesis_signature_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', linkId)
        .eq('user_id', user.id)
        .is('consumed_at', null)
        .select('id')
        .maybeSingle();
      if (error || !data) throw new HttpError(404, 'signature_link_not_found', 'Acesso não encontrado ou já encerrado.');
      return reply(req, { revoked: true });
    }

    if (action === 'view') {
      const token = String(body.token ?? '');
      const link = await loadByToken(admin, token);
      const { data: signature } = await admin
        .from('anamnesis_signatures')
        .select('signed_at')
        .eq('anamnesis_version_id', link.anamnesis_version_id)
        .maybeSingle();
      if (link.consumed_at || signature) return reply(req, { status: 'signed', signed_at: signature?.signed_at ?? link.consumed_at, delivery_mode: link.delivery_mode });

      const patient = await loadPatientForVerification(admin, link.user_id, link.patient_id);
      const verification = await requireRecipientVerification(admin, link, patient, String(body.verification_value ?? ''));
      if (!verification.verified) {
        return reply(req, {
          status: 'verification_required',
          verification_method: verification.method,
          delivery_mode: link.delivery_mode,
          expires_at: link.expires_at,
        });
      }

      const { data: version, error: versionError } = await admin.from('anamnesis_versions')
        .select('id,version_number,form_schema_version,answers_snapshot,form_schema_snapshot,completed_at')
        .eq('id', link.anamnesis_version_id).eq('user_id', link.user_id).single();
      if (versionError || !version) throw new HttpError(404, 'signature_content_not_found', 'Conteúdo não encontrado.');
      const { data: currentHash, error: hashError } = await admin.rpc('anamnesis_version_content_sha256_v1', { p_version_id: version.id });
      if (hashError || currentHash !== link.content_sha256) throw new HttpError(409, 'signature_content_changed', 'A versão preparada não corresponde mais ao conteúdo esperado.');
      return reply(req, {
        status: 'pending',
        delivery_mode: link.delivery_mode,
        patient_name: patient.name,
        version_number: version.version_number,
        completed_at: version.completed_at,
        form_schema_version: version.form_schema_version,
        answers_snapshot: version.answers_snapshot,
        form_schema_snapshot: version.form_schema_snapshot,
        content_sha256: link.content_sha256,
        expires_at: link.expires_at,
      });
    }

    if (action === 'sign') {
      const token = String(body.token ?? '');
      const link = await loadByToken(admin, token);
      const { data: existing } = await admin
        .from('anamnesis_signatures')
        .select('id,signed_at')
        .eq('anamnesis_version_id', link.anamnesis_version_id)
        .maybeSingle();
      if (existing) return reply(req, { status: 'signed', signed_at: existing.signed_at });
      if (link.consumed_at) throw new HttpError(409, 'signature_link_consumed', 'Este link já foi utilizado.');

      const patient = await loadPatientForVerification(admin, link.user_id, link.patient_id);
      const verification = await requireRecipientVerification(admin, link, patient, String(body.verification_value ?? ''));
      if (!verification.verified) throw new HttpError(401, 'signature_verification_required', 'Confirme seus dados antes de assinar.');

      const signatureBlob = decodeSignature(String(body.signature_data ?? ''));
      const signatureHash = await hashBlob(signatureBlob);
      const path = `${link.user_id}/anamnesis/${link.anamnesis_version_id}/signature-${link.id}.png`;
      const { error: uploadError } = await admin.storage.from('contracts').upload(path, signatureBlob, {
        contentType: 'image/png', cacheControl: '0', upsert: false,
      });
      if (uploadError && !/exist|duplicate/i.test(uploadError.message)) {
        throw new HttpError(500, 'signature_upload_failed', 'Não foi possível salvar a assinatura.');
      }

      const auditMetadata = {
        method: 'remote_signature_pad',
        delivery_mode: link.delivery_mode,
        recipient_verification: verification.method ?? 'not_required',
        user_agent_family: String(req.headers.get('User-Agent') ?? '').slice(0, 80) || null,
      };
      const { data: result, error: consumeError } = await admin.rpc('consume_anamnesis_signature_link_v1', {
        p_link_id: link.id,
        p_signature_path: path,
        p_signature_sha256: signatureHash,
        p_audit_metadata: auditMetadata,
      });
      if (consumeError) {
        const { data: raced } = await admin.from('anamnesis_signatures').select('signed_at').eq('anamnesis_version_id', link.anamnesis_version_id).maybeSingle();
        if (raced) return reply(req, { status: 'signed', signed_at: raced.signed_at });
        if (!uploadError) await admin.storage.from('contracts').remove([path]);
        throw new HttpError(409, 'signature_finalize_failed', 'Não foi possível concluir a assinatura. Solicite um novo link se necessário.');
      }
      const row = Array.isArray(result) ? result[0] : result;
      return reply(req, { status: 'signed', signed_at: row?.signed_at ?? new Date().toISOString() });
    }

    throw new HttpError(400, 'action_invalid', 'Ação inválida.');
  } catch (error) {
    const http = error instanceof HttpError ? error : new HttpError(500, 'signature_failed', 'Não foi possível concluir esta ação.');
    logSafe('anamnesis-signature', http.code, http.status);
    return reply(req, { error: http.code, message: http.message }, http.status);
  }
});

import { supabase } from './supabase';

export type AnamnesisSignatureDeliveryMode = 'in_person' | 'remote' | 'legacy';
export type AnamnesisSignatureVerificationMethod = 'birth_date' | 'phone_last4';

export interface AnamnesisSignatureLinkRow {
  id: string;
  user_id: string;
  patient_id: string;
  anamnesis_version_id: string;
  delivery_mode: AnamnesisSignatureDeliveryMode;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  created_at: string;
}
export interface AnamnesisSignatureRow {
  id: string;
  anamnesis_version_id: string;
  signed_at: string;
}
export interface PublicAnamnesisSignaturePayload {
  status: 'verification_required' | 'pending' | 'signed';
  delivery_mode?: AnamnesisSignatureDeliveryMode;
  verification_method?: AnamnesisSignatureVerificationMethod;
  patient_name?: string;
  version_number?: number;
  completed_at?: string;
  form_schema_version?: number;
  answers_snapshot?: Record<string, unknown>;
  form_schema_snapshot?: Record<string, unknown>;
  content_sha256?: string;
  expires_at?: string;
  signed_at?: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('anamnesis-signature', { body });
  if (error) throw error;
  const payload = data as T & { error?: string; message?: string };
  if (payload?.error) throw new Error(payload.message ?? payload.error);
  return payload;
}

export function buildAnamnesisSignatureUrl(token: string) {
  const configuredOrigin = String(import.meta.env.VITE_ANAMNESIS_SIGNATURE_ORIGIN ?? '').trim().replace(/\/$/, '');
  const origin = configuredOrigin || window.location.origin;
  return `${origin}/assinar/anamnese/${encodeURIComponent(token)}`;
}

export async function createAnamnesisSignatureLink(versionId: string, deliveryMode: Exclude<AnamnesisSignatureDeliveryMode, 'legacy'>) {
  return invoke<{ link_id: string; token: string; expires_at: string; version_number: number; delivery_mode: AnamnesisSignatureDeliveryMode }>({
    action: 'create',
    version_id: versionId,
    delivery_mode: deliveryMode,
  });
}
export async function revokeAnamnesisSignatureLink(linkId: string) {
  return invoke<{ revoked: boolean }>({ action: 'revoke', link_id: linkId });
}
export async function viewPublicAnamnesisSignature(token: string, verificationValue?: string) {
  return invoke<PublicAnamnesisSignaturePayload>({ action: 'view', token, verification_value: verificationValue });
}
export async function signPublicAnamnesis(token: string, signatureData: string, verificationValue?: string) {
  return invoke<{ status: 'signed'; signed_at: string }>({
    action: 'sign',
    token,
    signature_data: signatureData,
    verification_value: verificationValue,
  });
}

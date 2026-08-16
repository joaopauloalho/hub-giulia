import { supabase } from './supabase';

export interface AnamnesisSignatureLinkRow {
  id: string;
  user_id: string;
  patient_id: string;
  anamnesis_version_id: string;
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
  status: 'pending' | 'signed';
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

export async function createAnamnesisSignatureLink(versionId: string) {
  return invoke<{ link_id: string; token: string; expires_at: string; version_number: number }>({ action: 'create', version_id: versionId });
}
export async function revokeAnamnesisSignatureLink(linkId: string) {
  return invoke<{ revoked: boolean }>({ action: 'revoke', link_id: linkId });
}
export async function viewPublicAnamnesisSignature(token: string) {
  return invoke<PublicAnamnesisSignaturePayload>({ action: 'view', token });
}
export async function signPublicAnamnesis(token: string, signatureData: string) {
  return invoke<{ status: 'signed'; signed_at: string }>({ action: 'sign', token, signature_data: signatureData });
}

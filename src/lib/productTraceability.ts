import type { TraceabilityMode } from '../types/traceability';

export const PRODUCT_EVIDENCE_BUCKET = 'product-evidence';

export function productEvidenceStoragePaths(
  userId: string,
  patientId: string,
  uploadId: string,
  mimeType: 'image/jpeg' | 'image/png',
) {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const root = `${userId}/patients/${patientId}/product-evidence/${uploadId}`;
  return {
    original: `${root}/original.${ext}`,
    preview: `${root}/preview.${ext}`,
    thumbnail: `${root}/thumb.${ext}`,
  };
}

export function isExpiredTraceabilityDate(expiresOn: string | null | undefined, now = new Date()) {
  if (!expiresOn) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiry = new Date(`${expiresOn}T00:00:00`);
  return Number.isFinite(expiry.getTime()) && expiry < today;
}

export function traceabilityModeLabel(mode: TraceabilityMode) {
  if (mode === 'recommended') return 'Recomendada';
  if (mode === 'optional') return 'Opcional';
  return 'Não utilizar';
}

export function formatTraceabilityExpiry(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

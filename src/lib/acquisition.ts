export const ACQUISITION_SOURCE_KEYS = [
  'instagram',
  'referral',
  'google',
  'partnership',
  'existing_patient',
  'campaign',
  'other',
] as const;

export type AcquisitionSource = typeof ACQUISITION_SOURCE_KEYS[number];

export const ACQUISITION_SOURCE_LABEL: Record<AcquisitionSource, string> = {
  instagram: 'Instagram',
  referral: 'Indicação',
  google: 'Google',
  partnership: 'Parceria',
  existing_patient: 'Já conhecia / paciente antiga',
  campaign: 'Campanha',
  other: 'Outro',
};

export const ACQUISITION_DETAIL_SOURCES: AcquisitionSource[] = ['partnership', 'campaign', 'other'];

export type AcquisitionDraft = {
  source: AcquisitionSource | null;
  sourceDetail: string | null;
  referredByPatientId: string | null;
  referrerName: string | null;
};

export const emptyAcquisitionDraft = (): AcquisitionDraft => ({
  source: null,
  sourceDetail: null,
  referredByPatientId: null,
  referrerName: null,
});

const clean = (value: string | null | undefined) => value?.trim() || null;

export const isAcquisitionSource = (value: string): value is AcquisitionSource =>
  (ACQUISITION_SOURCE_KEYS as readonly string[]).includes(value);

export function normalizeAcquisitionDraft(input: AcquisitionDraft): AcquisitionDraft {
  const source = input.source ?? null;
  let sourceDetail = clean(input.sourceDetail);
  let referredByPatientId = clean(input.referredByPatientId);
  let referrerName = clean(input.referrerName);

  if (!source) return emptyAcquisitionDraft();

  if (!ACQUISITION_DETAIL_SOURCES.includes(source)) sourceDetail = null;

  if (source !== 'referral') {
    referredByPatientId = null;
    referrerName = null;
  } else {
    sourceDetail = null;
    if (referredByPatientId) referrerName = null;
  }

  return { source, sourceDetail, referredByPatientId, referrerName };
}

export function formatAcquisitionLabel(
  source: AcquisitionSource | string | null | undefined,
  sourceDetail?: string | null,
  referrerName?: string | null,
): string {
  if (!source || !isAcquisitionSource(source)) return 'Não informada';
  const base = ACQUISITION_SOURCE_LABEL[source];
  if (source === 'referral' && clean(referrerName)) return `${base} — ${clean(referrerName)}`;
  if (ACQUISITION_DETAIL_SOURCES.includes(source) && clean(sourceDetail)) return `${base} — ${clean(sourceDetail)}`;
  return base;
}

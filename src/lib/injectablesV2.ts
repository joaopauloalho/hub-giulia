import type { InjectablePoint } from '../types';

export type InjectableSide = 'left' | 'right' | 'center' | 'none';
export type InjectableSaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface InjectableProductV2 {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  brand: string | null;
  substance: string | null;
  default_unit: string;
  presentation: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InjectableLotV2 {
  id: string;
  user_id: string;
  product_id: string;
  lot_number: string;
  expires_on: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InjectablePointV2 {
  id: string;
  x: number;
  y: number;
  quantity: string;
  region: string;
  side: InjectableSide | '';
  note: string;
}

export interface InjectableApplicationDraftV2 {
  id: string;
  service_id: string;
  product_id: string;
  lot_id: string | null;
  color: string;
  dilution_note: string;
  points: InjectablePointV2[];
}

export interface InjectableDraftMapV2 {
  id: string;
  patient_id: string;
  user_id: string;
  procedure_id: string | null;
  status: 'draft' | 'finalized' | 'voided';
  source_type: 'legacy' | 'v2';
  record_schema_version: number;
  map_type: string;
  map_schema_version: number;
  background_version: string;
  revision: number;
  points: InjectablePoint[];
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
}

export interface InjectableApplicationHistoryV2 {
  id: string;
  map_id: string;
  service_id: string;
  procedure_item_id: string | null;
  product_id: string;
  lot_id: string | null;
  service_name_snapshot: string;
  product_name_snapshot: string;
  product_category_snapshot: string | null;
  product_brand_snapshot: string | null;
  product_substance_snapshot: string | null;
  product_presentation_snapshot: string | null;
  unit_snapshot: string;
  lot_number_snapshot: string | null;
  expires_on_snapshot: string | null;
  color_snapshot: string;
  dilution_note: string | null;
  total_quantity_snapshot: string | number | null;
  created_at: string;
}

const DECIMAL_SCALE = 4;
const DECIMAL_FACTOR = 10n ** BigInt(DECIMAL_SCALE);

export function normalizeQuantityInput(value: string): string {
  const normalized = value.replace(',', '.').trim();
  if (normalized === '') return '';
  if (!/^\d*(?:\.\d*)?$/.test(normalized)) return '';

  const [whole = '0', fraction = ''] = normalized.split('.');
  const safeWhole = whole === '' ? '0' : whole.replace(/^0+(?=\d)/, '');
  return fraction.length > 0
    ? `${safeWhole}.${fraction.slice(0, DECIMAL_SCALE)}`
    : safeWhole;
}

function decimalToScaled(value: string | number): bigint {
  const raw = typeof value === 'number' ? String(value) : value;
  const normalized = normalizeQuantityInput(raw);
  if (!normalized || normalized === '.') return 0n;

  const [whole = '0', fraction = ''] = normalized.split('.');
  const padded = (fraction + '0'.repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE);
  return BigInt(whole || '0') * DECIMAL_FACTOR + BigInt(padded || '0');
}

function scaledToDecimal(value: bigint): string {
  const whole = value / DECIMAL_FACTOR;
  const fraction = (value % DECIMAL_FACTOR).toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function sumDecimalQuantities(values: Array<string | number>): string {
  return scaledToDecimal(values.reduce((sum, value) => sum + decimalToScaled(value), 0n));
}

export function isPositiveQuantity(value: string): boolean {
  try {
    return decimalToScaled(value) > 0n;
  } catch {
    return false;
  }
}

export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  try {
    return scaledToDecimal(decimalToScaled(value));
  } catch {
    return String(value);
  }
}

export function clampNormalized(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function isExpiredDate(expiresOn: string | null, today = new Date()): boolean {
  if (!expiresOn) return false;
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return expiresOn < localToday;
}

export function unitLabel(unit: string | null | undefined): string {
  const trimmed = unit?.trim();
  return trimmed || 'Unidade não registrada';
}

export interface LegacyInjectableSummary {
  key: string;
  name: string;
  total: string;
  unit: string | null;
  pointCount: number;
}

export function summarizeLegacyInjectablePoints(points: InjectablePoint[]): LegacyInjectableSummary[] {
  const groups = new Map<string, { name: string; values: Array<string | number>; unit: string | null; pointCount: number }>();

  for (const point of points) {
    const unit = point.unit?.trim() || null;
    const key = `${point.service_id}::${unit ?? '<missing>'}`;
    const current = groups.get(key) ?? {
      name: point.service_name || 'Aplicação',
      values: [],
      unit,
      pointCount: 0,
    };
    current.values.push(point.quantity);
    current.pointCount += 1;
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    name: group.name,
    total: sumDecimalQuantities(group.values),
    unit: group.unit,
    pointCount: group.pointCount,
  }));
}

export function applicationTotal(application: InjectableApplicationDraftV2): string {
  return sumDecimalQuantities(application.points.map(point => point.quantity));
}

export function toLegacyInjectablePoints(
  applications: InjectableApplicationDraftV2[],
  serviceNames: Map<string, string>,
  productUnits: Map<string, string>,
): InjectablePoint[] {
  return applications.flatMap(application => {
    const unit = productUnits.get(application.product_id) ?? '';
    const serviceName = serviceNames.get(application.service_id) ?? 'Aplicação injetável';
    return application.points
      .filter(point => isPositiveQuantity(point.quantity))
      .map(point => ({
        id: point.id,
        x: clampNormalized(point.x),
        y: clampNormalized(point.y),
        service_id: application.service_id,
        service_name: serviceName,
        color: application.color,
        quantity: Number(formatQuantity(point.quantity)),
        unit,
      }));
  });
}

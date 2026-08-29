import type { PatientEntitlement } from '../types/packages';

export type TreatmentPlanGroup = {
  packageId: string;
  title: string;
  items: PatientEntitlement[];
  totalSessions: number;
  completedSessions: number;
  remainingSessions: number;
};

export function effectiveTreatmentTotal(item: PatientEntitlement) {
  return Math.max(0, Number(item.quantity_granted || 0) + Number(item.adjusted || 0));
}

export function completedTreatmentSessions(item: PatientEntitlement) {
  return Math.max(0, Number(item.redeemed || 0) - Number(item.reversed || 0));
}

export function remainingTreatmentSessions(item: PatientEntitlement) {
  return Math.max(0, Number(item.available_balance || 0));
}

export function nextTreatmentSession(item: PatientEntitlement) {
  const total = effectiveTreatmentTotal(item);
  const completed = completedTreatmentSessions(item);
  if (total <= 0 || remainingTreatmentSessions(item) <= 0) return null;
  return Math.min(total, completed + 1);
}

export function formatTreatmentQuantity(value: number) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function treatmentSessionLabel(item: PatientEntitlement) {
  const next = nextTreatmentSession(item);
  const total = effectiveTreatmentTotal(item);
  if (next == null) return 'Sem sessões disponíveis';
  if (Number.isInteger(next) && Number.isInteger(total)) return `Sessão ${next} de ${total}`;
  return `${formatTreatmentQuantity(next)} de ${formatTreatmentQuantity(total)} ${item.unit_label_snapshot}`;
}

export function treatmentProgressLabel(item: PatientEntitlement) {
  const completed = completedTreatmentSessions(item);
  const total = effectiveTreatmentTotal(item);
  if (Number.isInteger(completed) && Number.isInteger(total)) return `${completed} de ${total} realizadas`;
  return `${formatTreatmentQuantity(completed)} de ${formatTreatmentQuantity(total)} utilizados`;
}

export function groupActiveTreatmentPlans(entitlements: PatientEntitlement[]): TreatmentPlanGroup[] {
  const active = entitlements.filter(item => item.effective_status === 'active' && remainingTreatmentSessions(item) > 0);
  const grouped = new Map<string, PatientEntitlement[]>();
  for (const item of active) grouped.set(item.package_id, [...(grouped.get(item.package_id) ?? []), item]);

  return [...grouped.entries()]
    .map(([packageId, items]) => {
      const totalSessions = items.reduce((sum, item) => sum + effectiveTreatmentTotal(item), 0);
      const completedSessions = items.reduce((sum, item) => sum + completedTreatmentSessions(item), 0);
      const remainingSessions = items.reduce((sum, item) => sum + remainingTreatmentSessions(item), 0);
      return {
        packageId,
        title: items[0]?.package_title ?? 'Tratamento',
        items,
        totalSessions,
        completedSessions,
        remainingSessions,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

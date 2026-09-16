import type { PatientEntitlement } from '../types/packages';

export type TreatmentPlanGroup = {
  packageId: string;
  title: string;
  items: PatientEntitlement[];
  totalSessions: number;
  completedSessions: number;
  remainingSessions: number;
  additionalSessions: number;
};

export function effectiveTreatmentTotal(item: PatientEntitlement) {
  const contractedAdjustment = Number(item.contracted_adjusted ?? item.adjusted ?? 0);
  return Math.max(0, Number(item.quantity_granted || 0) + contractedAdjustment);
}

export const contractedTreatmentTotal = effectiveTreatmentTotal;

export function completedTreatmentSessions(item: PatientEntitlement) {
  return Math.max(0, Number(item.redeemed || 0) - Number(item.reversed || 0));
}

/** Sessões contratadas ainda não realizadas. Não inclui extensão clínica gratuita. */
export function remainingTreatmentSessions(item: PatientEntitlement) {
  return Math.max(0, effectiveTreatmentTotal(item) - completedTreatmentSessions(item));
}

/** Quantidade que pode ser selecionada agora no atendimento. A API expõe 1 para protocolos extensíveis esgotados. */
export function selectableTreatmentSessions(item: PatientEntitlement) {
  if (item.effective_status !== 'active') return 0;
  return Math.max(0, Number(item.available_balance || 0));
}

export function additionalTreatmentSessions(item: PatientEntitlement) {
  return Math.max(0, completedTreatmentSessions(item) - effectiveTreatmentTotal(item));
}

export function isClinicalExtensionSession(item: PatientEntitlement) {
  return completedTreatmentSessions(item) >= effectiveTreatmentTotal(item)
    && Boolean(item.allow_clinical_extensions)
    && !item.clinically_finalized_at
    && item.effective_status === 'active';
}

export function nextTreatmentSession(item: PatientEntitlement) {
  const total = effectiveTreatmentTotal(item);
  const completed = completedTreatmentSessions(item);
  if (total <= 0 || selectableTreatmentSessions(item) <= 0) return null;
  return completed + 1;
}

export function formatTreatmentQuantity(value: number) {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

export function treatmentSessionLabel(item: PatientEntitlement) {
  const next = nextTreatmentSession(item);
  const total = effectiveTreatmentTotal(item);
  if (next == null) return 'Sem sessões disponíveis';
  if (Number.isInteger(next) && Number.isInteger(total)) {
    return next <= total ? `Sessão ${next} de ${total}` : `Sessão ${next} · ${total} contratadas`;
  }
  return next <= total
    ? `${formatTreatmentQuantity(next)} de ${formatTreatmentQuantity(total)} ${item.unit_label_snapshot}`
    : `${formatTreatmentQuantity(next)} ${item.unit_label_snapshot} · ${formatTreatmentQuantity(total)} contratadas`;
}

export function treatmentProgressLabel(item: PatientEntitlement) {
  const completed = completedTreatmentSessions(item);
  const total = effectiveTreatmentTotal(item);
  if (Number.isInteger(completed) && Number.isInteger(total)) {
    return completed <= total
      ? `${completed} de ${total} realizadas`
      : `${completed} sessões realizadas · ${total} contratadas`;
  }
  return completed <= total
    ? `${formatTreatmentQuantity(completed)} de ${formatTreatmentQuantity(total)} utilizados`
    : `${formatTreatmentQuantity(completed)} utilizados · ${formatTreatmentQuantity(total)} contratados`;
}

export function treatmentAdditionalLabel(item: PatientEntitlement) {
  const additional = additionalTreatmentSessions(item);
  if (additional <= 0) return null;
  return `+${formatTreatmentQuantity(additional)} ${additional === 1 ? 'sessão adicional' : 'sessões adicionais'} sem cobrança`;
}

export function groupActiveTreatmentPlans(entitlements: PatientEntitlement[]): TreatmentPlanGroup[] {
  const active = entitlements.filter(item => item.effective_status === 'active' && selectableTreatmentSessions(item) > 0);
  const grouped = new Map<string, PatientEntitlement[]>();
  for (const item of active) grouped.set(item.package_id, [...(grouped.get(item.package_id) ?? []), item]);

  return [...grouped.entries()]
    .map(([packageId, items]) => {
      const totalSessions = items.reduce((sum, item) => sum + effectiveTreatmentTotal(item), 0);
      const completedSessions = items.reduce((sum, item) => sum + completedTreatmentSessions(item), 0);
      const remainingSessions = Math.max(0, totalSessions - completedSessions);
      const additionalSessions = Math.max(0, completedSessions - totalSessions);
      return {
        packageId,
        title: items[0]?.package_title ?? 'Tratamento',
        items,
        totalSessions,
        completedSessions,
        remainingSessions,
        additionalSessions,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

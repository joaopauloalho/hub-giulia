export type ReferralStatus = 'indicada' | 'agendou' | 'cliente';
export type RewardStatus = 'pending' | 'given';

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  indicada: 'Indicada',
  agendou: 'Veio / agendou',
  cliente: 'Cliente',
};

export const REWARD_STATUS_LABEL: Record<RewardStatus, string> = {
  pending: 'Brinde pendente',
  given: 'Brinde dado',
};

export function referralStatus(input: { referredPatientId: string | null; hasPaid: boolean; hasAppointment: boolean }): ReferralStatus {
  if (input.referredPatientId && input.hasPaid) return 'cliente';
  if (input.referredPatientId && input.hasAppointment) return 'agendou';
  return 'indicada';
}

export type ReferrerRank = { key: string; name: string; count: number; clients: number };

export function rankReferrers(rows: Array<{ referrerKey: string; referrerLabel: string; status: ReferralStatus }>): ReferrerRank[] {
  const map = new Map<string, ReferrerRank>();
  for (const row of rows) {
    const current = map.get(row.referrerKey) ?? { key: row.referrerKey, name: row.referrerLabel, count: 0, clients: 0 };
    current.count += 1;
    if (row.status === 'cliente') current.clients += 1;
    map.set(row.referrerKey, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.clients - a.clients || a.name.localeCompare(b.name, 'pt-BR'));
}

import type { Procedure, Service } from '../types';

export interface ProcedureFinancials {
  venda: number;
  pago: number;
  taxas: number;
  liquido: number;
  pendente: number;
  custo: number;
  lucro: number;
}

export interface FinanceiroSummary {
  vendas: number;
  pago: number;
  taxas: number;
  liquido: number;
  pendente: number;
  custos: number;
  lucro: number;
}

type ProcedureWithRollups = Procedure & Partial<{
  paid_amount: number;
  paid_fee_value: number;
  paid_net_value: number;
  pending_amount: number;
  item_names_snapshot: string[];
}>;

function money(value: number | null | undefined) {
  return Number(value ?? 0);
}

export function getProcedureFinancials(proc: Procedure): ProcedureFinancials {
  const payments = proc.payments;
  const rollup = proc as ProcedureWithRollups;

  let pago: number;
  let taxas: number;
  let liquido: number;
  let pendente: number;

  if (payments) {
    const paid = payments.filter(payment => Boolean(payment.paid_at));
    const pending = payments.filter(payment => !payment.paid_at);
    pago = paid.reduce((sum, payment) => sum + money(payment.amount), 0);
    taxas = paid.reduce((sum, payment) => sum + money(payment.fee_value), 0);
    liquido = paid.reduce((sum, payment) => sum + money(payment.net_amount), 0);
    pendente = pending.reduce((sum, payment) => sum + money(payment.amount), 0);
  } else {
    pago = money(rollup.paid_amount);
    taxas = money(rollup.paid_fee_value);
    liquido = money(rollup.paid_net_value);
    pendente = money(rollup.pending_amount);
  }

  const custo = money(proc.total_cost);

  return {
    venda: money(proc.total_value),
    pago,
    taxas,
    liquido,
    pendente,
    custo,
    lucro: liquido - custo,
  };
}

export function summarizeFinance(procedures: Procedure[]): FinanceiroSummary {
  return procedures.reduce<FinanceiroSummary>((summary, proc) => {
    const values = getProcedureFinancials(proc);
    summary.vendas += values.venda;
    summary.pago += values.pago;
    summary.taxas += values.taxas;
    summary.liquido += values.liquido;
    summary.pendente += values.pendente;
    summary.custos += values.custo;
    summary.lucro += values.lucro;
    return summary;
  }, {
    vendas: 0,
    pago: 0,
    taxas: 0,
    liquido: 0,
    pendente: 0,
    custos: 0,
    lucro: 0,
  });
}

export function procedureServiceNames(proc: Procedure, services: Service[] = []) {
  const snapshots = proc.items?.map(item => item.name.trim()).filter(Boolean) ?? [];
  if (snapshots.length > 0) return snapshots.join(', ');

  const rollupNames = (proc as ProcedureWithRollups).item_names_snapshot ?? [];
  if (rollupNames.length > 0) return rollupNames.join(', ');

  const legacyNames = proc.services_ids
    .map(id => services.find(service => service.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return legacyNames.length > 0 ? legacyNames.join(', ') : 'Serviços registrados';
}

export function procedurePaymentLabel(proc: Procedure, labels: Record<string, string>) {
  const payments = proc.payments ?? [];
  if (payments.length > 1 || proc.payment_method === 'split') return 'Pagamento dividido';
  const method = payments[0]?.method ?? proc.payment_method;
  return labels[method] ?? method;
}

import { CreditCard, Loader2 } from 'lucide-react';
import { usePatient360Overview } from '../../../hooks/usePatient360';
import { formatPatientMoney } from '../../../lib/patient360';

export function FinanceiroPacienteTab({ patientId }: { patientId: string }) {
  const { overview, loading, error } = usePatient360Overview(patientId);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" /></div>;
  if (error || !overview) return <div className="empty-state"><p>{error ?? 'Não foi possível carregar o financeiro.'}</p></div>;

  const finance = overview.financialSummary;
  return <div style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Total vendido</div><strong>{formatPatientMoney(finance.total)}</strong></div>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Recebido</div><strong>{formatPatientMoney(finance.received)}</strong></div>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">A receber</div><strong>{formatPatientMoney(finance.pending)}</strong></div>
    </div>
    <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
      <CreditCard size={18} />
      <div>
        <strong style={{ display: 'block', fontSize: 13 }}>Financeiro da paciente</strong>
        <span className="page-sub">Aqui ficam somente valores efetivamente vendidos, recebidos e pendentes. Propostas e orçamentos ficam na aba Propostas.</span>
      </div>
    </div>
    {finance.lastPaymentAt && <div className="page-sub">Último pagamento recebido em {new Date(finance.lastPaymentAt).toLocaleString('pt-BR')}.</div>}
  </div>;
}

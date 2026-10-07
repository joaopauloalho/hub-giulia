import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { ReceivablePaymentModal } from '../../../components/ReceivablePaymentModal';
import { usePatient360Overview } from '../../../hooks/usePatient360';
import { useReceivables, type OpenReceivable } from '../../../hooks/useReceivables';
import { formatPatientMoney } from '../../../lib/patient360';

export function FinanceiroPacienteTab({ patientId }: { patientId: string }) {
  const { overview, loading, error } = usePatient360Overview(patientId);
  const receivables = useReceivables(patientId);
  const [selected, setSelected] = useState<OpenReceivable | null>(null);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" /></div>;
  if (error || !overview) return <div className="empty-state"><p>{error ?? 'Não foi possível carregar o financeiro.'}</p></div>;

  const finance = overview.financialSummary;
  return <div style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Total vendido</div><strong>{formatPatientMoney(finance.total)}</strong></div>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Recebido</div><strong>{formatPatientMoney(finance.received)}</strong></div>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">A receber</div><strong style={{ color: finance.pending > .009 ? '#92400e' : undefined }}>{formatPatientMoney(finance.pending)}</strong></div>
    </div>

    <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
      <CreditCard size={18} />
      <div>
        <strong style={{ display: 'block', fontSize: 13 }}>Financeiro da paciente</strong>
        <span className="page-sub">Aqui ficam somente valores efetivamente vendidos, recebidos e pendentes. Propostas e orçamentos ficam na aba Propostas.</span>
      </div>
    </div>

    {finance.lastPaymentAt && <div className="page-sub">Último pagamento recebido em {new Date(finance.lastPaymentAt).toLocaleString('pt-BR')}.</div>}

    <section style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div>
          <strong style={{ display: 'block' }}>Valores em aberto</strong>
          <span className="page-sub">Você pode dar baixa aos poucos, quantas vezes precisar.</span>
        </div>
      </div>

      {receivables.loading ? <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}><Loader2 size={20} className="spin"/></div> : receivables.error ? <div className="empty-state"><p>{receivables.error}</p></div> : receivables.items.length === 0 ? (
        <div className="card" style={{ padding: 14 }}><span className="page-sub">Nenhum saldo em aberto para esta paciente.</span></div>
      ) : <div style={{ display: 'grid', gap: 8 }}>
        {receivables.items.map(item => <div key={item.procedure_id} className="card" style={{ padding: 14, display: 'grid', gap: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{item.service_names}</strong>
              <span className="page-sub">{new Date(item.performed_at).toLocaleDateString('pt-BR')} · {item.next_due_date ? `previsão ${new Date(`${item.next_due_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'sem data definida'}</span>
            </div>
            <strong style={{ color: '#92400e', whiteSpace: 'nowrap' }}>{formatPatientMoney(item.pending_amount)}</strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
            <div><small className="page-sub">Valor</small><strong style={{ display: 'block', fontSize: 13 }}>{formatPatientMoney(item.total_value)}</strong></div>
            <div><small className="page-sub">Já recebeu</small><strong style={{ display: 'block', fontSize: 13, color: '#166534' }}>{formatPatientMoney(item.received_amount)}</strong></div>
            <div><small className="page-sub">Falta</small><strong style={{ display: 'block', fontSize: 13, color: '#92400e' }}>{formatPatientMoney(item.pending_amount)}</strong></div>
          </div>
          <button type="button" className="btn btn--primary btn--sm" style={{ justifyContent: 'center' }} onClick={() => setSelected(item)}>+ Registrar recebimento</button>
        </div>)}
      </div>}
    </section>

    {selected && <ReceivablePaymentModal
      receivable={selected}
      onClose={() => setSelected(null)}
      onSubmit={receivables.registerReceipt}
    />}
  </div>;
}

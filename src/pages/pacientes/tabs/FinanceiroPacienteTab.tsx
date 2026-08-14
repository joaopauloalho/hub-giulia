import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, FileText, Loader2 } from 'lucide-react';
import { usePatient360Overview } from '../../../hooks/usePatient360';
import { loadPatientProposals } from '../../../hooks/useProposals';
import { formatPatientMoney } from '../../../lib/patient360';
import { PROPOSAL_STATUS_LABEL, proposalDate, proposalMoney, type ProposalSummary } from '../../../lib/proposals';

export function FinanceiroPacienteTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { overview, loading, error } = usePatient360Overview(patientId);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);
  const [proposalsError, setProposalsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProposalsLoading(true);
    setProposalsError(null);
    void loadPatientProposals(patientId)
      .then(rows => { if (active) setProposals(rows); })
      .catch(err => { if (active) { console.error('[patient360:proposals]', err); setProposals([]); setProposalsError('Não foi possível carregar os planos e orçamentos.'); } })
      .finally(() => { if (active) setProposalsLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" /></div>;
  if (error || !overview) return <div className="empty-state"><p>{error ?? 'Não foi possível carregar o financeiro.'}</p></div>;

  const finance = overview.financialSummary;
  return <div style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Total em procedimentos</div><strong>{formatPatientMoney(finance.total)}</strong></div>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Recebido</div><strong>{formatPatientMoney(finance.received)}</strong></div>
      <div className="card" style={{ padding: 14 }}><div className="page-sub">Pendente</div><strong>{formatPatientMoney(finance.pending)}</strong></div>
    </div>
    <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}><CreditCard size={18} /><div><strong style={{ display: 'block', fontSize: 13 }}>Mesma fonte de verdade do Financeiro</strong><span className="page-sub">Taxas da maquininha não são tratadas como dívida da paciente. Os pagamentos detalhados ficam dentro de cada atendimento no Histórico.</span></div></div>
    {finance.lastPaymentAt && <div className="page-sub">Último pagamento recebido em {new Date(finance.lastPaymentAt).toLocaleString('pt-BR')}.</div>}

    <section className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><FileText size={17} /><div style={{ flex: 1 }}><strong style={{ display: 'block', fontSize: 13 }}>Planos & Orçamentos</strong><span className="page-sub">Histórico comercial vinculado às oportunidades desta paciente.</span></div></div>
      {proposalsLoading ? <div className="page-sub">Carregando propostas…</div> : proposalsError ? <div className="page-sub" style={{ color: 'var(--red)' }}>{proposalsError}</div> : proposals.length === 0 ? <div className="page-sub">Nenhuma proposta comercial vinculada.</div> : <div style={{ display: 'grid', gap: 7 }}>
        {proposals.map(proposal => <button
          type="button"
          key={proposal.proposal_id}
          onClick={() => navigate(`/crm/deals/${proposal.deal_id}/proposals/${proposal.proposal_id}`)}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, textAlign: 'left', alignItems: 'center', padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', cursor: 'pointer', color: 'inherit' }}
        >
          <span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{proposal.title}</strong><small className="page-sub">Versão {proposal.version_number} · {PROPOSAL_STATUS_LABEL[proposal.effective_status]}{proposal.valid_until ? ` · validade ${proposalDate(proposal.valid_until)}` : ''}</small></span>
          <strong style={{ fontSize: 12 }}>{proposalMoney(proposal.total_value)}</strong>
        </button>)}
      </div>}
    </section>
  </div>;
}

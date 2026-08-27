import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, FileText, Loader2, Plus } from 'lucide-react';
import { usePatient360Overview } from '../../../hooks/usePatient360';
import { createProposal, loadPatientProposals } from '../../../hooks/useProposals';
import type { CrmPipelineCard } from '../../../hooks/useCrm';
import { formatPatientMoney } from '../../../lib/patient360';
import { CRM_STAGE_LABEL, formatCrmValue } from '../../../lib/crm';
import { PROPOSAL_STATUS_LABEL, proposalDate, proposalMoney, type ProposalSummary } from '../../../lib/proposals';
import { supabase } from '../../../lib/supabase';

type CommercialHistoryGroup = {
  deal: CrmPipelineCard | null;
  proposals: ProposalSummary[];
};

function proposalStatusLabel(proposal: ProposalSummary) {
  if (proposal.effective_status === 'issued' && proposal.sent_at) return 'Enviada';
  return PROPOSAL_STATUS_LABEL[proposal.effective_status];
}

function proposalStatusDetail(proposal: ProposalSummary) {
  if (proposal.accepted_at) return ` · aceita ${new Date(proposal.accepted_at).toLocaleDateString('pt-BR')}`;
  if (proposal.declined_at) return ` · recusada ${new Date(proposal.declined_at).toLocaleDateString('pt-BR')}`;
  if (proposal.sent_at) return ` · enviada ${new Date(proposal.sent_at).toLocaleDateString('pt-BR')}`;
  if (proposal.issued_at) return ` · emitida ${new Date(proposal.issued_at).toLocaleDateString('pt-BR')}`;
  if (proposal.valid_until) return ` · validade ${proposalDate(proposal.valid_until)}`;
  return '';
}

export function FinanceiroPacienteTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { overview, loading, error } = usePatient360Overview(patientId);
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [opportunities, setOpportunities] = useState<CrmPipelineCard[]>([]);
  const [commercialLoading, setCommercialLoading] = useState(true);
  const [commercialError, setCommercialError] = useState<string | null>(null);
  const [creatingDealId, setCreatingDealId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCommercialLoading(true);
    setCommercialError(null);

    void Promise.all([
      loadPatientProposals(patientId),
      supabase
        .from('crm_pipeline_v')
        .select('*')
        .eq('patient_id', patientId)
        .order('deal_created_at', { ascending: false })
        .limit(100),
    ])
      .then(([proposalRows, opportunityResult]) => {
        if (!active) return;
        if (opportunityResult.error) throw opportunityResult.error;
        setProposals(proposalRows);
        setOpportunities((opportunityResult.data ?? []) as CrmPipelineCard[]);
      })
      .catch(err => {
        if (!active) return;
        console.error('[patient360:commercial-history]', err);
        setProposals([]);
        setOpportunities([]);
        setCommercialError('Não foi possível carregar o histórico comercial.');
      })
      .finally(() => {
        if (active) setCommercialLoading(false);
      });

    return () => { active = false; };
  }, [patientId]);

  const commercialHistory = useMemo<CommercialHistoryGroup[]>(() => {
    const proposalsByDeal = new Map<string, ProposalSummary[]>();
    for (const proposal of proposals) {
      const current = proposalsByDeal.get(proposal.deal_id) ?? [];
      current.push(proposal);
      proposalsByDeal.set(proposal.deal_id, current);
    }

    const groups: CommercialHistoryGroup[] = opportunities.map(deal => ({
      deal,
      proposals: proposalsByDeal.get(deal.deal_id) ?? [],
    }));

    const knownDealIds = new Set(opportunities.map(deal => deal.deal_id));
    for (const [dealId, dealProposals] of proposalsByDeal) {
      if (!knownDealIds.has(dealId)) groups.push({ deal: null, proposals: dealProposals });
    }

    return groups;
  }, [opportunities, proposals]);

  const createBudget = async (deal: CrmPipelineCard) => {
    setCreatingDealId(deal.deal_id);
    try {
      const created = await createProposal(deal.deal_id, deal.title);
      navigate(`/crm/deals/${deal.deal_id}/proposals/${created.proposal_id}`);
    } catch (err) {
      console.error('[patient360:create-proposal]', err);
      setCommercialError('Não foi possível criar o orçamento agora.');
    } finally {
      setCreatingDealId(null);
    }
  };

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><FileText size={17} /><div style={{ flex: 1 }}><strong style={{ display: 'block', fontSize: 13 }}>Histórico comercial</strong><span className="page-sub">Oportunidades e orçamentos desta paciente, do primeiro contato ao fechamento.</span></div></div>
      {commercialLoading ? <div className="page-sub">Carregando histórico comercial…</div> : commercialError && commercialHistory.length === 0 ? <div className="page-sub" style={{ color: 'var(--red)' }}>{commercialError}</div> : commercialHistory.length === 0 ? <div className="page-sub">Nenhuma oportunidade ou orçamento vinculado.</div> : <div style={{ display: 'grid', gap: 9 }}>
        {commercialError && <div className="page-sub" style={{ color: 'var(--red)' }}>{commercialError}</div>}
        {commercialHistory.map((group, groupIndex) => {
          const deal = group.deal;
          const fallbackProposal = group.proposals[0];
          const title = deal?.title ?? fallbackProposal?.title ?? 'Oportunidade comercial';
          const opportunityValue = deal ? formatCrmValue(deal.estimated_value) : null;

          return <div key={deal?.deal_id ?? fallbackProposal?.deal_id ?? groupIndex} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'start' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
                <small className="page-sub">
                  {deal ? `Oportunidade · ${CRM_STAGE_LABEL[deal.stage]} · criada ${new Date(deal.deal_created_at).toLocaleDateString('pt-BR')}` : 'Oportunidade vinculada a orçamento existente'}
                </small>
              </div>
              {opportunityValue && <strong style={{ fontSize: 12 }}>{opportunityValue}</strong>}
            </div>

            {group.proposals.length === 0 ? <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="page-sub" style={{ flex: 1, minWidth: 180 }}>Orçamento ainda não criado.</span>
              {deal && <button type="button" className="btn btn--primary btn--sm" disabled={creatingDealId === deal.deal_id} onClick={() => void createBudget(deal)}><Plus size={13} /> {creatingDealId === deal.deal_id ? 'Criando…' : 'Criar orçamento'}</button>}
            </div> : <div style={{ display: 'grid', gap: 7, marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
              {group.proposals.map(proposal => <button
                type="button"
                key={proposal.proposal_id}
                onClick={() => navigate(`/crm/deals/${proposal.deal_id}/proposals/${proposal.proposal_id}`)}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, textAlign: 'left', alignItems: 'center', padding: 9, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-0)', cursor: 'pointer', color: 'inherit' }}
              >
                <span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{proposal.title}</strong><small className="page-sub">Orçamento · versão {proposal.version_number} · {proposalStatusLabel(proposal)}{proposalStatusDetail(proposal)}</small></span>
                <strong style={{ fontSize: 12 }}>{proposalMoney(proposal.total_value)}</strong>
              </button>)}
            </div>}
          </div>;
        })}
      </div>}
    </section>
  </div>;
}

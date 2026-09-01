import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Plus } from 'lucide-react';
import { createProposal, loadPatientProposals } from '../../../hooks/useProposals';
import { CRM_OPEN_STAGES, type CrmStage } from '../../../lib/crm';
import { PROPOSAL_STATUS_LABEL, proposalDate, proposalMoney, type ProposalSummary } from '../../../lib/proposals';
import { supabase } from '../../../lib/supabase';

type DealRow = {
  deal_id: string;
  stage: CrmStage;
  deal_created_at: string;
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

export function PropostasPacienteTab({ patientId, patientName }: { patientId: string; patientName: string }) {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProposals(await loadPatientProposals(patientId));
    } catch (loadError) {
      console.error('[patient360:proposals]', loadError);
      setProposals([]);
      setError('Não foi possível carregar as propostas desta paciente.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void reload(); }, [reload]);

  const ensureOpenDeal = async () => {
    const { data, error: dealError } = await supabase
      .from('crm_pipeline_v')
      .select('deal_id,stage,deal_created_at')
      .eq('patient_id', patientId)
      .is('contact_archived_at', null)
      .order('deal_created_at', { ascending: false })
      .limit(50);
    if (dealError) throw dealError;

    const active = ((data ?? []) as DealRow[]).find(row => CRM_OPEN_STAGES.includes(row.stage));
    if (active) return active.deal_id;

    const { data: created, error: createError } = await supabase.rpc('create_crm_opportunity_for_patient_v1', {
      p_patient_id: patientId,
      p_title: 'Acompanhamento comercial',
      p_value: null,
      p_expected_close: null,
      p_interests: [],
      p_note: 'Acompanhamento criado automaticamente a partir da ficha da paciente para organizar propostas.',
      p_idempotency_key: crypto.randomUUID(),
    });
    if (createError) throw createError;
    const row = Array.isArray(created) ? created[0] : created;
    const dealId = (row as { deal_id?: string } | null)?.deal_id;
    if (!dealId) throw new Error('CRM_DEAL_CREATE_NOT_CONFIRMED');
    return dealId;
  };

  const createNewProposal = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const dealId = await ensureOpenDeal();
      const created = await createProposal(dealId, `Proposta · ${patientName}`);
      navigate(`/crm/deals/${dealId}/proposals/${created.proposal_id}`, {
        state: { from: `/pacientes/${patientId}?tab=proposals` },
      });
    } catch (createError) {
      console.error('[patient360:create-proposal]', createError);
      setError('Não foi possível criar a proposta agora.');
    } finally {
      setCreating(false);
    }
  };

  return <div style={{ display: 'grid', gap: 12 }}>
    <section className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong style={{ display: 'block', fontSize: 14 }}>Propostas da paciente</strong>
          <span className="page-sub">Crie e consulte os orçamentos aqui. O CRM fica apenas com o acompanhamento do funil.</span>
        </div>
        <button type="button" className="btn btn--primary btn--sm" disabled={creating} onClick={() => void createNewProposal()}>
          <Plus size={14} /> {creating ? 'Criando…' : 'Nova proposta'}
        </button>
      </div>
    </section>

    {error && <div className="card" style={{ padding: 12, color: 'var(--red)' }}>{error}</div>}

    {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" /></div> : proposals.length === 0 ? <div className="empty-state">
      <FileText size={42} strokeWidth={1.4} />
      <p>Nenhuma proposta criada para esta paciente.</p>
      <button type="button" className="btn btn--primary btn--md" disabled={creating} onClick={() => void createNewProposal()}><Plus size={15} /> Criar primeira proposta</button>
    </div> : <div style={{ display: 'grid', gap: 9 }}>
      {proposals.map(proposal => <button
        key={proposal.proposal_id}
        type="button"
        className="card"
        onClick={() => navigate(`/crm/deals/${proposal.deal_id}/proposals/${proposal.proposal_id}`, { state: { from: `/pacientes/${patientId}?tab=proposals` } })}
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 12, alignItems: 'center', padding: 14, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
      >
        <span style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proposal.title}</strong>
          <span className="page-sub">Versão {proposal.version_number} · {proposalStatusLabel(proposal)}{proposalStatusDetail(proposal)}</span>
        </span>
        <strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{proposalMoney(proposal.total_value)}</strong>
      </button>)}
    </div>}
  </div>;
}

import { useEffect, useState } from 'react';
import { Download, FileText, PenLine, Settings2, ShieldX } from 'lucide-react';
import { useContracts, voidContract } from '../../../hooks/useContracts';
import type { Contract } from '../../../types';
import { ContractTemplateManager } from '../ContractTemplateManager';
import { useToast } from '../../../hooks/useToast';

interface Props {
  patientId: string;
  onSignNew: (contractId?: string) => void;
}

const STATUS_LABELS: Record<Contract['status'], string> = {
  draft: 'Rascunho',
  ready: 'Aguardando assinatura',
  signed: 'Assinado',
  voided: 'Anulado',
};

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR'); }
  catch { return iso; }
}

function contractName(contract: Contract) {
  return contract.document_name_snapshot ?? contract.template?.name ?? 'Contrato';
}

function contractContext(contract: Contract) {
  const names = contract.services_snapshot?.map(item => item.name).filter(Boolean) ?? [];
  if (names.length > 0) return names.join(' + ');
  if (contract.procedure_id) return 'Vinculado a atendimento';
  if (contract.appointment_id) return 'Vinculado a agendamento';
  return contract.source_type === 'legacy' ? 'Documento legado' : 'Paciente';
}

export function ContratosTab({ patientId, onSignNew }: Props) {
  const { contracts, loading, error, load } = useContracts(patientId);
  const { toast, confirm } = useToast();
  const [showManager, setShowManager] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  const handleVoid = async (contract: Contract) => {
    const reason = window.prompt('Motivo da anulação do documento:')?.trim();
    if (!reason) return;
    const ok = await confirm({
      title: 'Anular documento?',
      message: 'O documento original e o PDF continuarão preservados no histórico. Para corrigir o conteúdo, gere um novo documento e assine novamente.',
      confirmLabel: 'Anular documento',
      cancelLabel: 'Cancelar',
      tone: 'warning',
    });
    if (!ok) return;
    setVoiding(contract.id);
    try {
      await voidContract(contract.id, reason);
      await load();
      toast.success('Documento anulado e preservado no histórico.');
    } catch (err) {
      console.error('[contracts:void]', { contract_id: contract.id, code: err instanceof Error ? err.message : 'unknown' });
      toast.error(err instanceof Error ? err.message : 'Não foi possível anular o documento.');
    } finally { setVoiding(null); }
  };

  return <div style={{ padding: 20, display: 'grid', gap: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn btn--ghost btn--sm" onClick={() => setShowManager(value => !value)}>
        <Settings2 size={14} /> {showManager ? 'Fechar modelos' : 'Modelos e dados profissionais'}
      </button>
      <button className="btn btn--secondary btn--sm" onClick={() => onSignNew()}>
        <PenLine size={14} /> Novo documento
      </button>
    </div>

    {showManager && <ContractTemplateManager onChanged={() => void load()} />}

    {error ? <div className="empty-state" style={{ padding: '32px 0' }}><p>{error}</p></div>
      : loading ? <div className="loading-state">Carregando documentos...</div>
        : contracts.length === 0 ? <div className="empty-state" style={{ padding: '32px 0' }}>
          <FileText size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
          <p>Nenhum documento criado ainda.</p>
          <button className="btn btn--primary btn--sm" onClick={() => onSignNew()}><PenLine size={14} /> Criar primeiro documento</button>
        </div> : <div style={{ display: 'grid', gap: 10 }}>
          {contracts.map(contract => {
            const date = contract.signed_at ?? contract.ready_at ?? contract.created_at;
            return <article key={contract.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', background: 'var(--bg-2)', display: 'grid', gap: 9 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <FileText size={20} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, fontSize: '.9rem', color: 'var(--text)' }}>{contractName(contract)}</div>
                  <div className="page-sub" style={{ marginTop: 2 }}>{contractContext(contract)}{date ? ` · ${fmtDate(date)}` : ''}</div>
                </div>
                <div className="contract-status-row">
                  <span className={`contract-status-badge contract-status-badge--${contract.status}`}>{STATUS_LABELS[contract.status]}</span>
                  {contract.source_type === 'legacy' && <span className="contract-status-badge contract-status-badge--legacy">Legado</span>}
                </div>
              </div>

              {contract.status === 'voided' && contract.void_reason && <div className="page-sub">Motivo da anulação: {contract.void_reason}</div>}
              {contract.content_sha256 && <div className="contract-integrity">Conteúdo SHA-256: {contract.content_sha256}</div>}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {contract.status === 'ready' && contract.source_type === 'v2' && <button className="btn btn--primary btn--sm" onClick={() => onSignNew(contract.id)}><PenLine size={14} /> Continuar assinatura</button>}
                {contract.pdf_download_url && <a className="btn btn--secondary btn--sm" href={contract.pdf_download_url} target="_blank" rel="noopener noreferrer"><Download size={14} /> Abrir PDF</a>}
                {contract.status === 'signed' && <button className="btn btn--ghost btn--sm" onClick={() => void handleVoid(contract)} disabled={voiding === contract.id}><ShieldX size={14} /> {voiding === contract.id ? 'Anulando...' : 'Anular'}</button>}
              </div>
            </article>;
          })}
        </div>}
  </div>;
}

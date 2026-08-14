import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarPlus, Check, Clock3, Download, FilePlus2, Plus, RefreshCw, Search, Send, Share2, Trash2, X } from 'lucide-react';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import {
  acceptProposal,
  createProposalRevision,
  declineProposal,
  issueProposal,
  loadProposal,
  loadProposalDealContext,
  loadProposalPdf,
  markProposalSent,
  proposalSignedUrl,
  saveProposalDraft,
  shareProposalFile,
  uploadProposalPdf,
  voidProposal,
  type ProposalDealContext,
  type ProposalDetail,
} from '../../hooks/useProposals';
import {
  PROPOSAL_STATUS_LABEL,
  calculateProposalItem,
  calculateProposalTotals,
  centsToMoney,
  proposalDate,
  proposalEffectiveStatus,
  proposalErrorMessage,
  proposalMoney,
  type ProposalDiscountType,
  type ProposalEditorItem,
  type TreatmentProposalItem,
  type TreatmentProposalVersion,
} from '../../lib/proposals';
import { addIsoDays, clinicDateIso } from '../../lib/agendaTime';
import { ProposalPDF } from './ProposalPDF';
import './proposal.css';

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';
type EditorState = {
  title: string;
  validUntil: string;
  paymentTerms: string;
  internalNote: string;
  customerNote: string;
  discountType: ProposalDiscountType;
  discountValue: string;
  items: ProposalEditorItem[];
};
type SaveQueueItem = { state: EditorState; sequence: number };

const itemFromRow = (row: TreatmentProposalItem): ProposalEditorItem => ({
  key: row.id,
  service_id: row.service_id,
  service_name_snapshot: row.service_name_snapshot,
  description_snapshot: row.description_snapshot ?? '',
  interval_note: row.interval_note ?? '',
  quantity: String(row.quantity),
  unit_label: row.unit_label,
  list_unit_price_snapshot: String(row.list_unit_price_snapshot),
  offered_unit_price: String(row.offered_unit_price),
  discount_type: row.discount_type,
  discount_value: String(row.discount_value),
  sort_order: row.sort_order,
});

const stateFromDetail = (detail: ProposalDetail): EditorState => ({
  title: detail.version.title,
  validUntil: detail.version.valid_until ?? '',
  paymentTerms: detail.version.payment_terms ?? '',
  internalNote: detail.version.internal_note ?? '',
  customerNote: detail.version.customer_note ?? '',
  discountType: detail.version.discount_type,
  discountValue: String(detail.version.discount_value),
  items: detail.items.map(itemFromRow),
});

const statusClass = (status: string) => `proposal-status proposal-status--${status}`;

function safeLine(item: ProposalEditorItem) {
  try {
    return calculateProposalItem({ quantity: item.quantity || '0', offeredUnitPrice: item.offered_unit_price || '0', discountType: item.discount_type, discountValue: item.discount_value || '0' });
  } catch {
    return { subtotalCents: 0, discountCents: 0, totalCents: 0 };
  }
}

export function ProposalEditorPage() {
  const { dealId = '', proposalId = '' } = useParams();
  const navigate = useNavigate();
  const { toast, confirm } = useToast();
  const { servicos } = useServicos();
  const [context, setContext] = useState<ProposalDealContext | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [editor, setEditorState] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [dirtySequence, setDirtySequence] = useState(0);
  const [serviceSearch, setServiceSearch] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const editorRef = useRef<EditorState | null>(null);
  const revisionRef = useRef(0);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const pendingRef = useRef<SaveQueueItem | null>(null);
  const drainRef = useRef<Promise<void> | null>(null);
  const issueKeyRef = useRef<string | null>(null);

  const setCleanEditor = useCallback((next: EditorState, revision: number) => {
    editorRef.current = next;
    setEditorState(next);
    revisionRef.current = Number(revision);
    sequenceRef.current = 0;
    savedSequenceRef.current = 0;
    setDirtySequence(0);
    setSaveStatus('saved');
    setSaveMessage(null);
  }, []);

  const updateEditor = useCallback((updater: (current: EditorState) => EditorState) => {
    const current = editorRef.current;
    if (!current) return;
    const next = updater(current);
    editorRef.current = next;
    setEditorState(next);
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setDirtySequence(sequence);
    setSaveStatus('pending');
    setSaveMessage(null);
  }, []);

  const reload = useCallback(async (versionId?: string | null) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [dealContext, proposal] = await Promise.all([
        loadProposalDealContext(dealId),
        loadProposal(proposalId, versionId),
      ]);
      if (proposal.proposal.deal_id !== dealId) throw new Error('PROPOSAL_DEAL_MISMATCH');
      setContext(dealContext);
      setDetail(proposal);
      setCleanEditor(stateFromDetail(proposal), proposal.version.draft_revision);
      issueKeyRef.current = null;
    } catch (error) {
      console.error('[proposals:load]', error);
      setLoadError(proposalErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [dealId, proposalId, setCleanEditor]);

  useEffect(() => { void reload(); }, [reload]);

  const runDrain = useCallback(() => {
    if (drainRef.current || !detail || detail.version.status !== 'draft') return drainRef.current ?? Promise.resolve();
    drainRef.current = (async () => {
      while (pendingRef.current) {
        const item = pendingRef.current;
        pendingRef.current = null;
        setSaveStatus('saving');
        setSaveMessage(null);
        try {
          const result = await saveProposalDraft({
            versionId: detail.version.id,
            expectedRevision: revisionRef.current,
            title: item.state.title,
            validUntil: item.state.validUntil || null,
            paymentTerms: item.state.paymentTerms,
            internalNote: item.state.internalNote,
            customerNote: item.state.customerNote,
            discountType: item.state.discountType,
            discountValue: item.state.discountValue || '0',
            items: item.state.items,
          });
          revisionRef.current = Number(result.draft_revision);
          savedSequenceRef.current = Math.max(savedSequenceRef.current, item.sequence);
          setDetail(current => current ? {
            ...current,
            version: {
              ...current.version,
              draft_revision: Number(result.draft_revision),
              subtotal: Number(result.subtotal),
              item_discount_amount: Number(result.item_discount_amount),
              net_subtotal: Number(result.net_subtotal),
              discount_amount: Number(result.discount_amount),
              total_value: Number(result.total_value),
              updated_at: result.updated_at,
            },
          } : current);
          if (sequenceRef.current > item.sequence && editorRef.current) {
            pendingRef.current = { state: editorRef.current, sequence: sequenceRef.current };
            continue;
          }
          setSaveStatus('saved');
        } catch (error) {
          console.error('[proposals:autosave]', error);
          const message = proposalErrorMessage(error);
          setSaveMessage(message);
          setSaveStatus(/outro dispositivo/i.test(message) ? 'conflict' : 'error');
          break;
        }
      }
    })().finally(() => { drainRef.current = null; });
    return drainRef.current;
  }, [detail]);

  const flush = useCallback(async () => {
    if (!detail || detail.version.status !== 'draft' || !editorRef.current) return;
    if (sequenceRef.current <= savedSequenceRef.current) return;
    if (saveStatus === 'conflict') throw new Error('PROPOSAL_DRAFT_CONFLICT');
    pendingRef.current = { state: editorRef.current, sequence: sequenceRef.current };
    await runDrain();
    if (sequenceRef.current > savedSequenceRef.current) throw new Error(saveMessage || 'PROPOSAL_SAVE_PENDING');
  }, [detail, runDrain, saveMessage, saveStatus]);

  useEffect(() => {
    if (!detail || detail.version.status !== 'draft' || dirtySequence <= savedSequenceRef.current) return;
    const timer = window.setTimeout(() => { void flush(); }, 900);
    return () => window.clearTimeout(timer);
  }, [detail, dirtySequence, flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sequenceRef.current <= savedSequenceRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const effectiveStatus = detail ? proposalEffectiveStatus(detail.version) : 'draft';
  const editable = detail?.version.status === 'draft';
  const totals = useMemo(() => {
    if (!editor) return null;
    try {
      return calculateProposalTotals(editor.items.map(item => ({ quantity: item.quantity || '0', offeredUnitPrice: item.offered_unit_price || '0', discountType: item.discount_type, discountValue: item.discount_value || '0' })), editor.discountType, editor.discountValue || '0');
    } catch { return null; }
  }, [editor]);

  const back = async () => {
    try { await flush(); navigate('/crm'); }
    catch (error) { toast.error(proposalErrorMessage(error)); }
  };

  const addService = (serviceId: string) => {
    const service = servicos.find(item => item.id === serviceId);
    if (!service || !editor) return;
    updateEditor(current => ({
      ...current,
      items: [...current.items, {
        key: crypto.randomUUID(),
        service_id: service.id,
        service_name_snapshot: service.name,
        description_snapshot: '',
        interval_note: '',
        quantity: '1',
        unit_label: 'sessão',
        list_unit_price_snapshot: String(service.price ?? 0),
        offered_unit_price: String(service.price ?? 0),
        discount_type: 'none',
        discount_value: '0',
        sort_order: current.items.length,
      }],
    }));
    setServiceSearch('');
  };

  const updateItem = (key: string, patch: Partial<ProposalEditorItem>) => updateEditor(current => ({ ...current, items: current.items.map(item => item.key === key ? { ...item, ...patch } : item) }));
  const removeItem = (key: string) => updateEditor(current => ({ ...current, items: current.items.filter(item => item.key !== key) }));
  const moveItem = (key: string, delta: number) => updateEditor(current => {
    const index = current.items.findIndex(item => item.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.items.length) return current;
    const items = [...current.items];
    [items[index], items[target]] = [items[target], items[index]];
    return { ...current, items };
  });

  const generatePdf = async (version: TreatmentProposalVersion, items: TreatmentProposalItem[]) => {
    if (version.pdf_path) return loadProposalPdf(version.pdf_path);
    if (version.status === 'draft') throw new Error('PROPOSAL_NOT_ISSUED');
    const blob = await pdf(<ProposalPDF version={version} items={items} />).toBlob();
    const artifact = await uploadProposalPdf(version.proposal_id, version.id, blob);
    return artifact.blob;
  };

  const handleIssue = async () => {
    if (!detail || !editor) return;
    setBusyAction('issue');
    try {
      await flush();
      if (!editor.items.length) throw new Error('Adicione pelo menos um serviço antes de emitir.');
      if (!editor.validUntil) throw new Error('Informe a validade da proposta.');
      if (!issueKeyRef.current) issueKeyRef.current = crypto.randomUUID();
      await issueProposal(detail.version.id, revisionRef.current, issueKeyRef.current);
      const issued = await loadProposal(proposalId, detail.version.id);
      await generatePdf(issued.version, issued.items);
      toast.success('Proposta emitida e PDF histórico criado.');
      await reload(issued.version.id);
    } catch (error) {
      console.error('[proposals:issue]', error);
      toast.error(proposalErrorMessage(error));
    } finally { setBusyAction(null); }
  };

  const handleShare = async () => {
    if (!detail) return;
    setBusyAction('share');
    try {
      const blob = await generatePdf(detail.version, detail.items);
      const mode = await shareProposalFile(blob, detail.version.title);
      toast.success(mode === 'shared' ? 'Compartilhamento aberto. O envio ainda não foi marcado.' : 'PDF baixado. O envio ainda não foi marcado.');
      await reload(detail.version.id);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error(proposalErrorMessage(error));
    } finally { setBusyAction(null); }
  };

  const handleOpenPdf = async () => {
    if (!detail) return;
    setBusyAction('pdf');
    try {
      if (!detail.version.pdf_path) await generatePdf(detail.version, detail.items);
      const refreshed = await loadProposal(proposalId, detail.version.id);
      const url = await proposalSignedUrl(refreshed.version.pdf_path);
      if (!url) throw new Error('PDF ainda não disponível.');
      window.open(url, '_blank', 'noopener,noreferrer');
      setDetail(refreshed);
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleSent = async () => {
    if (!detail) return;
    setBusyAction('sent');
    try {
      await markProposalSent(detail.version.id);
      toast.success('Proposta marcada como enviada e CRM atualizado.');
      await reload(detail.version.id);
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleRevision = async () => {
    if (!detail) return;
    setBusyAction('revision');
    try {
      const row = await createProposalRevision(detail.version.id);
      toast.success(`Versão ${row.version_number} criada como rascunho.`);
      await reload(row.version_id);
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleAccept = async (markWon: boolean) => {
    if (!detail) return;
    const ok = await confirm({
      title: markWon ? 'Aceitar e fechar oportunidade?' : 'Marcar proposta como aceita?',
      message: markWon ? 'A versão ficará aceita e o Deal será marcado como ganho. Nenhum atendimento ou cobrança será criado.' : 'A versão ficará aceita, mas a oportunidade continuará no estágio atual.',
      confirmLabel: markWon ? 'Aceitar + ganhar' : 'Marcar aceita',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setBusyAction(markWon ? 'accept-won' : 'accept');
    try {
      await acceptProposal(detail.version.id, markWon);
      toast.success(markWon ? 'Proposta aceita e oportunidade ganha.' : 'Proposta marcada como aceita.');
      await reload(detail.version.id);
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleDecline = async () => {
    if (!detail) return;
    const reason = window.prompt('Motivo da recusa (opcional):') ?? '';
    setBusyAction('decline');
    try {
      await declineProposal(detail.version.id, reason);
      toast.success('Versão marcada como recusada. A oportunidade não foi perdida automaticamente.');
      await reload(detail.version.id);
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleVoid = async () => {
    if (!detail) return;
    const reason = window.prompt('Motivo da anulação:')?.trim() ?? '';
    if (!reason) return;
    setBusyAction('void');
    try {
      await voidProposal(detail.version.id, reason);
      toast.success('Proposta anulada, com histórico preservado.');
      await reload(detail.version.id);
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const openSchedule = () => {
    if (!detail || !context) return;
    if (!context.patient_id) {
      toast.error('Este contato ainda não é paciente. Converta/vincule a paciente no CRM antes de agendar.');
      return;
    }
    const schedulable = detail.items.filter(item => item.service_id);
    if (!schedulable.length) { toast.error('Nenhum item desta versão ainda aponta para um serviço disponível no catálogo.'); return; }
    if (schedulable.length === 1) {
      navigate(`/agenda?patient_id=${context.patient_id}&service_id=${schedulable[0].service_id}`, { state: { patient: { id: context.patient_id, name: context.contact_name, phone: null }, from: `/crm/deals/${dealId}/proposals/${proposalId}` } });
      return;
    }
    setScheduleOpen(true);
  };

  if (loading) return <div className="full-loader">Carregando proposta...</div>;
  if (loadError || !detail || !editor || !context) return <div className="page"><div className="empty-state"><p>{loadError ?? 'Proposta não encontrada.'}</p><button className="btn btn--secondary btn--sm" onClick={() => navigate('/crm')}>Voltar ao CRM</button></div></div>;

  const filteredServices = servicos.filter(service => service.active && (!serviceSearch.trim() || service.name.toLocaleLowerCase('pt-BR').includes(serviceSearch.trim().toLocaleLowerCase('pt-BR')))).slice(0, 10);
  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'pending' ? 'Alterações pendentes' : saveStatus === 'conflict' ? 'Conflito de edição' : saveStatus === 'error' ? 'Erro ao salvar' : 'Salvo';

  return <div className="proposal-root">
    <header className="proposal-header">
      <button className="icon-btn" onClick={() => void back()} aria-label="Voltar"><ArrowLeft size={19} /></button>
      <div className="proposal-header-title"><strong>{detail.version.title}</strong><span>{context.contact_name} · Versão {detail.version.version_number}</span></div>
      <span className={statusClass(effectiveStatus)}>{PROPOSAL_STATUS_LABEL[effectiveStatus]}</span>
      {editable && <span className={`proposal-save proposal-save--${saveStatus}`}>{saveStatus === 'saving' && <RefreshCw size={12} className="spin" />}{saveLabel}</span>}
    </header>

    {saveMessage && <div className="proposal-alert">{saveMessage}{saveStatus === 'conflict' && <button className="btn btn--ghost btn--sm" onClick={() => void reload(detail.version.id)}>Recarregar versão do servidor</button>}</div>}

    <main className="proposal-layout">
      <aside className="proposal-history-pane">
        <div className="proposal-pane-title">Histórico</div>
        {detail.versions.map(version => {
          const status = proposalEffectiveStatus(version);
          return <button key={version.id} className={`proposal-version-card${version.id === detail.version.id ? ' proposal-version-card--active' : ''}`} onClick={() => void reload(version.id)}>
            <span><strong>Versão {version.version_number}</strong><small>{PROPOSAL_STATUS_LABEL[status]}</small></span>
            <strong>{proposalMoney(version.total_value)}</strong>
            <small>{version.issued_at ? new Date(version.issued_at).toLocaleDateString('pt-BR') : 'Rascunho atual'}</small>
          </button>;
        })}
        {detail.version.status !== 'draft' && detail.version.status !== 'accepted' && <button className="btn btn--secondary btn--md" onClick={() => void handleRevision()} disabled={Boolean(busyAction)}><FilePlus2 size={15} /> Criar nova versão</button>}
      </aside>

      <section className="proposal-editor-pane">
        <div className="proposal-card proposal-title-card">
          <label className="field-label">Título da proposta</label>
          <input className="field-input" value={editor.title} onChange={event => updateEditor(current => ({ ...current, title: event.target.value }))} disabled={!editable} />
          <div className="proposal-recipient">Para <strong>{context.contact_name}</strong>{context.patient_id ? ' · paciente vinculada' : ' · lead/contato ainda sem paciente'}</div>
        </div>

        {editable && <div className="proposal-card">
          <div className="proposal-pane-title">Adicionar serviço</div>
          {context.interests.length > 0 && <div className="proposal-interest-row">{context.interests.map((interest, index) => <button key={`${interest.service_id}-${index}`} className="crm-tag" disabled={!interest.service_id} onClick={() => interest.service_id && addService(interest.service_id)}>+ {interest.label}</button>)}</div>}
          <div className="proposal-service-search"><Search size={16} /><input value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Buscar no catálogo" /></div>
          {serviceSearch && <div className="proposal-service-results">{filteredServices.map(service => <button key={service.id} onClick={() => addService(service.id)}><span>{service.name}</span><strong>{proposalMoney(service.price)}</strong><Plus size={15} /></button>)}</div>}
        </div>}

        <div className="proposal-items">
          {editor.items.length === 0 ? <div className="proposal-empty"><FilePlus2 size={26} /><strong>Adicione os procedimentos deste plano</strong><span>Nenhum item é sugerido ou inserido automaticamente.</span></div> : editor.items.map((item, index) => {
            const line = safeLine(item);
            return <article className="proposal-item-card" key={item.key}>
              <div className="proposal-item-head">
                <div><strong>{item.service_name_snapshot}</strong><span>Referência do catálogo: {proposalMoney(item.list_unit_price_snapshot)}</span></div>
                {editable && <div className="proposal-item-actions"><button className="icon-btn" disabled={index===0} onClick={() => moveItem(item.key,-1)} aria-label="Mover para cima"><ArrowUp size={15} /></button><button className="icon-btn" disabled={index===editor.items.length-1} onClick={() => moveItem(item.key,1)} aria-label="Mover para baixo"><ArrowDown size={15} /></button><button className="icon-btn" onClick={() => removeItem(item.key)} aria-label="Remover"><Trash2 size={15} /></button></div>}
              </div>
              <div className="proposal-item-grid">
                <div><label className="field-label">Quantidade</label><div className="proposal-stepper"><button disabled={!editable} onClick={() => updateItem(item.key,{ quantity:String(Math.max(1,Number(item.quantity||1)-1)) })}>−</button><input disabled={!editable} inputMode="decimal" value={item.quantity} onChange={event => updateItem(item.key,{quantity:event.target.value})}/><button disabled={!editable} onClick={() => updateItem(item.key,{ quantity:String(Number(item.quantity||0)+1) })}>+</button></div></div>
                <div><label className="field-label">Unidade</label><select className="field-input" disabled={!editable} value={item.unit_label} onChange={event => updateItem(item.key,{unit_label:event.target.value})}><option value="sessão">sessão</option><option value="procedimento">procedimento</option><option value="unidade">unidade</option></select></div>
                <div><label className="field-label">Valor ofertado / unidade</label><input className="field-input" disabled={!editable} inputMode="decimal" value={item.offered_unit_price} onChange={event => updateItem(item.key,{offered_unit_price:event.target.value})}/></div>
                <div><label className="field-label">Desconto do item</label><div className="proposal-discount-inline"><select disabled={!editable} value={item.discount_type} onChange={event => updateItem(item.key,{discount_type:event.target.value as ProposalDiscountType,discount_value:'0'})}><option value="none">Sem</option><option value="amount">R$</option><option value="percent">%</option></select><input disabled={!editable || item.discount_type==='none'} inputMode="decimal" value={item.discount_value} onChange={event => updateItem(item.key,{discount_value:event.target.value})}/></div></div>
              </div>
              <div className="proposal-item-grid proposal-item-notes">
                <div><label className="field-label">Descrição apresentada</label><input className="field-input" disabled={!editable} value={item.description_snapshot} onChange={event => updateItem(item.key,{description_snapshot:event.target.value})} placeholder="Opcional" /></div>
                <div><label className="field-label">Intervalo / observação manual</label><input className="field-input" disabled={!editable} value={item.interval_note} onChange={event => updateItem(item.key,{interval_note:event.target.value})} placeholder="Ex.: 2 sessões, intervalo definido pela profissional" /></div>
              </div>
              <div className="proposal-line-total"><span>Subtotal {proposalMoney(centsToMoney(line.subtotalCents))}{line.discountCents>0 ? ` · desconto ${proposalMoney(centsToMoney(line.discountCents))}` : ''}</span><strong>{proposalMoney(centsToMoney(line.totalCents))}</strong></div>
            </article>;
          })}
        </div>

        <div className="proposal-card proposal-notes-grid">
          <div><label className="field-label">Condições de pagamento</label><textarea className="field-input" rows={3} disabled={!editable} value={editor.paymentTerms} onChange={event => updateEditor(current => ({...current,paymentTerms:event.target.value}))} placeholder="Ex.: À vista via PIX ou até 3x no cartão" /></div>
          <div><label className="field-label">Observação para a cliente</label><textarea className="field-input" rows={3} disabled={!editable} value={editor.customerNote} onChange={event => updateEditor(current => ({...current,customerNote:event.target.value}))} placeholder="Pode aparecer no PDF" /></div>
          <div className="proposal-internal-note"><label className="field-label">Nota interna</label><textarea className="field-input" rows={2} disabled={!editable} value={editor.internalNote} onChange={event => updateEditor(current => ({...current,internalNote:event.target.value}))} placeholder="Nunca aparece no PDF" /></div>
        </div>
      </section>

      <aside className="proposal-summary-pane">
        <div className="proposal-card proposal-summary-card">
          <div className="proposal-pane-title">Resumo</div>
          <div className="proposal-sum-row"><span>Subtotal</span><strong>{proposalMoney(centsToMoney(totals?.subtotalCents ?? 0))}</strong></div>
          {(totals?.itemDiscountCents ?? 0)>0 && <div className="proposal-sum-row"><span>Descontos nos itens</span><strong>- {proposalMoney(centsToMoney(totals?.itemDiscountCents ?? 0))}</strong></div>}
          <div className="proposal-global-discount"><label className="field-label">Condição especial</label><div className="proposal-discount-inline"><select disabled={!editable} value={editor.discountType} onChange={event => updateEditor(current => ({...current,discountType:event.target.value as ProposalDiscountType,discountValue:'0'}))}><option value="none">Sem desconto</option><option value="amount">R$</option><option value="percent">%</option></select><input disabled={!editable || editor.discountType==='none'} inputMode="decimal" value={editor.discountValue} onChange={event => updateEditor(current => ({...current,discountValue:event.target.value}))}/></div></div>
          {(totals?.globalDiscountCents ?? 0)>0 && <div className="proposal-sum-row"><span>Desconto geral</span><strong>- {proposalMoney(centsToMoney(totals?.globalDiscountCents ?? 0))}</strong></div>}
          <div className="proposal-grand-total"><span>Total</span><strong>{proposalMoney(centsToMoney(totals?.totalCents ?? 0))}</strong></div>

          <div className="proposal-validity"><label className="field-label">Validade</label><input className="field-input" type="date" disabled={!editable} value={editor.validUntil} onChange={event => updateEditor(current => ({...current,validUntil:event.target.value}))}/>{editable && <div className="proposal-shortcuts">{[7,15,30].map(days => <button key={days} onClick={() => updateEditor(current => ({...current,validUntil:addIsoDays(clinicDateIso(),days)}))}>{days} dias</button>)}</div>}</div>

          {editable ? <button className="btn btn--primary btn--md proposal-main-action" onClick={() => void handleIssue()} disabled={Boolean(busyAction) || saveStatus==='conflict'}><Check size={16}/>{busyAction==='issue'?'Emitindo…':'Emitir proposta'}</button> : <>
            <button className="btn btn--secondary btn--md" onClick={() => void handleOpenPdf()} disabled={Boolean(busyAction)}><Download size={16}/> Abrir PDF</button>
            <button className="btn btn--primary btn--md" onClick={() => void handleShare()} disabled={Boolean(busyAction)}><Share2 size={16}/> Compartilhar proposta</button>
            {!detail.version.sent_at && detail.version.status==='issued' && <button className="btn btn--secondary btn--md" onClick={() => void handleSent()} disabled={Boolean(busyAction)}><Send size={16}/> Marcar como enviada</button>}
            {detail.version.sent_at && <div className="proposal-sent-note"><Send size={13}/> Enviada em {new Date(detail.version.sent_at).toLocaleString('pt-BR')}</div>}
            {detail.version.status==='issued' && effectiveStatus!=='expired' && <><button className="btn btn--secondary btn--md" onClick={() => void handleAccept(false)} disabled={Boolean(busyAction)}><Check size={16}/> Marcar como aceita</button><button className="btn btn--secondary btn--md" onClick={() => void handleAccept(true)} disabled={Boolean(busyAction)}><Check size={16}/> Aceita + oportunidade ganha</button><button className="btn btn--ghost btn--md" onClick={() => void handleDecline()} disabled={Boolean(busyAction)}><X size={16}/> Marcar recusada</button><button className="btn btn--ghost btn--sm" onClick={() => void handleVoid()} disabled={Boolean(busyAction)}>Anular documento</button></>}
            {effectiveStatus==='expired' && <button className="btn btn--secondary btn--md" onClick={() => void handleRevision()} disabled={Boolean(busyAction)}><Clock3 size={16}/> Nova versão com validade</button>}
            {detail.version.status==='accepted' && <button className="btn btn--primary btn--md" onClick={openSchedule}><CalendarPlus size={16}/> Agendar</button>}
          </>}
        </div>
        {!editable && <div className="proposal-card proposal-readonly-note">Versão histórica congelada. Nome, preço, quantidade e descontos vêm dos snapshots desta versão — não do catálogo atual.</div>}
      </aside>
    </main>

    {scheduleOpen && <div className="crm-modal-overlay" onClick={() => setScheduleOpen(false)}><div className="crm-modal" onClick={event => event.stopPropagation()}><div className="crm-modal-head"><div><strong>Qual item deseja agendar?</strong><div className="page-sub">Nenhuma sessão será criada automaticamente.</div></div><button className="icon-btn" onClick={() => setScheduleOpen(false)}><X size={18}/></button></div><div className="crm-modal-body proposal-schedule-list">{detail.items.map(item => <button key={item.id} disabled={!item.service_id} onClick={() => item.service_id && navigate(`/agenda?patient_id=${context.patient_id}&service_id=${item.service_id}`, { state: { patient: { id: context.patient_id, name: context.contact_name, phone: null }, from: `/crm/deals/${dealId}/proposals/${proposalId}` } })}><span><strong>{item.service_name_snapshot}</strong><small>{Number(item.quantity)} {item.unit_label}</small></span><CalendarPlus size={17}/></button>)}</div></div></div>}
  </div>;
}

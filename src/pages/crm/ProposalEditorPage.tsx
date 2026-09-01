import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { pdf } from '@react-pdf/renderer';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, FileText, Plus, RefreshCw, Search, Share2, Trash2 } from 'lucide-react';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import {
  advanceProposalCrm,
  createProposalRevision,
  deleteProposal,
  loadProposal,
  loadProposalDealContext,
  saveProposalDraft,
  shareProposalFile,
  type ProposalDealContext,
  type ProposalDetail,
} from '../../hooks/useProposals';
import {
  calculateProposalTotals,
  centsToMoney,
  proposalErrorMessage,
  proposalMoney,
  type ProposalDiscountType,
  type ProposalEditorItem,
  type TreatmentProposalItem,
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
  payment_condition: row.payment_condition ?? '',
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

export function ProposalEditorPage() {
  const { dealId = '', proposalId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [advanceCrm, setAdvanceCrm] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const editorRef = useRef<EditorState | null>(null);
  const revisionRef = useRef(0);
  const sequenceRef = useRef(0);
  const savedSequenceRef = useRef(0);
  const pendingRef = useRef<SaveQueueItem | null>(null);
  const drainRef = useRef<Promise<void> | null>(null);

  const editable = detail?.version.status === 'draft';
  const requestedReturn = (location.state as { from?: string } | null)?.from;
  const returnTo = requestedReturn ?? (context?.patient_id ? `/pacientes/${context.patient_id}?tab=proposals` : '/crm');

  const setCleanEditor = useCallback((next: EditorState, revision: number) => {
    editorRef.current = next; setEditorState(next); revisionRef.current = Number(revision); sequenceRef.current = 0; savedSequenceRef.current = 0;
    setDirtySequence(0); setSaveStatus('saved'); setSaveMessage(null);
  }, []);

  const updateEditor = useCallback((updater: (current: EditorState) => EditorState) => {
    const current = editorRef.current; if (!current) return;
    const next = updater(current); editorRef.current = next; setEditorState(next);
    const sequence = sequenceRef.current + 1; sequenceRef.current = sequence; setDirtySequence(sequence); setSaveStatus('pending'); setSaveMessage(null);
  }, []);

  const reload = useCallback(async (versionId?: string | null) => {
    setLoading(true); setLoadError(null);
    try {
      const [dealContext, proposal] = await Promise.all([loadProposalDealContext(dealId), loadProposal(proposalId, versionId)]);
      if (proposal.proposal.deal_id !== dealId) throw new Error('PROPOSAL_DEAL_MISMATCH');
      setContext(dealContext); setDetail(proposal); setCleanEditor(stateFromDetail(proposal), proposal.version.draft_revision);
    } catch (error) { console.error('[proposals:load]', error); setLoadError(proposalErrorMessage(error)); }
    finally { setLoading(false); }
  }, [dealId, proposalId, setCleanEditor]);

  useEffect(() => { void reload(); }, [reload]);

  const runDrain = useCallback(() => {
    if (drainRef.current || !detail || detail.version.status !== 'draft') return drainRef.current ?? Promise.resolve();
    drainRef.current = (async () => {
      while (pendingRef.current) {
        const item = pendingRef.current; pendingRef.current = null; setSaveStatus('saving'); setSaveMessage(null);
        try {
          const result = await saveProposalDraft({
            versionId: detail.version.id, expectedRevision: revisionRef.current, title: item.state.title, validUntil: item.state.validUntil || null,
            paymentTerms: item.state.paymentTerms, internalNote: item.state.internalNote, customerNote: item.state.customerNote,
            discountType: item.state.discountType, discountValue: item.state.discountValue || '0', items: item.state.items,
          });
          revisionRef.current = Number(result.draft_revision); savedSequenceRef.current = Math.max(savedSequenceRef.current, item.sequence);
          setDetail(current => current ? { ...current, version: { ...current.version, draft_revision: Number(result.draft_revision), subtotal: Number(result.subtotal), item_discount_amount: Number(result.item_discount_amount), net_subtotal: Number(result.net_subtotal), discount_amount: Number(result.discount_amount), total_value: Number(result.total_value), updated_at: result.updated_at } } : current);
          if (sequenceRef.current > item.sequence && editorRef.current) { pendingRef.current = { state: editorRef.current, sequence: sequenceRef.current }; continue; }
          setSaveStatus('saved');
        } catch (error) {
          console.error('[proposals:autosave]', error); const message = proposalErrorMessage(error); setSaveMessage(message); setSaveStatus(/outro dispositivo/i.test(message) ? 'conflict' : 'error'); break;
        }
      }
    })().finally(() => { drainRef.current = null; });
    return drainRef.current;
  }, [detail]);

  const flush = useCallback(async () => {
    if (!detail || detail.version.status !== 'draft' || !editorRef.current) return;
    if (sequenceRef.current <= savedSequenceRef.current) return;
    if (saveStatus === 'conflict') throw new Error('PROPOSAL_DRAFT_CONFLICT');
    pendingRef.current = { state: editorRef.current, sequence: sequenceRef.current }; await runDrain();
    if (sequenceRef.current > savedSequenceRef.current) throw new Error(saveMessage || 'PROPOSAL_SAVE_PENDING');
  }, [detail, runDrain, saveMessage, saveStatus]);

  useEffect(() => {
    if (!detail || detail.version.status !== 'draft' || dirtySequence <= savedSequenceRef.current) return;
    const timer = window.setTimeout(() => { void flush(); }, 800); return () => window.clearTimeout(timer);
  }, [detail, dirtySequence, flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (sequenceRef.current <= savedSequenceRef.current) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const totals = useMemo(() => {
    if (!editor) return null;
    try { return calculateProposalTotals(editor.items.map(item => ({ quantity: item.quantity || '1', offeredUnitPrice: item.offered_unit_price || '0', discountType: item.discount_type, discountValue: item.discount_value || '0' })), editor.discountType, editor.discountValue || '0'); }
    catch { return null; }
  }, [editor]);

  const back = async () => { try { await flush(); navigate(returnTo); } catch (error) { toast.error(proposalErrorMessage(error)); } };

  const addService = (serviceId: string) => {
    const service = servicos.find(item => item.id === serviceId); if (!service || !editor) return;
    updateEditor(current => ({ ...current, items: [...current.items, {
      key: crypto.randomUUID(), service_id: service.id, service_name_snapshot: service.name, description_snapshot: '', interval_note: '', payment_condition: '',
      quantity: '1', unit_label: 'procedimento', list_unit_price_snapshot: String(service.price ?? 0), offered_unit_price: String(service.price ?? 0), discount_type: 'none', discount_value: '0', sort_order: current.items.length,
    }] })); setServiceSearch('');
  };
  const updateItem = (key: string, patch: Partial<ProposalEditorItem>) => updateEditor(current => ({ ...current, items: current.items.map(item => item.key === key ? { ...item, ...patch } : item) }));
  const removeItem = (key: string) => updateEditor(current => ({ ...current, items: current.items.filter(item => item.key !== key) }));
  const moveItem = (key: string, delta: number) => updateEditor(current => { const index = current.items.findIndex(item => item.key === key); const target = index + delta; if (index < 0 || target < 0 || target >= current.items.length) return current; const items = [...current.items]; [items[index], items[target]] = [items[target], items[index]]; return { ...current, items }; });

  const handleSave = async () => {
    if (!detail || !editor) return; setBusyAction('save');
    try {
      if (!editor.items.length) throw new Error('Adicione pelo menos um procedimento.');
      await flush();
      if (advanceCrm) { await advanceProposalCrm(detail.proposal.id); toast.success('Proposta salva e paciente movida para Proposta enviada no CRM.'); }
      else toast.success('Proposta salva.');
    } catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleDelete = async () => {
    if (!detail) return;
    const ok = await confirm({ title: 'Excluir proposta definitivamente?', message: 'Ela será removida da ficha da paciente e não ficará no histórico de propostas. Esta ação não pode ser desfeita.', confirmLabel: 'Excluir proposta', cancelLabel: 'Cancelar', tone: 'warning' });
    if (!ok) return; setBusyAction('delete');
    try { await deleteProposal(detail.proposal.id); toast.success('Proposta excluída.'); navigate(returnTo, { replace: true }); }
    catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleEditableCopy = async () => {
    if (!detail) return; setBusyAction('copy');
    try { const row = await createProposalRevision(detail.version.id); await reload(row.version_id); toast.success('Cópia editável criada.'); }
    catch (error) { toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  const handleShare = async () => {
    if (!detail || !editor || !context) return; setBusyAction('share');
    try {
      await flush();
      const current = await loadProposal(proposalId, detail.version.id);
      const printableVersion = { ...current.version, recipient_snapshot: current.version.recipient_snapshot ?? { name: context.contact_name }, issued_at: current.version.issued_at ?? new Date().toISOString(), valid_until: editor.validUntil || null };
      const blob = await pdf(<ProposalPDF version={printableVersion} items={current.items} />).toBlob();
      const mode = await shareProposalFile(blob, printableVersion.title); toast.success(mode === 'shared' ? 'Compartilhamento aberto.' : 'PDF baixado.');
    } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; toast.error(proposalErrorMessage(error)); }
    finally { setBusyAction(null); }
  };

  if (loading) return <div className="full-loader">Carregando proposta...</div>;
  if (loadError || !detail || !editor || !context) return <div className="page"><div className="empty-state"><p>{loadError ?? 'Proposta não encontrada.'}</p><button className="btn btn--secondary btn--sm" onClick={() => navigate('/crm')}>Voltar</button></div></div>;

  const filteredServices = servicos.filter(service => service.active && (!serviceSearch.trim() || service.name.toLocaleLowerCase('pt-BR').includes(serviceSearch.trim().toLocaleLowerCase('pt-BR')))).slice(0, 10);
  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'pending' ? 'Alterações pendentes' : saveStatus === 'conflict' ? 'Conflito de edição' : saveStatus === 'error' ? 'Erro ao salvar' : 'Salvo';

  return <div className="proposal-root">
    <header className="proposal-header">
      <button className="icon-btn" onClick={() => void back()} aria-label="Voltar"><ArrowLeft size={19} /></button>
      <div className="proposal-header-title"><strong>{editor.title}</strong><span>{context.contact_name} · orçamento</span></div>
      {editable && <span className={`proposal-save proposal-save--${saveStatus}`}>{saveStatus === 'saving' && <RefreshCw size={12} className="spin" />}{saveLabel}</span>}
      <button className="btn btn--ghost btn--sm" onClick={() => void handleDelete()} disabled={Boolean(busyAction)}><Trash2 size={14}/> Excluir</button>
    </header>

    {saveMessage && <div className="proposal-alert">{saveMessage}</div>}

    <main className="proposal-layout" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(260px,320px)', maxWidth: 1180, margin: '0 auto' }}>
      <section className="proposal-editor-pane">
        <div className="proposal-card proposal-title-card">
          <label className="field-label">Nome da proposta</label>
          <input className="field-input" value={editor.title} onChange={event => updateEditor(current => ({ ...current, title: event.target.value }))} disabled={!editable} />
          <div className="proposal-recipient">Paciente: <strong>{context.contact_name}</strong></div>
        </div>

        {editable && <div className="proposal-card">
          <div className="proposal-pane-title">Adicionar procedimento</div>
          <div className="proposal-service-search"><Search size={16}/><input value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Buscar procedimento no catálogo" /></div>
          {serviceSearch && <div className="proposal-service-results">{filteredServices.map(service => <button key={service.id} onClick={() => addService(service.id)}><span>{service.name}</span><strong>{proposalMoney(service.price)}</strong><Plus size={15}/></button>)}</div>}
        </div>}

        <div className="proposal-items">
          {editor.items.length === 0 ? <div className="proposal-empty"><FileText size={28}/><strong>Adicione os procedimentos deste orçamento</strong><span>A paciente pode fechar apenas parte deles depois.</span></div> : editor.items.map((item, index) => {
            const valueInputId = `proposal-value-${item.key}`;
            const paymentInputId = `proposal-payment-${item.key}`;
            return <article className="proposal-item-card" key={item.key}>
              <div className="proposal-item-head">
                <strong>{item.service_name_snapshot}</strong>
                {editable && <div className="proposal-item-actions"><button className="icon-btn" disabled={index===0} onClick={() => moveItem(item.key,-1)} aria-label="Mover para cima"><ArrowUp size={15}/></button><button className="icon-btn" disabled={index===editor.items.length-1} onClick={() => moveItem(item.key,1)} aria-label="Mover para baixo"><ArrowDown size={15}/></button><button className="icon-btn" onClick={() => removeItem(item.key)} aria-label="Remover procedimento"><Trash2 size={15}/></button></div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,0.65fr) minmax(180px,1fr)', gap: 10 }}>
                <div><label className="field-label" htmlFor={valueInputId}>Valor proposto</label><input id={valueInputId} className="field-input" disabled={!editable} inputMode="decimal" value={item.offered_unit_price} onChange={event => updateItem(item.key,{offered_unit_price:event.target.value,quantity:'1',discount_type:'none',discount_value:'0'})}/></div>
                <div><label className="field-label" htmlFor={paymentInputId}>Condição de pagamento</label><input id={paymentInputId} className="field-input" disabled={!editable} value={item.payment_condition} onChange={event => updateItem(item.key,{payment_condition:event.target.value})} placeholder="Ex.: PIX à vista ou até 6x sem juros" /></div>
              </div>
              <div style={{ marginTop: 10 }}><label className="field-label">Observação</label><textarea className="field-input" rows={2} disabled={!editable} value={item.interval_note} onChange={event => updateItem(item.key,{interval_note:event.target.value})} placeholder="Ex.: 5 sessões · intervalo de 30 dias" /></div>
            </article>;
          })}
        </div>

        <div className="proposal-card"><label className="field-label">Observação geral (opcional)</label><textarea className="field-input" rows={3} disabled={!editable} value={editor.customerNote} onChange={event => updateEditor(current => ({...current,customerNote:event.target.value}))} placeholder="Informação geral que deve aparecer na proposta" /></div>
      </section>

      <aside className="proposal-summary-pane">
        <div className="proposal-card proposal-summary-card">
          <div className="proposal-pane-title">Resumo</div>
          <div className="proposal-grand-total"><span>Total da proposta</span><strong>{proposalMoney(centsToMoney(totals?.totalCents ?? 0))}</strong></div>
          <div className="proposal-validity"><label className="field-label">Proposta válida até</label><input className="field-input" type="date" disabled={!editable} value={editor.validUntil} onChange={event => updateEditor(current => ({...current,validUntil:event.target.value}))}/>{editable && <div className="proposal-shortcuts">{[7,15,30].map(days => <button key={days} onClick={() => updateEditor(current => ({...current,validUntil:addIsoDays(clinicDateIso(),days)}))}>{days} dias</button>)}</div>}</div>

          {editable ? <>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={advanceCrm} onChange={event => setAdvanceCrm(event.target.checked)} style={{ marginTop: 2 }} />
              <span><strong style={{ display: 'block', fontSize: 12 }}>Marcar como proposta enviada no CRM</strong><span className="page-sub">Ao salvar, a paciente vai para “Proposta enviada”. O Hub nunca move uma negociação para trás.</span></span>
            </label>
            <button className="btn btn--primary btn--md proposal-main-action" onClick={() => void handleSave()} disabled={Boolean(busyAction) || saveStatus==='conflict'}>{busyAction==='save'?'Salvando…':'Salvar proposta'}</button>
          </> : <button className="btn btn--secondary btn--md" onClick={() => void handleEditableCopy()} disabled={Boolean(busyAction)}><Copy size={15}/> Criar cópia editável</button>}

          <button className="btn btn--secondary btn--md" onClick={() => void handleShare()} disabled={Boolean(busyAction) || !editor.items.length}><Share2 size={15}/> Gerar / compartilhar PDF</button>
        </div>
        <div className="proposal-card proposal-readonly-note">Esta área é apenas o orçamento. Se a paciente fechar um ou mais procedimentos, registre a venda no atendimento/financeiro.</div>
      </aside>
    </main>
  </div>;
}

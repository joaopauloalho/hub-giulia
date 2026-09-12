import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, FileImage, FileText, ImagePlus, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import {
  advanceProposalCrm,
  deleteProposal,
  deleteProposalAttachment,
  loadProposal,
  loadProposalAttachments,
  loadProposalDealContext,
  saveProposalDraft,
  uploadProposalAttachment,
  type ProposalAttachment,
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

function ProposalAttachments({ proposalId }: { proposalId: string }) {
  const { toast, confirm } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ProposalAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<ProposalAttachment | null>(null);

  const reload = useCallback(async () => {
    try { setItems(await loadProposalAttachments(proposalId)); }
    catch (error) { console.error('[proposal:attachments]', error); toast.error('Não foi possível carregar os anexos.'); }
  }, [proposalId, toast]);
  useEffect(() => { void reload(); }, [reload]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let order = items.length;
      for (const file of Array.from(files)) { await uploadProposalAttachment(proposalId, file, order); order += 1; }
      await reload();
      toast.success(files.length === 1 ? 'Imagem anexada.' : `${files.length} imagens anexadas.`);
    } catch (error) { console.error('[proposal:attachment-upload]', error); toast.error(error instanceof Error ? error.message : 'Não foi possível anexar a imagem.'); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const remove = async (item: ProposalAttachment) => {
    const ok = await confirm({ title: 'Excluir imagem?', message: 'O print será removido desta proposta.', confirmLabel: 'Excluir', cancelLabel: 'Cancelar', tone: 'warning' });
    if (!ok) return;
    setBusy(true);
    try { await deleteProposalAttachment(item); if (viewer?.id === item.id) setViewer(null); await reload(); toast.success('Imagem removida.'); }
    catch { toast.error('Não foi possível excluir a imagem.'); }
    finally { setBusy(false); }
  };

  return <div className="proposal-card">
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div><div className="proposal-pane-title">Anexos da proposta</div><div className="page-sub">Prints do Canva ou outras imagens do orçamento. Uso interno.</div></div>
      <><input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={event => void upload(event.target.files)} /><button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => inputRef.current?.click()}><ImagePlus size={15}/>{busy ? 'Enviando…' : 'Adicionar imagens'}</button></>
    </div>
    {items.length === 0 ? <div style={{ marginTop: 14, padding: 22, border: '1px dashed var(--border)', borderRadius: 12, textAlign: 'center', color: 'var(--text-3)' }}><FileImage size={25}/><div style={{ marginTop: 6 }}>Nenhum print anexado.</div></div> : <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
      {items.map(item => <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg)' }}>
        <button type="button" onClick={() => setViewer(item)} style={{ width: '100%', padding: 0, border: 0, background: '#f6f6f6', cursor: 'pointer' }}>{item.signed_url ? <img src={item.signed_url} alt="Anexo da proposta" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }}/> : <div style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}><FileImage size={26}/></div>}</button>
        <div style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{item.original_name || 'Imagem'}</span><button type="button" className="icon-btn" disabled={busy} onClick={() => void remove(item)} aria-label="Excluir imagem"><Trash2 size={14}/></button></div>
      </div>)}
    </div>}
    {viewer?.signed_url && <div role="dialog" aria-modal="true" onClick={() => setViewer(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.82)', display: 'grid', placeItems: 'center', padding: 24 }}><button type="button" className="icon-btn" onClick={() => setViewer(null)} style={{ position: 'fixed', top: 20, right: 20, background: '#fff' }}><X size={20}/></button><img onClick={event => event.stopPropagation()} src={viewer.signed_url} alt="Anexo ampliado" style={{ maxWidth: '94vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12 }}/></div>}
  </div>;
}

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
  const requestedReturn = (location.state as { from?: string } | null)?.from;
  const returnTo = requestedReturn ?? (context?.patient_id ? `/pacientes/${context.patient_id}?tab=proposals` : '/crm');

  const setCleanEditor = useCallback((next: EditorState, revision: number) => { editorRef.current = next; setEditorState(next); revisionRef.current = Number(revision); sequenceRef.current = 0; savedSequenceRef.current = 0; setDirtySequence(0); setSaveStatus('saved'); setSaveMessage(null); }, []);
  const updateEditor = useCallback((updater: (current: EditorState) => EditorState) => { const current = editorRef.current; if (!current) return; const next = updater(current); editorRef.current = next; setEditorState(next); const sequence = sequenceRef.current + 1; sequenceRef.current = sequence; setDirtySequence(sequence); setSaveStatus('pending'); setSaveMessage(null); }, []);
  const reload = useCallback(async () => { setLoading(true); setLoadError(null); try { const [dealContext, proposal] = await Promise.all([loadProposalDealContext(dealId), loadProposal(proposalId)]); if (proposal.proposal.deal_id !== dealId) throw new Error('PROPOSAL_DEAL_MISMATCH'); setContext(dealContext); setDetail(proposal); setCleanEditor(stateFromDetail(proposal), proposal.version.draft_revision); } catch (error) { console.error('[proposals:load]', error); setLoadError(proposalErrorMessage(error)); } finally { setLoading(false); } }, [dealId, proposalId, setCleanEditor]);
  useEffect(() => { void reload(); }, [reload]);

  const runDrain = useCallback(() => {
    if (drainRef.current || !detail) return drainRef.current ?? Promise.resolve();
    drainRef.current = (async () => { while (pendingRef.current) { const item = pendingRef.current; pendingRef.current = null; setSaveStatus('saving'); setSaveMessage(null); try { const result = await saveProposalDraft({ versionId: detail.version.id, expectedRevision: revisionRef.current, title: item.state.title, validUntil: item.state.validUntil || null, paymentTerms: item.state.paymentTerms, internalNote: item.state.internalNote, customerNote: item.state.customerNote, discountType: item.state.discountType, discountValue: item.state.discountValue || '0', items: item.state.items }); revisionRef.current = Number(result.draft_revision); savedSequenceRef.current = Math.max(savedSequenceRef.current, item.sequence); setDetail(current => current ? { ...current, version: { ...current.version, draft_revision: Number(result.draft_revision), subtotal: Number(result.subtotal), item_discount_amount: Number(result.item_discount_amount), net_subtotal: Number(result.net_subtotal), discount_amount: Number(result.discount_amount), total_value: Number(result.total_value), updated_at: result.updated_at } } : current); if (sequenceRef.current > item.sequence && editorRef.current) { pendingRef.current = { state: editorRef.current, sequence: sequenceRef.current }; continue; } setSaveStatus('saved'); } catch (error) { console.error('[proposals:autosave]', error); const message = proposalErrorMessage(error); setSaveMessage(message); setSaveStatus(/outro dispositivo/i.test(message) ? 'conflict' : 'error'); break; } } })().finally(() => { drainRef.current = null; }); return drainRef.current;
  }, [detail]);
  const flush = useCallback(async () => { if (!detail || !editorRef.current) return; if (sequenceRef.current <= savedSequenceRef.current) return; if (saveStatus === 'conflict') throw new Error('PROPOSAL_DRAFT_CONFLICT'); pendingRef.current = { state: editorRef.current, sequence: sequenceRef.current }; await runDrain(); if (sequenceRef.current > savedSequenceRef.current) throw new Error(saveMessage || 'PROPOSAL_SAVE_PENDING'); }, [detail, runDrain, saveMessage, saveStatus]);
  useEffect(() => { if (!detail || dirtySequence <= savedSequenceRef.current) return; const timer = window.setTimeout(() => { void flush(); }, 800); return () => window.clearTimeout(timer); }, [detail, dirtySequence, flush]);

  const totals = useMemo(() => { if (!editor) return null; try { return calculateProposalTotals(editor.items.map(item => ({ quantity: item.quantity || '1', offeredUnitPrice: item.offered_unit_price || '0', discountType: item.discount_type, discountValue: item.discount_value || '0' })), editor.discountType, editor.discountValue || '0'); } catch { return null; } }, [editor]);
  const back = async () => { try { await flush(); navigate(returnTo); } catch (error) { toast.error(proposalErrorMessage(error)); } };
  const addService = (serviceId: string) => { const service = servicos.find(item => item.id === serviceId); if (!service || !editor) return; updateEditor(current => ({ ...current, items: [...current.items, { key: crypto.randomUUID(), service_id: service.id, service_name_snapshot: service.name, description_snapshot: '', interval_note: '', payment_condition: '', quantity: '1', unit_label: 'procedimento', list_unit_price_snapshot: String(service.price ?? 0), offered_unit_price: String(service.price ?? 0), discount_type: 'none', discount_value: '0', sort_order: current.items.length }] })); setServiceSearch(''); };
  const updateItem = (key: string, patch: Partial<ProposalEditorItem>) => updateEditor(current => ({ ...current, items: current.items.map(item => item.key === key ? { ...item, ...patch } : item) }));
  const removeItem = (key: string) => updateEditor(current => ({ ...current, items: current.items.filter(item => item.key !== key) }));
  const moveItem = (key: string, delta: number) => updateEditor(current => { const index = current.items.findIndex(item => item.key === key); const target = index + delta; if (index < 0 || target < 0 || target >= current.items.length) return current; const items = [...current.items]; [items[index], items[target]] = [items[target], items[index]]; return { ...current, items }; });
  const handleSave = async () => { if (!detail || !editor) return; setBusyAction('save'); try { await flush(); if (advanceCrm) { await advanceProposalCrm(detail.proposal.id); toast.success('Proposta salva e movida para Proposta enviada no CRM.'); } else toast.success('Proposta salva.'); } catch (error) { toast.error(proposalErrorMessage(error)); } finally { setBusyAction(null); } };
  const handleDelete = async () => { if (!detail) return; const ok = await confirm({ title: 'Excluir proposta definitivamente?', message: 'Ela será removida da ficha da paciente. Esta ação não pode ser desfeita.', confirmLabel: 'Excluir proposta', cancelLabel: 'Cancelar', tone: 'warning' }); if (!ok) return; setBusyAction('delete'); try { await deleteProposal(detail.proposal.id); toast.success('Proposta excluída.'); navigate(returnTo, { replace: true }); } catch (error) { toast.error(proposalErrorMessage(error)); } finally { setBusyAction(null); } };

  if (loading) return <div className="full-loader">Carregando proposta...</div>;
  if (loadError || !detail || !editor || !context) return <div className="page"><div className="empty-state"><p>{loadError ?? 'Proposta não encontrada.'}</p><button className="btn btn--secondary btn--sm" onClick={() => navigate('/crm')}>Voltar</button></div></div>;
  const filteredServices = servicos.filter(service => service.active && (!serviceSearch.trim() || service.name.toLocaleLowerCase('pt-BR').includes(serviceSearch.trim().toLocaleLowerCase('pt-BR')))).slice(0, 10);
  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'pending' ? 'Alterações pendentes' : saveStatus === 'conflict' ? 'Conflito de edição' : saveStatus === 'error' ? 'Erro ao salvar' : 'Salvo';

  return <div className="proposal-root">
    <header className="proposal-header"><button className="icon-btn" onClick={() => void back()} aria-label="Voltar"><ArrowLeft size={19}/></button><div className="proposal-header-title"><strong>{editor.title}</strong><span>{context.contact_name} · registro comercial interno</span></div><span className={`proposal-save proposal-save--${saveStatus}`}>{saveStatus === 'saving' && <RefreshCw size={12} className="spin"/>}{saveLabel}</span><button className="btn btn--ghost btn--sm" onClick={() => void handleDelete()} disabled={Boolean(busyAction)}><Trash2 size={14}/> Excluir</button></header>
    {saveMessage && <div className="proposal-alert">{saveMessage}</div>}
    <main className="proposal-layout" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(260px,320px)', maxWidth: 1180, margin: '0 auto' }}>
      <section className="proposal-editor-pane">
        <div className="proposal-card proposal-title-card"><label className="field-label">Nome da proposta</label><input className="field-input" value={editor.title} onChange={event => updateEditor(current => ({ ...current, title: event.target.value }))}/><div className="proposal-recipient">Paciente: <strong>{context.contact_name}</strong></div></div>
        <div className="proposal-card"><div className="proposal-pane-title">Adicionar procedimento</div><div className="proposal-service-search"><Search size={16}/><input value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Buscar procedimento no catálogo"/></div>{serviceSearch && <div className="proposal-service-results">{filteredServices.map(service => <button key={service.id} onClick={() => addService(service.id)}><span>{service.name}</span><strong>{proposalMoney(service.price)}</strong><Plus size={15}/></button>)}</div>}</div>
        <div className="proposal-items">{editor.items.length === 0 ? <div className="proposal-empty"><FileText size={28}/><strong>Adicione os procedimentos oferecidos</strong><span>Isso registra o orçamento em análise; não significa venda.</span></div> : editor.items.map((item, index) => <article className="proposal-item-card" key={item.key}><div className="proposal-item-head"><strong>{item.service_name_snapshot}</strong><div className="proposal-item-actions"><button className="icon-btn" disabled={index===0} onClick={() => moveItem(item.key,-1)}><ArrowUp size={15}/></button><button className="icon-btn" disabled={index===editor.items.length-1} onClick={() => moveItem(item.key,1)}><ArrowDown size={15}/></button><button className="icon-btn" onClick={() => removeItem(item.key)}><Trash2 size={15}/></button></div></div><div style={{ display:'grid', gridTemplateColumns:'minmax(150px,.65fr) minmax(180px,1fr)', gap:10 }}><div><label className="field-label">Valor proposto</label><input className="field-input" inputMode="decimal" value={item.offered_unit_price} onChange={event => updateItem(item.key,{offered_unit_price:event.target.value,quantity:'1',discount_type:'none',discount_value:'0'})}/></div><div><label className="field-label">Condição de pagamento</label><input className="field-input" value={item.payment_condition} onChange={event => updateItem(item.key,{payment_condition:event.target.value})} placeholder="Ex.: PIX ou 10x"/></div></div><div style={{marginTop:10}}><label className="field-label">Observação</label><textarea className="field-input" rows={2} value={item.interval_note} onChange={event => updateItem(item.key,{interval_note:event.target.value})} placeholder="Detalhes opcionais"/></div></article>)}</div>
        <div className="proposal-card"><label className="field-label">Observação geral (opcional)</label><textarea className="field-input" rows={3} value={editor.customerNote} onChange={event => updateEditor(current => ({...current,customerNote:event.target.value}))} placeholder="Informações internas sobre este orçamento"/></div>
        <ProposalAttachments proposalId={detail.proposal.id}/>
      </section>
      <aside className="proposal-summary-pane"><div className="proposal-card proposal-summary-card"><div className="proposal-pane-title">Resumo</div><div className="proposal-grand-total"><span>Total oferecido</span><strong>{proposalMoney(centsToMoney(totals?.totalCents ?? 0))}</strong></div><div className="proposal-validity"><label className="field-label">Validade</label>{editor.validUntil ? <input className="field-input" type="date" value={editor.validUntil} onChange={event => updateEditor(current => ({...current,validUntil:event.target.value}))}/> : <div className="field-input" style={{ display:'flex', alignItems:'center', color:'var(--text-2)', background:'var(--bg-2)' }}>Sem prazo de validade</div>}<div className="proposal-shortcuts">{[7,15,30].map(days => <button key={days} onClick={() => updateEditor(current => ({...current,validUntil:addIsoDays(clinicDateIso(),days)}))}>{days} dias</button>)}<button onClick={() => updateEditor(current => ({...current,validUntil:''}))}>Sem validade</button></div></div><label style={{display:'flex',gap:10,alignItems:'flex-start',padding:'12px 0',cursor:'pointer'}}><input type="checkbox" checked={advanceCrm} onChange={event => setAdvanceCrm(event.target.checked)} style={{marginTop:2}}/><span><strong style={{display:'block',fontSize:12}}>Marcar como proposta enviada no CRM</strong><span className="page-sub">Ao salvar, move esta negociação para “Proposta enviada”. Depois você pode evoluir ou reabrir pelo CRM.</span></span></label><button className="btn btn--primary btn--md proposal-main-action" onClick={() => void handleSave()} disabled={Boolean(busyAction)||saveStatus==='conflict'}>{busyAction==='save'?'Salvando…':'Salvar proposta'}</button></div><div className="proposal-card proposal-readonly-note">Proposta = o que foi oferecido e ainda está em análise. O que a paciente realmente comprar deve ser registrado no Financeiro/Atendimento.</div></aside>
    </main>
  </div>;
}
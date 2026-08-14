import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  CalendarPlus,
  Check,
  ChevronRight,
  Clock,
  FilePlus2,
  FileText,
  MessageCircle,
  Phone,
  Plus,
  Search,
  StickyNote,
  UserPlus,
  X,
} from 'lucide-react';
import {
  useCrm,
  type CrmActivity,
  type CrmContactCandidate,
  type CrmFollowup,
  type CrmInterest,
  type CrmPatientCandidate,
  type CrmPipelineCard,
} from '../../hooks/useCrm';
import { createProposal, loadDealProposals } from '../../hooks/useProposals';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { supabase } from '../../lib/supabase';
import { buildWhatsAppUrl } from '../../lib/whatsapp';
import { clinicDateIso } from '../../lib/agendaTime';
import { PROPOSAL_STATUS_LABEL, proposalDate, proposalMoney, type ProposalEffectiveStatus, type ProposalSummary } from '../../lib/proposals';
import {
  CRM_CHANNEL_KEYS,
  CRM_CHANNEL_LABEL,
  CRM_LOSS_REASON_KEYS,
  CRM_LOSS_REASON_LABEL,
  CRM_OPEN_STAGES,
  CRM_SOURCE_KEYS,
  CRM_SOURCE_LABEL,
  CRM_STAGE_KEYS,
  CRM_STAGE_LABEL,
  createCrmIdempotencyKey,
  followupBucket,
  followupShortcut,
  formatCrmValue,
  type CrmChannel,
  type CrmLossReason,
  type CrmSource,
  type CrmStage,
  type FollowupBucket,
} from '../../lib/crm';
import type { Patient } from '../../types';
import './crm.css';

type PatientSeed = Pick<Patient, 'id' | 'name' | 'phone' | 'email'>;
type DetailData = { activities: CrmActivity[]; followups: CrmFollowup[] };
type LossRequest = { card: CrmPipelineCard };
type ProposalAwareCard = CrmPipelineCard & {
  proposal_id?: string | null;
  proposal_version_id?: string | null;
  proposal_title?: string | null;
  proposal_version_number?: number | null;
  proposal_status?: string | null;
  proposal_effective_status?: ProposalEffectiveStatus | null;
  proposal_total_value?: number | null;
  proposal_valid_until?: string | null;
  proposal_sent_at?: string | null;
};

const emptyOpportunity = () => ({
  title: '',
  value: '',
  expectedClose: '',
  note: '',
  interests: [] as CrmInterest[],
  interestServiceId: '',
  interestLabel: '',
});

function CrmCard({ card, onOpen, onMove }: { card: CrmPipelineCard; onOpen: () => void; onMove: (stage: CrmStage) => void }) {
  const bucket = followupBucket(card.next_followup_on);
  const value = formatCrmValue(card.estimated_value);
  const proposal = card as ProposalAwareCard;

  return (
    <div
      className={`crm-card${bucket === 'overdue' ? ' crm-card--overdue' : ''}`}
      draggable={CRM_OPEN_STAGES.includes(card.stage)}
      onDragStart={event => event.dataTransfer.setData('text/crm-deal', card.deal_id)}
    >
      <button type="button" onClick={onOpen} style={{ width: '100%', border: 0, padding: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}>
        <div className="crm-card-name"><span style={{ flex: 1 }}>{card.contact_name}</span><ChevronRight size={15} /></div>
        <div className="crm-card-title">{card.title}</div>
        {card.interests.length > 0 && <div className="crm-card-tags">
          {card.interests.slice(0, 3).map(item => <span className="crm-tag" key={item.id ?? item.label}>{item.label}</span>)}
          {card.interests.length > 3 && <span className="crm-tag">+{card.interests.length - 3}</span>}
        </div>}
        <div className="crm-card-meta">
          <span>{CRM_SOURCE_LABEL[card.source]}</span>
          {value && <strong>{value}</strong>}
          {card.patient_id && <span>Paciente vinculada</span>}
        </div>
        {proposal.proposal_id && <div style={{ marginTop: 7, display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: 'var(--text-2)', paddingTop: 7, borderTop: '1px solid var(--border)' }}>
          <span><FileText size={11} style={{ verticalAlign: -2, marginRight: 3 }} />Proposta v{proposal.proposal_version_number ?? '—'} · {proposal.proposal_effective_status ? PROPOSAL_STATUS_LABEL[proposal.proposal_effective_status] : '—'}</span>
          <strong>{proposalMoney(proposal.proposal_total_value)}</strong>
        </div>}
        {card.next_followup_on && <div className={`crm-followup${bucket ? ` crm-followup--${bucket}` : ''}`}>
          <Clock size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          {bucket === 'overdue' ? 'Atrasado · ' : bucket === 'today' ? 'Hoje · ' : 'Próximo · '}{card.next_followup_on.split('-').reverse().join('/')}
        </div>}
      </button>
      <select className="field-select" aria-label={`Mover oportunidade de ${card.contact_name}`} value={card.stage} onClick={event => event.stopPropagation()} onChange={event => onMove(event.target.value as CrmStage)} style={{ marginTop: 8, minHeight: 32, fontSize: 11 }}>
        {CRM_STAGE_KEYS.map(stage => <option value={stage} key={stage}>{CRM_STAGE_LABEL[stage]}</option>)}
      </select>
    </div>
  );
}

function LossModal({ request, onClose, onConfirm }: { request: LossRequest; onClose: () => void; onConfirm: (reason: CrmLossReason, detail: string) => Promise<void> }) {
  const [reason, setReason] = useState<CrmLossReason>('price');
  const [detail, setDetail] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason === 'other' && !detail.trim()) return;
    setSaving(true);
    try { await onConfirm(reason, detail); } finally { setSaving(false); }
  };
  return <div className="crm-modal-overlay"><form className="crm-modal" onSubmit={submit}>
    <div className="crm-modal-head"><div style={{ flex: 1 }}><strong>Marcar como perdido</strong><div className="page-sub">{request.card.contact_name}</div></div><button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button></div>
    <div className="crm-modal-body">
      <label className="field-label">Motivo da perda</label>
      <select className="field-select" value={reason} onChange={event => setReason(event.target.value as CrmLossReason)}>{CRM_LOSS_REASON_KEYS.map(key => <option value={key} key={key}>{CRM_LOSS_REASON_LABEL[key]}</option>)}</select>
      <label className="field-label" style={{ marginTop: 10 }}>Detalhe {reason === 'other' ? '(obrigatório)' : '(opcional)'}</label>
      <textarea className="field-input" rows={3} value={detail} onChange={event => setDetail(event.target.value)} placeholder="Contexto útil para entender a perda" />
      <div className="crm-form-actions"><button type="button" className="btn btn--ghost btn--md" onClick={onClose}>Cancelar</button><button className="btn btn--primary btn--md" disabled={saving || (reason === 'other' && !detail.trim())}>{saving ? 'Salvando…' : 'Confirmar perda'}</button></div>
    </div>
  </form></div>;
}

function NewLeadModal({ patient, onClose, crm }: { patient: PatientSeed | null; onClose: () => void; crm: ReturnType<typeof useCrm> }) {
  const { servicos } = useServicos();
  const { toast, confirm } = useToast();
  const [name, setName] = useState(patient?.name ?? '');
  const [phone, setPhone] = useState(patient?.phone ?? '');
  const [email, setEmail] = useState(patient?.email ?? '');
  const [source, setSource] = useState<CrmSource>(patient ? 'existing_patient' : 'whatsapp');
  const [sourceDetail, setSourceDetail] = useState('');
  const [form, setForm] = useState(emptyOpportunity);
  const [duplicates, setDuplicates] = useState<CrmContactCandidate[]>([]);
  const [saving, setSaving] = useState(false);
  const [idempotencyKey] = useState(createCrmIdempotencyKey);

  const dirty = Boolean((!patient && (name.trim() || phone?.trim() || email?.trim() || sourceDetail.trim())) || form.title.trim() || form.value || form.expectedClose || form.note.trim() || form.interests.length);
  const requestClose = async () => {
    if (!dirty) { onClose(); return; }
    const ok = await confirm({ title: 'Descartar alterações?', message: 'Os dados deste lead ainda não foram salvos.', confirmLabel: 'Descartar', cancelLabel: 'Continuar editando', tone: 'warning' });
    if (ok) onClose();
  };
  const addInterest = () => {
    const service = servicos.find(item => item.id === form.interestServiceId);
    const label = form.interestLabel.trim() || service?.name || '';
    if (!label) return;
    if (form.interests.some(item => item.service_id === (service?.id ?? null) && item.label.toLowerCase() === label.toLowerCase())) return;
    setForm(current => ({ ...current, value: current.value || (service && Number(service.price) > 0 ? String(service.price) : ''), interests: [...current.interests, { service_id: service?.id ?? null, label }], interestServiceId: '', interestLabel: '', title: current.title || label }));
  };
  const opportunityInput = () => ({
    title: form.title.trim() || (form.interests[0]?.label ?? `Oportunidade · ${name.trim()}`),
    value: form.value ? Number(form.value.replace(',', '.')) : null,
    expectedClose: form.expectedClose || null,
    interests: form.interests,
    note: form.note || null,
    idempotencyKey,
  });
  const createForExisting = async (contact: CrmContactCandidate) => {
    setSaving(true);
    try { await crm.createDeal(contact.id, opportunityInput()); toast.success(`Nova oportunidade criada para ${contact.name}.`); onClose(); }
    catch (error) { console.error('[crm:create-existing]', error); toast.error('Não foi possível criar a oportunidade.'); }
    finally { setSaving(false); }
  };
  const submit = async (forceNew = false) => {
    if (!patient && !name.trim()) { toast.error('Informe o nome do lead.'); return; }
    setSaving(true);
    try {
      if (patient) { await crm.createOpportunityForPatient(patient.id, opportunityInput()); toast.success('Oportunidade criada para a paciente.'); onClose(); return; }
      if (!forceNew) {
        const candidates = await crm.findContactCandidates(phone, email);
        if (candidates.length) { setDuplicates(candidates); return; }
      }
      await crm.createLead({ ...opportunityInput(), name, phone, email, source, sourceDetail });
      toast.success('Lead criado no CRM.'); onClose();
    } catch (error) { console.error('[crm:create-lead]', error); toast.error('Não foi possível criar o lead.'); }
    finally { setSaving(false); }
  };

  return <div className="crm-modal-overlay" onMouseDown={event => event.target === event.currentTarget && void requestClose()}><form className="crm-modal" onSubmit={event => { event.preventDefault(); void submit(false); }}>
    <div className="crm-modal-head"><div style={{ flex: 1 }}><strong>{patient ? 'Nova oportunidade' : 'Novo lead'}</strong><div className="page-sub">{patient ? `Paciente: ${patient.name}` : 'Contato + oportunidade em uma operação atômica'}</div></div><button type="button" className="icon-btn" onClick={() => void requestClose()}><X size={18} /></button></div>
    <div className="crm-modal-body"><div className="crm-form-grid">
      {!patient && <><div className="crm-form-span"><label className="field-label">Nome</label><input className="field-input" value={name} onChange={event => setName(event.target.value)} autoFocus /></div><div><label className="field-label">WhatsApp / telefone</label><input className="field-input" value={phone ?? ''} onChange={event => setPhone(event.target.value)} inputMode="tel" /></div><div><label className="field-label">Email</label><input className="field-input" value={email ?? ''} onChange={event => setEmail(event.target.value)} inputMode="email" /></div><div><label className="field-label">Origem</label><select className="field-select" value={source} onChange={event => setSource(event.target.value as CrmSource)}>{CRM_SOURCE_KEYS.map(key => <option value={key} key={key}>{CRM_SOURCE_LABEL[key]}</option>)}</select></div><div><label className="field-label">Detalhe da origem</label><input className="field-input" value={sourceDetail} onChange={event => setSourceDetail(event.target.value)} placeholder="Ex.: Maria / Dia das Mães" /></div></>}
      <div className="crm-form-span"><label className="field-label">Interesses</label><div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) auto', gap: 6 }}><select className="field-select" value={form.interestServiceId} onChange={event => setForm(current => ({ ...current, interestServiceId: event.target.value }))}><option value="">Serviço cadastrado</option>{servicos.filter(item => item.active).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input className="field-input" value={form.interestLabel} onChange={event => setForm(current => ({ ...current, interestLabel: event.target.value }))} placeholder="ou interesse livre" /><button type="button" className="btn btn--secondary btn--sm" onClick={addInterest}>Adicionar</button></div>{form.interests.length > 0 && <div className="crm-card-tags">{form.interests.map((item, index) => <button className="crm-tag" type="button" key={`${item.service_id}-${item.label}-${index}`} onClick={() => setForm(current => ({ ...current, interests: current.interests.filter((_, itemIndex) => itemIndex !== index) }))}>{item.label} ×</button>)}</div>}</div>
      <div className="crm-form-span"><label className="field-label">Título da oportunidade</label><input className="field-input" value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Ex.: Botox Full Face" /></div>
      <div><label className="field-label">Valor estimado</label><input className="field-input" value={form.value} onChange={event => setForm(current => ({ ...current, value: event.target.value }))} inputMode="decimal" placeholder="Opcional" /></div>
      <div><label className="field-label">Previsão de fechamento</label><input className="field-input" type="date" value={form.expectedClose} onChange={event => setForm(current => ({ ...current, expectedClose: event.target.value }))} /></div>
      <div className="crm-form-span"><label className="field-label">Nota inicial</label><textarea className="field-input" rows={2} value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="Opcional" /></div>
    </div>
    {duplicates.length > 0 && <div className="crm-duplicate"><strong>Já existe contato com estes dados.</strong><div className="page-sub" style={{ marginTop: 3 }}>Prefira criar uma nova oportunidade. Nenhum vínculo foi feito automaticamente.</div>{duplicates.map(candidate => <div key={candidate.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><div style={{ flex: 1 }}><strong>{candidate.name}</strong><div className="page-sub">{candidate.phone || candidate.email || 'Sem contato'}</div></div><button type="button" className="btn btn--secondary btn--sm" disabled={saving} onClick={() => void createForExisting(candidate)}>Nova oportunidade</button></div>)}<button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} disabled={saving} onClick={() => void submit(true)}>Criar novo contato mesmo assim</button></div>}
    <div className="crm-form-actions"><button type="button" className="btn btn--ghost btn--md" onClick={() => void requestClose()}>Cancelar</button><button className="btn btn--primary btn--md" disabled={saving}>{saving ? 'Salvando…' : patient ? 'Criar oportunidade' : 'Criar lead'}</button></div>
    </div>
  </form></div>;
}

function DetailDrawer({ card, crm, onClose, onStage }: { card: CrmPipelineCard; crm: ReturnType<typeof useCrm>; onClose: () => void; onStage: (stage: CrmStage) => void }) {
  const navigate = useNavigate();
  const { toast, confirm } = useToast();
  const [detail, setDetail] = useState<DetailData>({ activities: [], followups: [] });
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactChannel, setContactChannel] = useState<CrmChannel>('whatsapp');
  const [contactNote, setContactNote] = useState('');
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupDate, setFollowupDate] = useState(followupShortcut(1));
  const [followupChannel, setFollowupChannel] = useState<CrmChannel>('whatsapp');
  const [followupNote, setFollowupNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [candidates, setCandidates] = useState<CrmPatientCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [detailRows, proposalRows] = await Promise.all([crm.loadDetail(card.deal_id), loadDealProposals(card.deal_id)]);
      setDetail(detailRows);
      setProposals(proposalRows);
    } catch (error) { console.error('[crm:detail]', error); toast.error('Não foi possível carregar os detalhes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [card.deal_id]);

  const openWhatsapp = () => {
    if (!card.phone) return;
    window.open(buildWhatsAppUrl(card.phone, `Olá ${card.contact_name}!`), '_blank', 'noopener,noreferrer');
    void crm.logWhatsappOpened(card).then(reload);
  };
  const registerContact = async () => {
    setBusy(true);
    try { await crm.recordContact(card, contactChannel, contactNote); setContactOpen(false); setContactNote(''); await reload(); toast.success('Contato registrado.'); }
    catch { toast.error('Não foi possível registrar o contato.'); }
    finally { setBusy(false); }
  };
  const createFollowup = async () => {
    setBusy(true);
    try { await crm.addFollowup(card.deal_id, followupDate, followupChannel, followupNote); setFollowupOpen(false); setFollowupNote(''); await reload(); toast.success('Follow-up criado.'); }
    catch { toast.error('Não foi possível criar o follow-up.'); }
    finally { setBusy(false); }
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await crm.addNote(card, note); setNote(''); setNoteOpen(false); await reload(); toast.success('Nota registrada.'); }
    catch { toast.error('Não foi possível salvar a nota.'); }
    finally { setBusy(false); }
  };
  const startConversion = async () => {
    if (card.patient_id) return;
    setBusy(true);
    try {
      const rows = await crm.findPatientCandidates(card.contact_id);
      if (rows.length) { setCandidates(rows); return; }
      const ok = await confirm({ title: 'Converter em paciente', message: `Nenhum cadastro semelhante foi encontrado. Criar uma nova paciente para ${card.contact_name}?`, confirmLabel: 'Criar paciente', cancelLabel: 'Cancelar' });
      if (!ok) return;
      await crm.convertContact(card.contact_id); toast.success('Paciente criada e vinculada.'); onClose();
    } catch (error) { console.error('[crm:convert]', error); toast.error('Não foi possível converter o contato.'); }
    finally { setBusy(false); }
  };
  const linkPatient = async (patientId: string) => {
    setBusy(true);
    try { await crm.convertContact(card.contact_id, patientId); toast.success('Paciente vinculada ao contato.'); setCandidates(null); onClose(); }
    catch { toast.error('Não foi possível vincular a paciente.'); }
    finally { setBusy(false); }
  };
  const createSeparatePatient = async () => {
    const ok = await confirm({ title: 'Criar nova paciente', message: 'Existe possível cadastro semelhante. Confirma que deseja criar uma nova paciente mesmo assim?', confirmLabel: 'Criar nova', cancelLabel: 'Cancelar', tone: 'warning' });
    if (!ok) return;
    setBusy(true);
    try { await crm.convertContact(card.contact_id); toast.success('Nova paciente criada e vinculada.'); onClose(); }
    catch { toast.error('Não foi possível criar a paciente.'); }
    finally { setBusy(false); }
  };
  const schedule = async () => {
    if (!card.patient_id) { toast.error('Para agendar, vincule ou crie a paciente primeiro.'); await startConversion(); return; }
    navigate(`/agenda?patient_id=${card.patient_id}`, { state: { patient: { id: card.patient_id, name: card.patient_name ?? card.contact_name, phone: card.phone }, from: '/crm' } });
  };
  const createTreatmentProposal = async () => {
    setBusy(true);
    try {
      const created = await createProposal(card.deal_id, card.title);
      navigate(`/crm/deals/${card.deal_id}/proposals/${created.proposal_id}`);
    } catch (error) { console.error('[crm:proposal-create]', error); toast.error('Não foi possível criar a proposta.'); }
    finally { setBusy(false); }
  };
  const activityLabel = (activity: CrmActivity) => {
    const type = activity.activity_type as string;
    if (type === 'stage_changed') { const from = activity.from_stage ? CRM_STAGE_LABEL[activity.from_stage] : 'Criada'; const to = activity.to_stage ? CRM_STAGE_LABEL[activity.to_stage] : ''; return `${from} → ${to}`; }
    if (type === 'contact') return `Contato · ${activity.channel ? CRM_CHANNEL_LABEL[activity.channel] : 'Outro'}`;
    if (type === 'whatsapp_opened') return 'WhatsApp aberto';
    if (type === 'followup_created') return 'Follow-up criado';
    if (type === 'followup_completed') return 'Follow-up concluído';
    if (type === 'followup_cancelled') return 'Follow-up cancelado';
    if (type === 'patient_linked') return 'Paciente vinculada';
    if (type === 'proposal_created') return 'Proposta criada';
    if (type === 'proposal_issued') return 'Proposta emitida';
    if (type === 'proposal_sent') return 'Proposta enviada';
    if (type === 'proposal_accepted') return 'Proposta aceita';
    if (type === 'proposal_declined') return 'Proposta recusada';
    if (type === 'proposal_revised') return 'Nova versão da proposta';
    if (type === 'proposal_voided') return 'Proposta anulada';
    return 'Nota';
  };
  const estimatedValue = formatCrmValue(card.estimated_value);

  return <div className="drawer-overlay" onClick={onClose}><aside className="drawer crm-drawer" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
    <div className="drawer-header"><button className="drawer-back" onClick={onClose}><X size={18} /></button><div style={{ flex: 1, minWidth: 0 }}><div className="drawer-title">{card.contact_name}</div><div className="drawer-sub">{card.title} · {CRM_STAGE_LABEL[card.stage]}</div></div></div>
    <div className="crm-detail-hero">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2)' }}>{card.phone && <span><Phone size={12} style={{ verticalAlign: -2 }} /> {card.phone}</span>}{card.email && <span>{card.email}</span>}<span>{CRM_SOURCE_LABEL[card.source]}{card.source_detail ? ` · ${card.source_detail}` : ''}</span>{estimatedValue && <strong>{estimatedValue}</strong>}</div>
      <div className="crm-card-tags">{card.interests.map(item => <span className="crm-tag" key={item.id ?? item.label}>{item.label}</span>)}</div>
      <div className="crm-detail-actions">
        <button className="btn btn--secondary btn--sm" disabled={!card.phone} onClick={openWhatsapp}><MessageCircle size={15} /> WhatsApp</button>
        <button className="btn btn--secondary btn--sm" onClick={() => setContactOpen(value => !value)}><Phone size={15} /> Registrar contato</button>
        <button className="btn btn--secondary btn--sm" onClick={() => setFollowupOpen(value => !value)}><Clock size={15} /> Follow-up</button>
        <button className="btn btn--secondary btn--sm" onClick={() => setNoteOpen(value => !value)}><StickyNote size={15} /> Nota</button>
        <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void createTreatmentProposal()}><FilePlus2 size={15} /> Criar proposta</button>
        <button className="btn btn--secondary btn--sm" onClick={() => void schedule()}><CalendarPlus size={15} /> Agendar</button>
        {!card.patient_id && <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void startConversion()}><UserPlus size={15} /> Converter/Vincular</button>}
        {card.patient_id && <span className="badge badge--green">Paciente vinculada</span>}
      </div>
      <div style={{ marginTop: 9, display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}><label className="field-label" style={{ margin: 0 }}>Mover para</label><select className="field-select" style={{ width: 'auto', minWidth: 150 }} value={card.stage} onChange={event => onStage(event.target.value as CrmStage)}>{CRM_STAGE_KEYS.map(stage => <option value={stage} key={stage}>{CRM_STAGE_LABEL[stage]}</option>)}</select></div>
      {contactOpen && <div className="crm-inline-form"><select className="field-select" value={contactChannel} onChange={event => setContactChannel(event.target.value as CrmChannel)}>{CRM_CHANNEL_KEYS.map(key => <option value={key} key={key}>{CRM_CHANNEL_LABEL[key]}</option>)}</select><textarea className="field-input" rows={2} value={contactNote} onChange={event => setContactNote(event.target.value)} placeholder="O que foi conversado?" /><button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void registerContact()}>Registrar contato</button></div>}
      {followupOpen && <div className="crm-inline-form"><div className="crm-stage-segments"><button className="btn btn--ghost btn--sm" onClick={() => setFollowupDate(clinicDateIso())}>Hoje</button><button className="btn btn--ghost btn--sm" onClick={() => setFollowupDate(followupShortcut(1))}>Amanhã</button><button className="btn btn--ghost btn--sm" onClick={() => setFollowupDate(followupShortcut(3))}>3 dias</button><button className="btn btn--ghost btn--sm" onClick={() => setFollowupDate(followupShortcut(7))}>7 dias</button></div><input className="field-input" type="date" value={followupDate} onChange={event => setFollowupDate(event.target.value)} /><select className="field-select" value={followupChannel} onChange={event => setFollowupChannel(event.target.value as CrmChannel)}>{CRM_CHANNEL_KEYS.map(key => <option value={key} key={key}>{CRM_CHANNEL_LABEL[key]}</option>)}</select><textarea className="field-input" rows={2} value={followupNote} onChange={event => setFollowupNote(event.target.value)} placeholder="Lembrete comercial" /><button className="btn btn--primary btn--sm" disabled={busy || !followupDate} onClick={() => void createFollowup()}>Criar follow-up</button></div>}
      {noteOpen && <div className="crm-inline-form"><textarea className="field-input" rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Nota comercial" /><button className="btn btn--primary btn--sm" disabled={busy || !note.trim()} onClick={() => void saveNote()}>Salvar nota</button></div>}
      {candidates && <div className="crm-duplicate"><strong>Encontramos possível cadastro existente.</strong><div className="page-sub">Telefone/email são apenas sinais. Escolha manualmente.</div>{candidates.map(candidate => <div key={candidate.patient_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}><div style={{ flex: 1 }}><strong>{candidate.name}</strong><div className="page-sub">{candidate.phone || candidate.email || 'Sem contato'} · coincide: {candidate.matched_by.join(' + ')}</div></div><button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void linkPatient(candidate.patient_id)}>Vincular esta paciente</button></div>)}<button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => void createSeparatePatient()}>Criar nova paciente</button></div>}
    </div>
    <div className="drawer-body">
      <section className="crm-section" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="crm-section-title" style={{ flex: 1, margin: 0 }}>Propostas</div><button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void createTreatmentProposal()}><Plus size={13} /> Nova proposta</button></div>
        {loading ? <div className="page-sub" style={{ marginTop: 8 }}>Carregando…</div> : proposals.length === 0 ? <div className="page-sub" style={{ marginTop: 8 }}>Nenhuma proposta nesta oportunidade.</div> : <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{proposals.map(proposal => <button key={proposal.proposal_id} type="button" onClick={() => navigate(`/crm/deals/${card.deal_id}/proposals/${proposal.proposal_id}`)} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, textAlign: 'left', alignItems: 'center', padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)', color: 'inherit', cursor: 'pointer' }}><span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proposal.title}</strong><small className="page-sub">Versão {proposal.version_number} · {PROPOSAL_STATUS_LABEL[proposal.effective_status]}{proposal.valid_until ? ` · validade ${proposalDate(proposal.valid_until)}` : ''}</small></span><strong style={{ fontSize: 12 }}>{proposalMoney(proposal.total_value)}</strong></button>)}</div>}
      </section>
      <div className="crm-detail-grid">
        <section className="crm-section"><div className="crm-section-title">Timeline comercial</div>{loading ? <div className="page-sub">Carregando…</div> : detail.activities.length === 0 ? <div className="page-sub">Sem atividades registradas.</div> : <div className="crm-timeline">{detail.activities.map(activity => <div className="crm-activity" key={activity.id}><strong style={{ fontSize: 12 }}>{activityLabel(activity)}</strong>{activity.note && <div style={{ fontSize: 12, marginTop: 2 }}>{activity.note}</div>}<div className="crm-activity-time">{new Date(activity.occurred_at).toLocaleString('pt-BR')}</div></div>)}</div>}</section>
        <section className="crm-section"><div className="crm-section-title">Follow-ups</div>{detail.followups.length === 0 ? <div className="page-sub">Nenhum follow-up.</div> : detail.followups.map(item => <div className="crm-followup-row" key={item.id}><div style={{ display: 'flex', gap: 7, alignItems: 'center' }}><strong style={{ flex: 1 }}>{item.due_on.split('-').reverse().join('/')}</strong><span className="badge">{item.status === 'open' ? 'Aberto' : item.status === 'completed' ? 'Concluído' : 'Cancelado'}</span></div>{item.note && <div style={{ fontSize: 12 }}>{item.note}</div>}{item.status === 'open' && <div style={{ display: 'flex', gap: 6 }}><button className="btn btn--secondary btn--sm" onClick={() => void crm.completeFollowup(item.id).then(reload)}><Check size={13} /> Concluir</button><button className="btn btn--ghost btn--sm" onClick={() => void crm.cancelFollowup(item.id).then(reload)}>Cancelar</button></div>}</div>)}</section>
      </div>
      <button className="btn btn--ghost btn--sm" style={{ marginTop: 12 }} onClick={async () => { const ok = await confirm({ title: 'Arquivar contato', message: 'O histórico comercial será preservado e o contato sairá do pipeline.', confirmLabel: 'Arquivar', cancelLabel: 'Cancelar', tone: 'warning' }); if (ok) { await crm.archiveContact(card.contact_id); onClose(); } }}><Archive size={14} /> Arquivar contato</button>
    </div>
  </aside></div>;
}

export function CrmPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { servicos } = useServicos();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<CrmStage | 'all'>('all');
  const [source, setSource] = useState<CrmSource | 'all'>('all');
  const [attention, setAttention] = useState<FollowupBucket | 'all'>('all');
  const [serviceId, setServiceId] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<CrmPipelineCard | null>(null);
  const [lossRequest, setLossRequest] = useState<LossRequest | null>(null);
  const [patientSeed, setPatientSeed] = useState<PatientSeed | null>(null);
  const patientId = new URLSearchParams(location.search).get('patient_id');
  const crm = useCrm({ search, stage, source, attention, serviceId: serviceId || null });
  const today = clinicDateIso();

  useEffect(() => {
    if (!patientId) { setPatientSeed(null); return; }
    let alive = true;
    void supabase.from('patients').select('id,name,phone,email').eq('id', patientId).maybeSingle().then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) { toast.error('Paciente não encontrada para criar oportunidade.'); return; }
      setPatientSeed(data as PatientSeed); setNewOpen(true);
    });
    return () => { alive = false; };
  }, [patientId, toast]);

  const boardStages: CrmStage[] = stage === 'all' ? CRM_OPEN_STAGES : [stage];
  const attentionCounts = useMemo(() => ({ overdue: crm.cards.filter(card => card.next_followup_on && card.next_followup_on < today).length, today: crm.cards.filter(card => card.next_followup_on === today).length, upcoming: crm.cards.filter(card => card.next_followup_on && card.next_followup_on > today).length }), [crm.cards, today]);
  const requestMove = async (card: CrmPipelineCard, target: CrmStage) => {
    if (target === card.stage) return;
    if (target === 'lost') { setLossRequest({ card }); return; }
    try { await crm.moveStage(card.deal_id, target); if (selected?.deal_id === card.deal_id) setSelected({ ...card, stage: target }); toast.success(`Movido para ${CRM_STAGE_LABEL[target]}.`); }
    catch { toast.error('Não foi possível mover a oportunidade.'); }
  };
  const dropInto = async (event: DragEvent<HTMLDivElement>, target: CrmStage) => { event.preventDefault(); const dealId = event.dataTransfer.getData('text/crm-deal'); const card = crm.cards.find(item => item.deal_id === dealId); if (card) await requestMove(card, target); };
  const mobileCards = stage === 'all' ? crm.cards.filter(card => CRM_OPEN_STAGES.includes(card.stage)) : crm.cards;

  return <div className="page crm-page">
    <div className="page-header"><div><h1 className="page-title">CRM</h1><p className="page-sub">Leads, oportunidades e follow-ups comerciais</p></div><button className="btn btn--primary btn--md" onClick={() => { setPatientSeed(null); navigate('/crm', { replace: true }); setNewOpen(true); }}><Plus size={16} /> Novo lead</button></div>
    <div className="crm-metrics"><div className="card crm-metric"><strong>{crm.cards.filter(card => card.stage === 'new').length}</strong><span className="page-sub">Novos no pipeline</span></div><div className="card crm-metric"><strong>{crm.metrics.overdue}</strong><span className="page-sub">Follow-ups atrasados</span></div><div className="card crm-metric"><strong>{crm.metrics.open}</strong><span className="page-sub">Oportunidades abertas</span></div><div className="card crm-metric"><strong>{formatCrmValue(crm.metrics.openValue) ?? '—'}</strong><span className="page-sub">Valor estimado em aberto</span></div></div>
    <div className="card crm-attention"><span className="crm-attention-label"><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Precisa de atenção</span><button className={`btn btn--sm ${attention === 'overdue' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAttention(attention === 'overdue' ? 'all' : 'overdue')}>Atrasados {attentionCounts.overdue}</button><button className={`btn btn--sm ${attention === 'today' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAttention(attention === 'today' ? 'all' : 'today')}>Hoje {attentionCounts.today}</button><button className={`btn btn--sm ${attention === 'upcoming' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAttention(attention === 'upcoming' ? 'all' : 'upcoming')}>Próximos {attentionCounts.upcoming}</button></div>
    <div className="card" style={{ padding: 10, marginBottom: 10 }}><div className="crm-toolbar"><div className="crm-search" style={{ position: 'relative', flex: 1, minWidth: 200 }}><Search size={15} style={{ position: 'absolute', left: 11, top: 11 }} /><input className="field-input" style={{ paddingLeft: 33 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar nome, telefone ou email" /></div><select className="field-select" value={stage} onChange={event => setStage(event.target.value as CrmStage | 'all')}><option value="all">Todos os estágios</option>{CRM_STAGE_KEYS.map(key => <option value={key} key={key}>{CRM_STAGE_LABEL[key]}</option>)}</select><select className="field-select" value={source} onChange={event => setSource(event.target.value as CrmSource | 'all')}><option value="all">Todas as origens</option>{CRM_SOURCE_KEYS.map(key => <option value={key} key={key}>{CRM_SOURCE_LABEL[key]}</option>)}</select><select className="field-select" value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Todos os interesses</option>{servicos.filter(item => item.active).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div></div>
    <div className="crm-stage-segments" style={{ marginBottom: 9 }}>{CRM_STAGE_KEYS.map(key => <button key={key} className={`btn btn--sm ${stage === key ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setStage(stage === key ? 'all' : key)}>{CRM_STAGE_LABEL[key]}</button>)}</div>
    {crm.loading ? <div className="card" style={{ padding: 16 }}>Carregando CRM…</div> : crm.error ? <div className="empty-state"><p>{crm.error}</p><button className="btn btn--secondary btn--sm" onClick={() => void crm.refresh()}>Tentar novamente</button></div> : <><div className="crm-board">{boardStages.map(columnStage => { const items = crm.cards.filter(card => card.stage === columnStage); return <div className="crm-column" key={columnStage} onDragOver={event => event.preventDefault()} onDrop={event => void dropInto(event, columnStage)}><div className="crm-column-head"><span className="crm-column-title">{CRM_STAGE_LABEL[columnStage]}</span><span className="crm-column-count">{items.length}</span></div>{items.length === 0 ? <div className="crm-empty-column">Nenhuma oportunidade</div> : items.map(card => <CrmCard key={card.deal_id} card={card} onOpen={() => setSelected(card)} onMove={target => void requestMove(card, target)} />)}</div>; })}</div><div className="crm-mobile-list">{mobileCards.length === 0 ? <div className="empty-state">Nenhuma oportunidade neste filtro.</div> : mobileCards.map(card => <CrmCard key={card.deal_id} card={card} onOpen={() => setSelected(card)} onMove={target => void requestMove(card, target)} />)}</div></>}
    {newOpen && <NewLeadModal patient={patientSeed} crm={crm} onClose={() => { setNewOpen(false); if (patientId) navigate('/crm', { replace: true }); }} />}
    {selected && <DetailDrawer card={selected} crm={crm} onClose={() => { setSelected(null); void crm.refresh(); }} onStage={target => void requestMove(selected, target)} />}
    {lossRequest && <LossModal request={lossRequest} onClose={() => setLossRequest(null)} onConfirm={async (reason, detail) => { try { await crm.moveStage(lossRequest.card.deal_id, 'lost', { reason, detail }); setLossRequest(null); setSelected(null); toast.success('Oportunidade marcada como perdida.'); } catch { toast.error('Não foi possível registrar a perda.'); } }} />}
  </div>;
}

import { useEffect, useState } from 'react';
import { BellRing, CalendarPlus, MessageCircle, X } from 'lucide-react';
import type { AgendaAppointment } from '../../hooks/useAgenda';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import {
  dismissPatientWaitlist,
  getAgendaAppointmentForRecovery,
  getPatientWaitlist,
  listWaitlistCandidates,
  loadRecoveryCommunicationSettings,
  recordWaitlistManualContact,
  savePatientWaitlist,
  type WaitlistCandidate,
  type WaitlistEntry,
  type WaitlistPeriod,
} from '../../hooks/useAgendaRecovery';
import {
  DEFAULT_COMMUNICATION_TEMPLATES,
  firstName,
  formatCommunicationDate,
  formatCommunicationTime,
  renderCommunicationTemplate,
} from '../../lib/communications';
import { buildSafeWhatsAppUrl, whatsappRecipientDigits } from '../../lib/whatsapp';
import { clinicDateLabel, clinicTime } from '../../lib/agendaTime';

const WEEKDAYS = [
  { value: 1, label: 'Seg' }, { value: 2, label: 'Ter' }, { value: 3, label: 'Qua' }, { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' }, { value: 6, label: 'Sáb' }, { value: 7, label: 'Dom' },
];

const PERIOD_LABEL: Record<WaitlistPeriod, string> = { morning: 'Manhã', afternoon: 'Tarde', evening: 'Noite' };

export function WaitlistEditor({ patient, sourceAppointment, onClose, onSaved }: {
  patient: { id: string; name: string; phone?: string | null };
  sourceAppointment?: AgendaAppointment | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { servicos } = useServicos();
  const { toast, confirm } = useToast();
  const [entry, setEntry] = useState<WaitlistEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serviceId, setServiceId] = useState(sourceAppointment?.service_id ?? '');
  const [period, setPeriod] = useState<WaitlistPeriod | ''>('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [expiresOn, setExpiresOn] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getPatientWaitlist(patient.id).then(value => {
      if (!alive) return;
      setEntry(value);
      if (value?.status === 'active') {
        setServiceId(value.service_id ?? sourceAppointment?.service_id ?? '');
        setPeriod(value.preferred_period ?? '');
        setWeekdays(value.preferred_weekdays ?? []);
        setExpiresOn(value.expires_on ?? '');
        setNotes(value.notes ?? '');
      }
    }).catch(error => {
      if (alive) toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a lista.');
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [patient.id, sourceAppointment?.service_id, toast]);

  const sourceId = sourceAppointment?.id ?? (entry?.status === 'active' ? entry.source_appointment_id : null);
  const toggleWeekday = (value: number) => setWeekdays(current => current.includes(value) ? current.filter(day => day !== value) : [...current, value].sort());

  const save = async () => {
    setSaving(true);
    try {
      await savePatientWaitlist({
        patientId: patient.id,
        serviceId: serviceId || null,
        sourceAppointmentId: sourceId,
        preferredPeriod: period || null,
        preferredWeekdays: weekdays,
        expiresOn: expiresOn || null,
        notes,
      });
      toast.success(entry?.status === 'active' ? 'Lista de encaixe atualizada.' : 'Paciente adicionada à lista de encaixe.');
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally { setSaving(false); }
  };

  const dismiss = async () => {
    if (!entry || entry.status !== 'active') return;
    const ok = await confirm({ title: 'Retirar da lista de encaixe?', message: `${patient.name} deixará de aparecer como possível encaixe. O histórico será preservado.`, confirmLabel: 'Retirar', cancelLabel: 'Voltar', tone: 'warning' });
    if (!ok) return;
    setSaving(true);
    try { await dismissPatientWaitlist(entry.id); toast.success('Retirada da lista de encaixe.'); onSaved?.(); onClose(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível retirar.'); }
    finally { setSaving(false); }
  };

  return <div className="drawer-overlay" onClick={onClose}>
    <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="waitlist-editor-title" onClick={event => event.stopPropagation()}>
      <div className="drawer-header"><div><span className="page-sub">Lista de encaixe</span><h2 id="waitlist-editor-title" className="drawer-title">{patient.name}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Fechar" disabled={saving}><X size={20}/></button></div>
      <div className="drawer-body">
        {loading ? <div className="loading-state">Carregando...</div> : <div style={{ display: 'grid', gap: 14 }}>
          {sourceAppointment && <div className="card" style={{ padding: 12 }}><div className="page-sub">Quer antecipar este horário</div><strong>{clinicDateLabel(sourceAppointment.scheduled_at, { day: '2-digit', month: 'long' })} · {clinicTime(sourceAppointment.scheduled_at)}</strong></div>}
          <label><span className="field-label">Serviço</span><select className="field-input" value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Qualquer atendimento</option>{servicos.filter(service => service.active || service.id === serviceId).map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label><span className="field-label">Período</span><select className="field-input" value={period} onChange={event => setPeriod(event.target.value as WaitlistPeriod | '')}><option value="">Qualquer período</option><option value="morning">Manhã</option><option value="afternoon">Tarde</option><option value="evening">Noite</option></select></label>
          <div><span className="field-label">Dias da semana <span className="page-sub">(opcional)</span></span><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{WEEKDAYS.map(day => <button key={day.value} type="button" className={weekdays.includes(day.value) ? 'btn btn--primary btn--sm' : 'btn btn--secondary btn--sm'} style={{ minHeight: 44, minWidth: 48 }} onClick={() => toggleWeekday(day.value)}>{day.label}</button>)}</div></div>
          <label><span className="field-label">Até <span className="page-sub">(opcional)</span></span><input className="field-input" type="date" value={expiresOn} onChange={event => setExpiresOn(event.target.value)} /></label>
          <label><span className="field-label">Observação <span className="page-sub">(opcional)</span></span><textarea className="field-input" rows={3} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ex.: consegue vir com 1h de aviso" /></label>
        </div>}
      </div>
      <div className="drawer-footer" style={{ flexWrap: 'wrap' }}>{entry?.status === 'active' && <button className="btn btn--ghost btn--md" onClick={() => void dismiss()} disabled={saving}>Retirar da lista</button>}<button className="btn-secondary" onClick={onClose} disabled={saving}>Fechar</button><button className="btn-primary" onClick={() => void save()} disabled={loading || saving}>{saving ? 'Salvando...' : entry?.status === 'active' ? 'Salvar alterações' : 'Adicionar à lista'}</button></div>
    </div>
  </div>;
}

export function PatientWaitlistCard({ patient }: { patient: { id: string; name: string; phone?: string | null } }) {
  const [entry, setEntry] = useState<WaitlistEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try { setEntry(await getPatientWaitlist(patient.id)); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getPatientWaitlist(patient.id).then(value => { if (alive) setEntry(value); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [patient.id]);

  const active = entry?.status === 'active';
  return <>
    <section className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><BellRing size={16}/><strong>Lista de encaixe</strong>{active && <span className="badge badge--green">Ativa</span>}{entry?.status === 'expired' && <span className="badge badge--amber">Vencida</span>}</div>{loading ? <div className="page-sub">Carregando...</div> : active ? <div className="page-sub" style={{ marginTop: 4 }}>{entry.service_name ?? 'Qualquer atendimento'}{entry.preferred_period ? ` · ${PERIOD_LABEL[entry.preferred_period]}` : ' · qualquer período'}{entry.source_scheduled_at ? ` · quer antecipar ${formatCommunicationDate(entry.source_scheduled_at)}` : ''}</div> : <div className="page-sub" style={{ marginTop: 4 }}>Não está aguardando antecipação.</div>}</div>
        <button type="button" className="btn btn--secondary btn--sm" style={{ minHeight: 44 }} onClick={() => setEditing(true)} disabled={loading}>{active ? 'Editar' : 'Adicionar'}</button>
      </div>
    </section>
    {editing && <WaitlistEditor patient={patient} onClose={() => setEditing(false)} onSaved={() => void refresh()} />}
  </>;
}

export function WaitlistCandidatesDrawer({ slot, onSchedule, onClose }: {
  slot: AgendaAppointment;
  onSchedule: (candidate: WaitlistCandidate, sourceAppointment: AgendaAppointment | null) => void;
  onClose: () => void;
}) {
  const { toast, confirm } = useToast();
  const [items, setItems] = useState<WaitlistCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [compose, setCompose] = useState<WaitlistCandidate | null>(null);
  const [body, setBody] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordKey, setRecordKey] = useState('');
  const [settings, setSettings] = useState<{ templateBody: string | null; clinicName: string }>({ templateBody: null, clinicName: '' });

  const reload = async () => {
    setLoading(true);
    try { setItems(await listWaitlistCandidates(slot)); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível buscar encaixes.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void listWaitlistCandidates(slot).then(value => { if (alive) setItems(value); }).catch(error => {
      if (alive) toast.error(error instanceof Error ? error.message : 'Não foi possível buscar encaixes.');
    }).finally(() => { if (alive) setLoading(false); });
    void loadRecoveryCommunicationSettings().then(value => { if (alive) setSettings(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [slot, toast]);

  const openComposer = (candidate: WaitlistCandidate) => {
    const template = settings.templateBody || DEFAULT_COMMUNICATION_TEMPLATES.waitlist_slot;
    setBody(renderCommunicationTemplate(template, {
      first_name: firstName(candidate.patient_name), name: candidate.patient_name,
      date: formatCommunicationDate(slot.scheduled_at), time: formatCommunicationTime(slot.scheduled_at),
      clinic_name: settings.clinicName, proposal_title: '', valid_until: '', package_title: '', remaining_credits: '', aftercare_instructions: '',
    }));
    setRecordKey(crypto.randomUUID());
    setCompose(candidate);
  };

  const schedule = async (candidate: WaitlistCandidate) => {
    setSchedulingId(candidate.entry_id);
    try {
      const source = candidate.source_appointment_id ? await getAgendaAppointmentForRecovery(candidate.source_appointment_id) : null;
      onSchedule(candidate, source);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível abrir o agendamento.'); }
    finally { setSchedulingId(null); }
  };

  const dismiss = async (candidate: WaitlistCandidate) => {
    const ok = await confirm({ title: 'Não chamar esta paciente?', message: `${candidate.patient_name} será retirada da lista de encaixe. O histórico será preservado.`, confirmLabel: 'Retirar', cancelLabel: 'Voltar', tone: 'warning' });
    if (!ok) return;
    try { await dismissPatientWaitlist(candidate.entry_id); toast.success('Paciente retirada da lista.'); await reload(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível retirar.'); }
  };

  const openWhatsApp = () => {
    if (!compose) return;
    const url = buildSafeWhatsAppUrl(compose.phone, body);
    if (!url) { toast.error('Telefone inválido para WhatsApp.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const register = async () => {
    if (!compose) return;
    const recipient = whatsappRecipientDigits(compose.phone);
    if (!recipient) { toast.error('Telefone inválido.'); return; }
    setRecording(true);
    try {
      await recordWaitlistManualContact({ entryId: compose.entry_id, slotAt: slot.scheduled_at, recipient, body, idempotencyKey: recordKey });
      toast.success('Contato registrado.');
      setCompose(null);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Não foi possível registrar.'); }
    finally { setRecording(false); }
  };

  return <>
    <div className="drawer-overlay" onClick={onClose}><div className="drawer" role="dialog" aria-modal="true" aria-labelledby="waitlist-candidates-title" onClick={event => event.stopPropagation()}>
      <div className="drawer-header"><div><span className="page-sub">Horário disponível</span><h2 id="waitlist-candidates-title" className="drawer-title">Possíveis encaixes</h2><p className="page-sub">{clinicDateLabel(slot.scheduled_at, { day: '2-digit', month: 'long' })} · {clinicTime(slot.scheduled_at)}</p></div><button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={20}/></button></div>
      <div className="drawer-body">
        {loading ? <div className="loading-state">Buscando compatibilidades...</div> : items.length === 0 ? <div className="card" style={{ padding: 18, textAlign: 'center' }}><BellRing size={24}/><strong style={{ display: 'block', marginTop: 7 }}>Nenhum encaixe compatível agora</strong><p className="page-sub">O horário continua livre na Agenda. Preferências de serviço, período, dia e janela são respeitadas.</p></div> : <div style={{ display: 'grid', gap: 10 }}>{items.map(candidate => <article key={candidate.entry_id} className="card" style={{ padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}><div><strong>{candidate.patient_name}</strong><div className="page-sub">{candidate.service_name ?? 'Qualquer atendimento'}{candidate.preferred_period ? ` · prefere ${PERIOD_LABEL[candidate.preferred_period].toLowerCase()}` : ' · horário flexível'}</div>{candidate.source_scheduled_at && <div className="page-sub">Já está agendada para {formatCommunicationDate(candidate.source_scheduled_at)}</div>}{candidate.notes && <div style={{ fontSize: 12.5, marginTop: 5 }}>{candidate.notes}</div>}</div></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}><button className="btn btn--primary btn--sm" style={{ minHeight: 44 }} disabled={!candidate.phone} onClick={() => openComposer(candidate)}><MessageCircle size={15}/> WhatsApp</button><button className="btn btn--secondary btn--sm" style={{ minHeight: 44 }} onClick={() => void schedule(candidate)} disabled={schedulingId === candidate.entry_id}><CalendarPlus size={15}/> {schedulingId === candidate.entry_id ? 'Abrindo...' : 'Agendar aqui'}</button><button className="btn btn--ghost btn--sm" style={{ minHeight: 44 }} onClick={() => void dismiss(candidate)}>Não chamar</button></div>
        </article>)}</div>}
      </div>
      <div className="drawer-footer"><button className="btn-secondary" onClick={onClose}>Fechar</button></div>
    </div></div>
    {compose && <div className="drawer-overlay" style={{ zIndex: 1200 }} onClick={() => !recording && setCompose(null)}><div className="drawer" role="dialog" aria-modal="true" aria-label="Mensagem de encaixe" onClick={event => event.stopPropagation()}>
      <div className="drawer-header"><div><span className="page-sub">Avisar sobre o horário</span><h3 className="drawer-title">{compose.patient_name}</h3></div><button className="icon-btn" onClick={() => setCompose(null)} disabled={recording} aria-label="Fechar"><X size={18}/></button></div>
      <div className="drawer-body"><p className="page-sub" style={{ marginBottom: 10 }}>Abrir o WhatsApp <strong>não</strong> registra envio. O Hub só registra depois da sua confirmação.</p><textarea className="field-input" rows={7} maxLength={12000} value={body} onChange={event => setBody(event.target.value)} aria-label="Mensagem" /></div>
      <div className="drawer-footer" style={{ flexWrap: 'wrap' }}><button className="btn-secondary" onClick={() => setCompose(null)} disabled={recording}>Voltar</button><button className="btn-primary" onClick={openWhatsApp} disabled={!whatsappRecipientDigits(compose.phone)}>Abrir WhatsApp</button><button className="btn-secondary" onClick={() => void register()} disabled={recording || !body.trim()}>{recording ? 'Registrando...' : 'Registrar contato'}</button></div>
    </div></div>}
  </>;
}

import { useEffect, useMemo, useState } from 'react';
import { Search, WalletCards, X } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { usePatientEntitlements } from '../../hooks/usePackages';
import { useToast } from '../../hooks/useToast';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard';
import type { AgendaAppointment, AgendaInput } from '../../hooks/useAgenda';
import type { Patient } from '../../types';
import { clinicDateIso, clinicLocalToIso, clinicTime, displayEndTime } from '../../lib/agendaTime';

type ConflictFinder = (scheduledAt: string, durationMinutes: number, ignoreId?: string) => Promise<{ scheduled_at: string } | null>;
type PatientSeed = Pick<Patient, 'id' | 'name' | 'phone'>;

export function AgendaFormDrawer({ initialDate, initialTime, initialPatientId, initialPatient, initialServiceId, initialDuration, appointment, findConflict, onCreate, onUpdate, onClose }: {
  initialDate: string;
  initialTime: string;
  initialPatientId?: string | null;
  initialPatient?: PatientSeed | null;
  initialServiceId?: string | null;
  initialDuration?: number | null;
  appointment: AgendaAppointment | null;
  findConflict: ConflictFinder;
  onCreate: (input: AgendaInput) => Promise<AgendaAppointment>;
  onUpdate: (id: string, input: Partial<AgendaInput>) => Promise<AgendaAppointment>;
  onClose: () => void;
}) {
  const { toast, confirm } = useToast();
  const { servicos } = useServicos();
  const [patientSearch, setPatientSearch] = useState('');
  const { pacientes, nextPage, hasMore } = usePacientes({ pageSize: 50, search: patientSearch });
  const [date, setDate] = useState(appointment ? clinicDateIso(appointment.scheduled_at) : initialDate);
  const [time, setTime] = useState(appointment ? clinicTime(appointment.scheduled_at) : initialTime);
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? initialPatientId ?? initialPatient?.id ?? '');
  const [serviceId, setServiceId] = useState(appointment?.service_id ?? initialServiceId ?? '');
  const [duration, setDuration] = useState(appointment?.duration_minutes ?? appointment?.service?.duration_minutes ?? initialDuration ?? 60);
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const entitlementServiceIds = useMemo(() => serviceId ? [serviceId] : [], [serviceId]);
  const { data: entitlements, loading: creditsLoading } = usePatientEntitlements(patientId || null, entitlementServiceIds);
  const compatibleCredits = entitlements.filter(item => item.service_id === serviceId && item.effective_status === 'active' && item.available_balance > 0);
  const totalAvailableCredits = compatibleCredits.reduce((sum, item) => sum + item.available_balance, 0);
  useDirtyFormGuard(`agenda-form-${appointment?.id ?? 'new'}`, dirty && !saving);

  useEffect(() => {
    if (appointment || initialDuration || !initialServiceId || serviceId !== initialServiceId) return;
    const service = servicos.find(item => item.id === initialServiceId);
    if (service?.duration_minutes && service.duration_minutes > 0) setDuration(service.duration_minutes);
  }, [appointment, initialDuration, initialServiceId, serviceId, servicos]);

  const selectedPatient = pacientes.find(item => item.id === patientId)
    ?? (appointment?.patient_id === patientId ? appointment.patient : undefined)
    ?? (initialPatient?.id === patientId ? initialPatient : undefined);
  const patientOptions = selectedPatient && !pacientes.some(item => item.id === selectedPatient.id) ? [selectedPatient, ...pacientes] : pacientes;

  const requestClose = async () => {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({ title: 'Descartar alterações?', message: 'Este agendamento possui alterações que ainda não foram salvas.', confirmLabel: 'Descartar', cancelLabel: 'Continuar editando', tone: 'warning' });
      if (!ok) return;
    }
    setDirty(false);
    onClose();
  };

  const selectService = (id: string) => {
    setDirty(true);
    setServiceId(id);
    const service = servicos.find(item => item.id === id);
    setDuration(service?.duration_minutes && service.duration_minutes > 0 ? service.duration_minutes : 60);
  };

  const submit = async () => {
    if (!patientId) { setError('Selecione a paciente.'); return; }
    if (!Number.isFinite(duration) || duration <= 0) { setError('Informe uma duração válida.'); return; }
    setSaving(true);
    setError('');
    try {
      const scheduledAt = clinicLocalToIso(date, time);
      const conflict = await findConflict(scheduledAt, duration, appointment?.id);
      if (conflict) { setError('Esse horário acabou de ser ocupado. Escolha outro horário.'); return; }
      const input: AgendaInput = { patient_id: patientId, service_id: serviceId || null, scheduled_at: scheduledAt, duration_minutes: duration, notes: notes.trim() || null };
      if (appointment) await onUpdate(appointment.id, input); else await onCreate(input);
      setDirty(false);
      toast.success(appointment ? 'Agendamento atualizado.' : 'Consulta agendada.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally { setSaving(false); }
  };

  let endTime = '--:--';
  try { endTime = displayEndTime(clinicLocalToIso(date, time), duration || 0); } catch { /* placeholder */ }

  return <div className="drawer-overlay" onClick={() => void requestClose()}><div className="drawer" role="dialog" aria-modal="true" aria-labelledby="agenda-form-title" onClick={event => event.stopPropagation()}>
    <div className="drawer-header"><div><h2 id="agenda-form-title" className="drawer-title">{appointment ? 'Reagendar / editar' : 'Nova consulta'}</h2><p className="page-sub">Horário da clínica · São Paulo</p></div><button className="icon-btn" onClick={() => void requestClose()} disabled={saving} aria-label="Fechar"><X size={20} /></button></div>
    <div className="drawer-body">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><div><label className="field-label">Data</label><input className="field-input" type="date" value={date} onChange={event => { setDirty(true); setDate(event.target.value); }} /></div><div><label className="field-label">Hora</label><input className="field-input" type="time" step="900" value={time} onChange={event => { setDirty(true); setTime(event.target.value); }} /></div></div>
      <label className="field-label">Paciente *</label><div style={{ position: 'relative', marginBottom: 8 }}><Search size={15} style={{ position: 'absolute', left: 11, top: 13, color: 'var(--text-3)' }} /><input className="field-input" style={{ paddingLeft: 34 }} value={patientSearch} onChange={event => setPatientSearch(event.target.value)} placeholder="Buscar por nome ou telefone" /></div>
      <select className="field-input" value={patientId} onChange={event => { setDirty(true); setPatientId(event.target.value); }}><option value="">Selecionar paciente...</option>{patientOptions.map(patient => <option key={patient.id} value={patient.id}>{patient.name}{patient.phone ? ` — ${patient.phone}` : ''}</option>)}</select>{hasMore && <button className="btn btn--ghost btn--sm" type="button" onClick={nextPage} style={{ marginTop: 7 }}>Carregar mais</button>}
      <label className="field-label">Serviço</label><select className="field-input" value={serviceId} onChange={event => selectService(event.target.value)}><option value="">Consulta / a definir</option>{servicos.filter(service => service.active || service.id === serviceId).map(service => <option key={service.id} value={service.id}>{service.name}{service.duration_minutes ? ` · ${service.duration_minutes} min` : ''}</option>)}</select>
      {patientId && serviceId && (creditsLoading || totalAvailableCredits > 0) && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8, padding: '9px 10px', borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}><WalletCards size={15} style={{ marginTop: 1, flexShrink: 0 }} /><div style={{ fontSize: 12.5 }}>{creditsLoading ? 'Verificando créditos da paciente…' : <><strong>Paciente possui {totalAvailableCredits.toLocaleString('pt-BR')} crédito{totalAvailableCredits === 1 ? '' : 's'} disponível{totalAvailableCredits === 1 ? '' : 'is'}.</strong><div style={{ opacity: .8, marginTop: 2 }}>O agendamento não consome crédito. A escolha acontece somente no Registrar.</div></>}</div></div>}
      <label className="field-label">Duração deste agendamento</label><div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}><input className="field-input" type="number" min="5" max="1440" step="5" value={duration} onChange={event => { setDirty(true); setDuration(Number(event.target.value)); }} /><span style={{ fontSize: 13, color: 'var(--text-2)', minWidth: 95 }}>{time} → {endTime}</span></div>{serviceId && !servicos.find(service => service.id === serviceId)?.duration_minutes && <p className="page-sub" style={{ marginTop: 5 }}>Serviço sem duração padrão: usando 60 min como fallback explícito.</p>}
      <label className="field-label">Observação</label><textarea className="field-input" rows={3} value={notes} onChange={event => { setDirty(true); setNotes(event.target.value); }} placeholder="Observação deste agendamento (opcional)" />{error && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</p>}
    </div>
    <div className="drawer-footer"><button className="btn-secondary" onClick={() => void requestClose()} disabled={saving}>Fechar</button><button className="btn-primary" onClick={() => void submit()} disabled={saving}>{saving ? 'Salvando...' : appointment ? 'Salvar alterações' : 'Agendar'}</button></div>
  </div></div>;
}

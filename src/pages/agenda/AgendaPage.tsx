import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Clock, User, ChevronRight, Calendar, MessageCircle, Pencil, Search } from 'lucide-react';
import { format, addDays, isSameDay, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAgenda } from '../../hooks/useAgenda';
import { useServicos } from '../../hooks/useServicos';
import { usePacientes } from '../../hooks/usePacientes';
import { useRetornos } from '../../hooks/useRetornos';
import { usePatientNotes } from '../../hooks/usePatientNotes';
import { useToast } from '../../hooks/useToast';
import { Skeleton } from '../../components/ui/Skeleton';
import type { RetornoInfo } from '../../hooks/useRetornos';
import type { Appointment, AppointmentStatus, PatientNote } from '../../types';
import { buildWhatsAppUrl, whatsAppConfirmacao, whatsAppStatusConfirmado, whatsAppLembrete, whatsAppReagendamento } from '../../lib/whatsapp';

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
};

const STATUS_STYLE: Record<AppointmentStatus, React.CSSProperties> = {
  pendente: { background: '#fef3c7', color: '#b45309' },
  confirmado: { background: '#dbeafe', color: '#1d4ed8' },
  realizado: { background: '#dcfce7', color: '#15803d' },
  cancelado: { background: '#fee2e2', color: '#b91c1c' },
};

const STATUS_BAR: Record<AppointmentStatus, string> = {
  pendente: '#d97706',
  confirmado: '#3b82f6',
  realizado: '#16a34a',
  cancelado: '#ef4444',
};

function buildDays(anchor: Date): Date[] {
  return Array.from({ length: 14 }, (_, i) => addDays(startOfDay(anchor), i - 3));
}

type AppointmentInput = Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'google_event_id' | 'patient' | 'service'>;

function NovoAgendamentoModal({
  initialDate,
  appointment,
  onSave,
  onCancelAppointment,
  findConflict,
  onClose,
}: {
  initialDate: Date;
  appointment: Appointment | null;
  onSave: (data: AppointmentInput) => Promise<unknown>;
  onCancelAppointment: () => Promise<void>;
  findConflict: (scheduledAt: string, durationMinutes: number, ignoreId?: string) => Promise<{ scheduled_at: string; patient?: { name: string } | null } | null>;
  onClose: () => void;
}) {
  const [patientSearch, setPatientSearch] = useState('');
  const { pacientes, nextPage, hasMore } = usePacientes({ pageSize: 50, search: patientSearch });
  const { servicos } = useServicos();
  const { toast, confirm } = useToast();
  const editing = appointment !== null;
  const baseDate = appointment ? new Date(appointment.scheduled_at) : initialDate;
  const [date, setDate] = useState(format(baseDate, 'yyyy-MM-dd'));
  const [time, setTime] = useState(format(baseDate, 'HH:mm'));
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? '');
  const [serviceId, setServiceId] = useState(appointment?.service_id ?? '');
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? 'pendente');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedWaUrl, setSavedWaUrl] = useState<string | null>(null);
  const [waLabel, setWaLabel] = useState('Enviar confirmacao WhatsApp');

  const selectedService = servicos.find(service => service.id === serviceId);
  const selectedPatient = pacientes.find(p => p.id === patientId)
    ?? (appointment?.patient_id === patientId ? appointment.patient : undefined);
  const patientOptions = selectedPatient && !pacientes.some(p => p.id === selectedPatient.id)
    ? [selectedPatient, ...pacientes]
    : pacientes;

  const handleSubmit = async () => {
    if (!patientId) { setError('Selecione a paciente'); return; }
    const scheduled_at = new Date(`${date}T${time}:00`).toISOString();
    setSaving(true);
    setError('');
    try {
      const duration = selectedService?.duration_minutes ?? 60;
      const conflict = await findConflict(scheduled_at, duration, appointment?.id);
      if (conflict) {
        const conflictTime = format(new Date(conflict.scheduled_at), 'HH:mm');
        const shouldContinue = await confirm({
          title: 'Conflito de horario',
          message: `Atencao: existe outro agendamento as ${conflictTime} para ${conflict.patient?.name ?? 'paciente'}. Deseja continuar?`,
          confirmLabel: 'Continuar',
          cancelLabel: 'Revisar',
          tone: 'warning',
        });
        if (!shouldContinue) return;
      }

      await onSave({
        patient_id: patientId,
        service_id: serviceId || null,
        scheduled_at,
        status,
        notes: notes.trim() || null,
      });
      const serviceName = selectedService?.name ?? 'Consulta';
      if (selectedPatient?.phone) {
        const msg = editing
          ? whatsAppReagendamento(selectedPatient.name, scheduled_at, serviceName)
          : whatsAppConfirmacao(selectedPatient.name, scheduled_at, serviceName);
        setSavedWaUrl(buildWhatsAppUrl(selectedPatient.phone, msg));
        setWaLabel(editing ? 'Enviar reagendamento WhatsApp' : 'Enviar confirmacao WhatsApp');
      } else {
        toast.success(editing ? 'Agendamento atualizado.' : 'Agendamento criado.');
        onClose();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelAppointment = async () => {
    const ok = await confirm({
      title: 'Cancelar agendamento',
      message: 'Deseja marcar este agendamento como cancelado?',
      confirmLabel: 'Cancelar agendamento',
      tone: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await onCancelAppointment();
      toast.info('Agendamento cancelado.');
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="novo-agendamento-title" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 className="drawer-title" id="novo-agendamento-title">{editing ? 'Editar agendamento' : 'Novo agendamento'}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar agendamento"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div>
              <label className="field-label">Data</label>
              <input className="field-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Horario</label>
              <input className="field-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          <label className="field-label">Paciente *</label>
          <input
            className="field-input"
            value={patientSearch}
            onChange={event => setPatientSearch(event.target.value)}
            placeholder="Buscar paciente..."
            aria-label="Buscar paciente"
            style={{ marginBottom: 8 }}
          />
          <select className="field-input" value={patientId} onChange={e => setPatientId(e.target.value)}>
            <option value="">Selecionar paciente...</option>
            {patientOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {hasMore && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={nextPage} style={{ marginTop: 8 }}>
              Carregar mais pacientes
            </button>
          )}

          <label className="field-label">Servico</label>
          <select className="field-input" value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">Nenhum / a definir</option>
            {servicos.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <label className="field-label">Status</label>
          <select className="field-input" value={status} onChange={e => setStatus(e.target.value as AppointmentStatus)}>
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>

          <label className="field-label">Observacoes</label>
          <textarea className="field-input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anotacoes sobre o agendamento..." />

          {error && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
        </div>
        <div className="drawer-footer">
          {savedWaUrl ? (
            <>
              <button className="btn-secondary" onClick={onClose}>Fechar</button>
              <a href={savedWaUrl} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
                <MessageCircle size={16} /> {waLabel}
              </a>
            </>
          ) : (
            <>
              {editing && (
                <button className="btn btn--danger btn--md" type="button" onClick={handleCancelAppointment} disabled={saving}>
                  Cancelar agendamento
                </button>
              )}
              <button className="btn-secondary" onClick={onClose}>Fechar</button>
              <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Salvando...' : editing ? 'Salvar alteracoes' : 'Agendar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AppointmentCard({ apt, onOpenPatient, onEdit }: { apt: Appointment; onOpenPatient: (apt: Appointment) => void; onEdit: (apt: Appointment) => void }) {
  const timeStr = format(new Date(apt.scheduled_at), 'HH:mm');

  return (
    <div className="card" style={{ borderLeft: `4px solid ${STATUS_BAR[apt.status]}`, cursor: 'pointer', padding: '12px 14px' }} onClick={() => onOpenPatient(apt)} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpenPatient(apt); }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ textAlign: 'center', minWidth: '44px', flexShrink: 0 }}>
          <p style={{ fontWeight: 700, fontSize: '16px', color: 'var(--primary)', lineHeight: 1 }}>{timeStr}</p>
          {apt.service?.duration_minutes && <p style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '2px' }}>{apt.service.duration_minutes}min</p>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{apt.patient?.name ?? '-'}</p>
          {apt.service && <p style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{apt.service.name}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ ...STATUS_STYLE[apt.status], padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>{STATUS_LABEL[apt.status]}</span>
          <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={event => { event.stopPropagation(); onEdit(apt); }} aria-label="Editar agendamento">
            <Pencil size={15} />
          </button>
          {apt.status === 'confirmado' && apt.patient?.phone && (
            <a href={buildWhatsAppUrl(apt.patient.phone, whatsAppStatusConfirmado(apt.patient.name, apt.scheduled_at))} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} aria-label="Enviar WhatsApp de confirmacao" style={{ display: 'flex', alignItems: 'center', color: '#16a34a', flexShrink: 0 }}>
              <MessageCircle size={18} />
            </a>
          )}
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </div>
      </div>
    </div>
  );
}

function DateStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const today = startOfDay(new Date());
  const days = buildDays(today);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stripRef.current) return;
    const idx = days.findIndex(d => isSameDay(d, selected));
    const el = stripRef.current.children[idx] as HTMLElement;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [days, selected]);

  return (
    <div ref={stripRef} style={{ display: 'flex', gap: '6px', overflowX: 'auto', padding: '12px 16px', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'], borderBottom: '1px solid var(--border)' }}>
      {days.map(day => {
        const isSelected = isSameDay(day, selected);
        const isToday = isSameDay(day, today);
        return (
          <button key={day.toISOString()} onClick={() => onSelect(day)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', minWidth: '52px', padding: '10px 6px', borderRadius: '14px', border: 'none', cursor: 'pointer', flexShrink: 0, background: isSelected ? 'var(--primary)' : isToday ? 'var(--bg-2)' : 'transparent', color: isSelected ? '#fff' : isToday ? 'var(--primary)' : 'var(--text-2)', fontWeight: isSelected || isToday ? 700 : 400, transition: 'background 0.15s' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{format(day, 'EEE', { locale: ptBR })}</span>
            <span style={{ fontSize: '20px', lineHeight: 1 }}>{format(day, 'd')}</span>
            {isToday && !isSelected && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--primary)', display: 'block' }} />}
          </button>
        );
      })}
    </div>
  );
}

const RETORNO_LABEL_COLOR: Record<string, string> = { overdue: '#dc2626', in_window: '#16a34a', upcoming: '#d97706' };

function RetornosSection({ retornos }: { retornos: RetornoInfo[] }) {
  const navigate = useNavigate();
  const urgent = retornos.filter(r => r.status === 'overdue' || r.status === 'in_window' || r.status === 'upcoming');
  const hasOverdue = urgent.some(r => r.status === 'overdue');
  const [open, setOpen] = useState(hasOverdue);

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg-2)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>Retornos</span>
        <span style={{ background: hasOverdue ? '#fee2e2' : '#fef3c7', color: hasOverdue ? '#dc2626' : '#d97706', borderRadius: 999, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 700 }}>{urgent.length}</span>
        <ChevronRight size={14} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 16px 10px' }}>
          {urgent.map(r => (
            <div key={r.patientId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{r.patientName}</div>
                <div style={{ fontSize: '0.75rem', color: RETORNO_LABEL_COLOR[r.status] }}>{r.daysLabel}</div>
              </div>
              <button onClick={() => navigate(`/pacientes?patient_id=${r.patientId}`)} style={{ padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}>
                Ver ficha
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LembretesSection({ agendamentos }: { agendamentos: Appointment[] }) {
  const [open, setOpen] = useState(false);
  if (agendamentos.length === 0) return null;

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg-2)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>Lembretes de amanha</span>
        <span style={{ background: '#dbeafe', color: '#1d4ed8', borderRadius: 999, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 700 }}>{agendamentos.length}</span>
        <ChevronRight size={14} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && <div style={{ padding: '0 16px 10px' }}>{agendamentos.map(apt => {
        const hora = format(new Date(apt.scheduled_at), 'HH:mm');
        const waUrl = apt.patient?.phone ? buildWhatsAppUrl(apt.patient.phone, whatsAppLembrete(apt.patient.name, apt.scheduled_at, apt.service?.name ?? 'Consulta')) : null;
        return (
          <div key={apt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{apt.patient?.name ?? '-'}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{hora}{apt.service ? ` · ${apt.service.name}` : ''}</div>
            </div>
            {waUrl && <a href={waUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0, textDecoration: 'none' }}><MessageCircle size={14} /> Lembrete</a>}
          </div>
        );
      })}</div>}
    </div>
  );
}

function PatientNotesSection({ notes }: { notes: PatientNote[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(notes.length > 0);
  if (notes.length === 0) return null;

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(value => !value)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fffbf0', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>Lembretes do dia</span>
        <span style={{ background: '#fef3c7', color: 'var(--amber)', borderRadius: 999, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 700 }}>{notes.length}</span>
        <ChevronRight size={14} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div style={{ padding: '0 16px 10px' }}>
          {notes.map(note => (
            <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fff', border: '1px solid #fde68a', borderRadius: 'var(--radius)', marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text)' }}>{note.patient?.name ?? 'Paciente'}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note.content}</div>
              </div>
              <button onClick={() => navigate(`/pacientes?patient_id=${note.patient_id}`)} className="btn btn--secondary btn--sm">Ver ficha</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgendaSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 3 }, (_, index) => (
        <div className="card" key={index} style={{ padding: '12px 14px' }}>
          <Skeleton lines={2} height={14} />
        </div>
      ))}
    </div>
  );
}

export function AgendaPage() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const [tomorrow] = useState(() => startOfDay(addDays(new Date(), 1)));
  const { agendamentos, loading, error, create, update, findConflict } = useAgenda(selectedDate);
  const { agendamentos: lembretes } = useAgenda(tomorrow);
  const { notes: patientNotes } = usePatientNotes({ remindAt: selectedDate });
  const [showModal, setShowModal] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [search, setSearch] = useState('');
  const { servicos } = useServicos();
  const { retornos } = useRetornos(servicos);
  const hasUrgentRetornos = retornos.some(r => r.status === 'overdue' || r.status === 'in_window' || r.status === 'upcoming');

  const filteredAgendamentos = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return agendamentos;
    return agendamentos.filter(apt => apt.patient?.name.toLowerCase().includes(term));
  }, [agendamentos, search]);

  const handleOpenPatient = (apt: Appointment) => {
    navigate(`/pacientes?patient_id=${apt.patient_id}&appointment_id=${apt.id}`, {
      state: { patientId: apt.patient_id, appointmentId: apt.id, serviceId: apt.service_id },
    });
  };

  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    setSearch('');
  };

  const openCreate = () => {
    setEditingAppointment(null);
    setShowModal(true);
  };

  const openEdit = (apt: Appointment) => {
    setEditingAppointment(apt);
    setShowModal(true);
  };

  const dateLabel = isSameDay(selectedDate, startOfDay(new Date()))
    ? 'Hoje'
    : format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR });

  const uniquePatients = new Set(filteredAgendamentos.map(a => a.patient_id)).size;
  const searchActive = search.trim().length > 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agenda</h1>
          <p className="page-sub" style={{ textTransform: 'capitalize' }}>{dateLabel}</p>
        </div>
      </div>

      {hasUrgentRetornos && <RetornosSection retornos={retornos} />}
      <PatientNotesSection notes={patientNotes} />
      <DateStrip selected={selectedDate} onSelect={handleSelectDate} />
      <LembretesSection agendamentos={lembretes} />

      <div style={{ padding: '16px' }}>
        <div className="search-wrap" style={{ marginBottom: 12 }}>
          <Search size={18} className="search-icon" />
          <input className="search-input" placeholder="Buscar paciente no dia..." value={search} onChange={event => setSearch(event.target.value)} />
        </div>

        {error ? (
          <div className="empty-state"><p>{error}</p></div>
        ) : loading ? (
          <AgendaSkeleton />
        ) : agendamentos.length === 0 ? (
          <div className="empty-state">
            <Calendar size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
            <p>Nenhum agendamento para este dia.</p>
            <button className="btn-primary" onClick={openCreate}>Agendar consulta</button>
          </div>
        ) : filteredAgendamentos.length === 0 ? (
          <div className="empty-state"><p>Nenhum agendamento encontrado para "{search}".</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredAgendamentos.map(apt => <AppointmentCard key={apt.id} apt={apt} onOpenPatient={handleOpenPatient} onEdit={openEdit} />)}
          </div>
        )}
      </div>

      <button onClick={openCreate} aria-label="Novo agendamento" className="fab"><Plus size={26} /></button>

      {filteredAgendamentos.length > 0 && (
        <div style={{ position: 'sticky', bottom: 'var(--tab-h)', background: 'var(--bg-2)', borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-2)', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={13} /> {filteredAgendamentos.length} agendamento{filteredAgendamentos.length !== 1 ? 's' : ''}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><User size={13} /> {uniquePatients} paciente{uniquePatients !== 1 ? 's' : ''}</span>
          {searchActive && <span>{filteredAgendamentos.length} de {agendamentos.length} resultados</span>}
        </div>
      )}

      {showModal && (
        <NovoAgendamentoModal
          initialDate={selectedDate}
          appointment={editingAppointment}
          onSave={editingAppointment ? data => update(editingAppointment.id, data) : create}
          onCancelAppointment={() => editingAppointment ? update(editingAppointment.id, { status: 'cancelado' }) : Promise.resolve()}
          findConflict={findConflict}
          onClose={() => { setShowModal(false); setEditingAppointment(null); }}
        />
      )}
    </div>
  );
}

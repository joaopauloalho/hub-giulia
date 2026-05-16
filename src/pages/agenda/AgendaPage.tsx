import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Clock, User, ChevronRight, Calendar } from 'lucide-react';
import { format, addDays, isSameDay, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAgenda } from '../../hooks/useAgenda';
import { useServicos } from '../../hooks/useServicos';
import { usePacientes } from '../../hooks/usePacientes';
import type { Appointment, AppointmentStatus } from '../../types';

// ─── Status display ───────────────────────────────────────────
const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pendente:   'Pendente',
  confirmado: 'Confirmado',
  realizado:  'Realizado',
  cancelado:  'Cancelado',
};

const STATUS_STYLE: Record<AppointmentStatus, React.CSSProperties> = {
  pendente:   { background: '#fef3c7', color: '#b45309' },
  confirmado: { background: '#dbeafe', color: '#1d4ed8' },
  realizado:  { background: '#dcfce7', color: '#15803d' },
  cancelado:  { background: '#fee2e2', color: '#b91c1c' },
};

const STATUS_BAR: Record<AppointmentStatus, string> = {
  pendente:   '#d97706',
  confirmado: '#3b82f6',
  realizado:  '#16a34a',
  cancelado:  '#ef4444',
};

// ─── Build 14-day strip ───────────────────────────────────────
function buildDays(anchor: Date): Date[] {
  return Array.from({ length: 14 }, (_, i) => addDays(startOfDay(anchor), i - 3));
}

// ─── New Appointment Modal ────────────────────────────────────
function NovoAgendamentoModal({
  initialDate,
  onSave,
  onClose,
}: {
  initialDate: Date;
  onSave: (data: Omit<Appointment, 'id' | 'user_id' | 'created_at' | 'patient' | 'service'>) => Promise<unknown>;
  onClose: () => void;
}) {
  const { pacientes } = usePacientes();
  const { servicos } = useServicos();

  const dateStr = format(initialDate, 'yyyy-MM-dd');
  const [date, setDate] = useState(dateStr);
  const [time, setTime] = useState('09:00');
  const [patientId, setPatientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [status, setStatus] = useState<AppointmentStatus>('pendente');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!patientId) { setError('Selecione a paciente'); return; }
    const scheduled_at = new Date(`${date}T${time}:00`).toISOString();
    setSaving(true);
    try {
      await onSave({
        patient_id: patientId,
        service_id: serviceId || null,
        scheduled_at,
        status,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="novo-agendamento-title" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <h2 className="drawer-title" id="novo-agendamento-title">Novo agendamento</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar agendamento"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div>
              <label className="field-label">Data</label>
              <input className="field-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Horário</label>
              <input className="field-input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          <label className="field-label">Paciente *</label>
          <select className="field-input" value={patientId} onChange={e => setPatientId(e.target.value)}>
            <option value="">Selecionar paciente...</option>
            {pacientes.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <label className="field-label">Serviço</label>
          <select className="field-input" value={serviceId} onChange={e => setServiceId(e.target.value)}>
            <option value="">Nenhum / a definir</option>
            {servicos.filter(s => s.active).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <label className="field-label">Status</label>
          <select className="field-input" value={status} onChange={e => setStatus(e.target.value as AppointmentStatus)}>
            {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>

          <label className="field-label">Observações</label>
          <textarea
            className="field-input"
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anotações sobre o agendamento..."
          />

          {error && <p style={{ color: 'var(--red)', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
        </div>
        <div className="drawer-footer">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Salvando...' : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment card ─────────────────────────────────────────
function AppointmentCard({
  apt,
  onOpenPatient,
}: {
  apt: Appointment;
  onOpenPatient: (apt: Appointment) => void;
}) {
  const timeStr = format(new Date(apt.scheduled_at), 'HH:mm');

  return (
    <div
      className="card"
      style={{ borderLeft: `4px solid ${STATUS_BAR[apt.status]}`, cursor: 'pointer', padding: '12px 14px' }}
      onClick={() => onOpenPatient(apt)}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') onOpenPatient(apt);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ textAlign: 'center', minWidth: '44px', flexShrink: 0 }}>
          <p style={{ fontWeight: 700, fontSize: '16px', color: 'var(--primary)', lineHeight: 1 }}>{timeStr}</p>
          {apt.service?.duration_minutes && (
            <p style={{ fontSize: '10px', color: 'var(--text-3)', marginTop: '2px' }}>{apt.service.duration_minutes}min</p>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {apt.patient?.name ?? '—'}
          </p>
          {apt.service && (
            <p style={{ fontSize: '12px', color: 'var(--text-2)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {apt.service.name}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ ...STATUS_STYLE[apt.status], padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600 }}>
            {STATUS_LABEL[apt.status]}
          </span>
          <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
        </div>
      </div>
    </div>
  );
}

// ─── Date strip ───────────────────────────────────────────────
function DateStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const today = startOfDay(new Date());
  const days = buildDays(today);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stripRef.current) return;
    const idx = days.findIndex(d => isSameDay(d, selected));
    const el = stripRef.current.children[idx] as HTMLElement;
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={stripRef}
      style={{
        display: 'flex', gap: '6px', overflowX: 'auto', padding: '12px 16px',
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
        borderBottom: '1px solid var(--border)',
      }}
    >
      {days.map(day => {
        const isSelected = isSameDay(day, selected);
        const isToday = isSameDay(day, today);
        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelect(day)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              minWidth: '52px', padding: '10px 6px', borderRadius: '14px', border: 'none',
              cursor: 'pointer', flexShrink: 0,
              background: isSelected ? 'var(--primary)' : isToday ? 'var(--bg-2)' : 'transparent',
              color: isSelected ? '#fff' : isToday ? 'var(--primary)' : 'var(--text-2)',
              fontWeight: isSelected || isToday ? 700 : 400,
              transition: 'background 0.15s',
            }}
          >
            <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {format(day, 'EEE', { locale: ptBR })}
            </span>
            <span style={{ fontSize: '20px', lineHeight: 1 }}>
              {format(day, 'd')}
            </span>
            {isToday && !isSelected && (
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--primary)', display: 'block' }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────
export function AgendaPage() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()));
  const { agendamentos, loading, error, create } = useAgenda(selectedDate);
  const [showModal, setShowModal] = useState(false);

  const handleOpenPatient = (apt: Appointment) => {
    navigate(`/pacientes?patient_id=${apt.patient_id}&appointment_id=${apt.id}`, {
      state: {
        patientId: apt.patient_id,
        appointmentId: apt.id,
        serviceId: apt.service_id,
      },
    });
  };

  const dateLabel = isSameDay(selectedDate, startOfDay(new Date()))
    ? 'Hoje'
    : format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR });

  const uniquePatients = new Set(agendamentos.map(a => a.patient_id)).size;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agenda</h1>
          <p className="page-sub" style={{ textTransform: 'capitalize' }}>{dateLabel}</p>
        </div>
      </div>

      <DateStrip selected={selectedDate} onSelect={setSelectedDate} />

      <div style={{ padding: '16px' }}>
        {error ? (
          <div className="empty-state">
            <p>{error}</p>
          </div>
        ) : loading ? (
          <p style={{ color: 'var(--text-3)', textAlign: 'center', padding: '48px 0' }}>Carregando...</p>
        ) : agendamentos.length === 0 ? (
          <div className="empty-state">
            <Calendar size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
            <p>Nenhum agendamento para este dia.</p>
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              Agendar consulta
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {agendamentos.map(apt => (
              <AppointmentCard
                key={apt.id}
                apt={apt}
                onOpenPatient={handleOpenPatient}
              />
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowModal(true)}
        aria-label="Novo agendamento"
        style={{
          position: 'fixed',
          bottom: 'calc(var(--tab-h) + 20px)',
          right: '20px',
          width: '56px', height: '56px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--primary-lt), var(--primary))',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(190,24,93,0.35)',
          zIndex: 100,
          color: '#fff',
        }}
      >
        <Plus size={26} />
      </button>

      {/* Info bar */}
      {agendamentos.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 'var(--tab-h)',
          background: 'var(--bg-2)', borderTop: '1px solid var(--border)',
          padding: '10px 16px',
          display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-2)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={13} /> {agendamentos.length} agendamento{agendamentos.length !== 1 ? 's' : ''}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <User size={13} /> {uniquePatients} paciente{uniquePatients !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {showModal && (
        <NovoAgendamentoModal
          initialDate={selectedDate}
          onSave={create}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

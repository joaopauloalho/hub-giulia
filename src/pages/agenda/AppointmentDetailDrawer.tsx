import { useState } from 'react';
import { BellRing, Check, Edit3, HeartPulse, RefreshCw, User, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { AgendaAppointment } from '../../hooks/useAgenda';
import { useToast } from '../../hooks/useToast';
import { clinicDateLabel, clinicTime, displayEndTime } from '../../lib/agendaTime';
import { AGENDA_STATUS_LABEL, agendaStatusStyle } from './agendaStyles';

export function AppointmentDetailDrawer({
  appointment, isReturn, googleConnected, needsReauth,
  onEdit, onConfirm, onCancel, onNoShow, onRetryGoogle, onWaitlist, onCandidates, onClose,
}: {
  appointment: AgendaAppointment;
  isReturn: boolean;
  googleConnected: boolean;
  needsReauth: boolean;
  onEdit: () => void;
  onConfirm: () => Promise<unknown>;
  onCancel: (reason: string | null) => Promise<unknown>;
  onNoShow: () => Promise<unknown>;
  onRetryGoogle: () => Promise<unknown>;
  onWaitlist?: () => void;
  onCandidates?: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { toast, confirm } = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const duration = appointment.duration_minutes ?? appointment.service?.duration_minutes ?? 60;
  const active = appointment.status === 'pendente' || appointment.status === 'confirmado';

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await action(); toast.success(success); onClose(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar.'); }
    finally { setBusy(false); }
  };

  const noShow = async () => {
    const ok = await confirm({ title: 'Marcar falta', message: 'Confirmar que a paciente não compareceu?', confirmLabel: 'Não compareceu', cancelLabel: 'Voltar', tone: 'warning' });
    if (ok) await run(onNoShow, 'Falta registrada.');
  };

  const syncLabel = appointment.google_sync_status === 'synced' ? 'Google sincronizado'
    : appointment.google_sync_status === 'pending' ? 'Sincronização Google pendente'
      : appointment.google_sync_status === 'disconnected' ? 'Google desconectado'
        : 'Não sincronizado com Google';

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-detail-title" onClick={event => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2 id="appointment-detail-title" className="drawer-title">{appointment.patient?.name ?? 'Agendamento'}</h2>
            <span style={{ ...agendaStatusStyle[appointment.status], display: 'inline-block', marginTop: 5, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{AGENDA_STATUS_LABEL[appointment.status]}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="card" style={{ padding: 12 }}><div className="page-sub">Data e horário</div><strong>{clinicDateLabel(appointment.scheduled_at, { day: '2-digit', month: 'long' })} · {clinicTime(appointment.scheduled_at)} → {displayEndTime(appointment.scheduled_at, duration)}</strong><div className="page-sub">{duration} minutos</div></div>
            <div className="card" style={{ padding: 12 }}><div className="page-sub">Serviço</div><strong>{appointment.service?.name ?? 'Consulta / não definido'}</strong>{isReturn && <div style={{ marginTop: 5, fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>Retorno vinculado</div>}</div>
            {appointment.patient?.phone && <div className="card" style={{ padding: 12 }}><div className="page-sub">Telefone</div><strong>{appointment.patient.phone}</strong></div>}
            {appointment.notes && <div className="card" style={{ padding: 12 }}><div className="page-sub">Observação</div><span>{appointment.notes}</span></div>}
            <div className="card" style={{ padding: 12 }}><div className="page-sub">Origem</div><strong>{appointment.source === 'return' || isReturn ? 'Retorno' : 'Manual'}</strong></div>
            {appointment.last_rescheduled_at && appointment.previous_scheduled_at && <div className="card" style={{ padding: 12 }}><div className="page-sub">Último reagendamento</div><span>{clinicTime(appointment.previous_scheduled_at)} → {clinicTime(appointment.scheduled_at)}</span></div>}
            <div className="card" style={{ padding: 12 }}><div className="page-sub">Google Calendar</div><strong>{needsReauth ? 'Reconexão necessária' : syncLabel}</strong>{(appointment.google_sync_status === 'error' || appointment.google_sync_status === 'pending') && googleConnected && !needsReauth && <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => void run(onRetryGoogle, 'Sincronização atualizada.')} disabled={busy}><RefreshCw size={14} /> Tentar novamente</button>}</div>
            {appointment.status === 'cancelado' && onCandidates && <div className="card" style={{ padding: 12, border: '1px solid var(--border)' }}><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><BellRing size={17}/><strong>Horário disponível</strong></div><p className="page-sub" style={{ marginTop: 4 }}>Veja quem já disse que gostaria de antecipar um atendimento.</p><button type="button" className="btn btn--primary btn--sm" style={{ marginTop: 8, minHeight: 44 }} onClick={onCandidates}>Ver lista de encaixe</button></div>}
          </div>
          {active && <div style={{ marginTop: 16 }}><label className="field-label">Motivo do cancelamento (opcional)</label><input className="field-input" value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Paciente cancelou, clínica cancelou, outro..." /></div>}
        </div>
        <div className="drawer-footer" style={{ flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => navigate(`/pacientes/${appointment.patient_id}?appointment_id=${appointment.id}&return_to=${encodeURIComponent(`/agenda`)}`)}><User size={15} /> Paciente</button>
          {active && onWaitlist && <button className="btn-secondary" onClick={onWaitlist} disabled={busy}><BellRing size={15} /> Lista de encaixe</button>}
          {active && <button className="btn-secondary" onClick={onEdit} disabled={busy}><Edit3 size={15} /> Reagendar</button>}
          {appointment.status === 'pendente' && <button className="btn-secondary" onClick={() => void run(onConfirm, 'Consulta confirmada.')} disabled={busy}><Check size={15} /> Confirmar</button>}
          {active && <button className="btn btn--primary btn--md" onClick={() => navigate(`/atendimento/${appointment.id}`)} disabled={busy}><HeartPulse size={16} /> Abrir atendimento</button>}
          {active && <button className="btn-secondary" onClick={() => void noShow()} disabled={busy}>Não compareceu</button>}
          {active && <button className="btn btn--danger btn--md" onClick={() => void run(() => onCancel(cancelReason.trim() || null), 'Agendamento cancelado.')} disabled={busy}>Cancelar</button>}
        </div>
      </div>
    </div>
  );
}

import { CalendarPlus, CheckCircle2, Clock3, MessageCircle, UserRound, XCircle } from 'lucide-react';
import { formatClinicDate } from '../../lib/returnStatus';
import type { RetornoInfo } from '../../hooks/useRetornos';

function badgeClass(item: RetornoInfo) {
  if (item.operationalStatus === 'completed' || item.operationalStatus === 'dismissed') return 'badge badge--gray';
  if (item.operationalStatus === 'scheduled') return 'badge badge--green';
  if (item.temporalStatus === 'overdue') return 'badge badge--red';
  if (item.temporalStatus === 'due_soon') return 'badge badge--amber';
  if (item.temporalStatus === 'available') return 'badge badge--rose';
  return 'badge badge--gray';
}

export function RetornoCard({
  item,
  onPatient,
  onContact,
  onWhatsApp,
  onSchedule,
  onAgenda,
  onComplete,
  onDismiss,
}: {
  item: RetornoInfo;
  onPatient: () => void;
  onContact: () => void;
  onWhatsApp: () => void;
  onSchedule: () => void;
  onAgenda: () => void;
  onComplete: () => void;
  onDismiss: () => void;
}) {
  const closed = item.operationalStatus === 'completed' || item.operationalStatus === 'dismissed';
  const scheduled = item.operationalStatus === 'scheduled';
  const typeLabel = item.returnType === 'clinical_return' ? 'Retorno clínico' : 'Nova sessão';

  return (
    <article className="card" style={{ padding: '18px', display: 'grid', gap: '14px' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{item.patientName}</strong>
          <span className={badgeClass(item)}>{item.situationLabel}</span>
          {item.contactedAt && <span className="badge badge--gray">Contatada</span>}
        </div>
        <div style={{ color: 'var(--primary)', fontWeight: 700, marginTop: '4px' }}>{item.serviceName}</div>
        <div style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>{typeLabel}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '10px' }}>
        <div><div className="page-sub">Procedimento</div><strong>{formatClinicDate(item.procedureDate)}</strong></div>
        <div><div className="page-sub">Pode retornar a partir de</div><strong>{formatClinicDate(item.windowStartIso)}</strong></div>
        <div><div className="page-sub">Prazo ideal até</div><strong>{formatClinicDate(item.windowEndIso)}</strong></div>
      </div>

      {scheduled && item.appointmentScheduledAt && (
        <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '10px 12px', color: '#166534', fontSize: '0.86rem' }}>
          Agendado para {new Date(item.appointmentScheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </div>
      )}
      {item.dismissedReason && <div className="page-sub">Motivo da dispensa: {item.dismissedReason}</div>}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {item.patientId && <button className="btn btn--sm btn--ghost" onClick={onPatient}><UserRound size={16} /> Paciente</button>}
        {!closed && item.patientPhone && <button className="btn btn--sm btn--secondary" onClick={onWhatsApp}><MessageCircle size={16} /> WhatsApp</button>}
        {!closed && !item.contactedAt && <button className="btn btn--sm btn--ghost" onClick={onContact}><CheckCircle2 size={16} /> Marcar contatada</button>}
        {!closed && !scheduled && item.patientId && <button className="btn btn--sm btn--primary" onClick={onSchedule}><CalendarPlus size={16} /> Agendar</button>}
        {scheduled && <button className="btn btn--sm btn--ghost" onClick={onAgenda}><Clock3 size={16} /> Ver agenda</button>}
        {!closed && <button className="btn btn--sm btn--ghost" onClick={onComplete}><CheckCircle2 size={16} /> Concluir</button>}
        {!closed && <button className="btn btn--sm btn--danger" onClick={onDismiss}><XCircle size={16} /> Dispensar</button>}
      </div>
    </article>
  );
}

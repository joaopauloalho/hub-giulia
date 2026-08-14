import { CalendarDays, Camera, ClipboardList, FileSignature, FileText, Loader2, MapPin, NotebookPen, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePatientTimeline } from '../../../hooks/usePatient360';

interface Props {
  patientId: string;
  onOpen: (eventType: string) => void;
}

const ICONS: Record<string, React.ReactNode> = {
  appointment: <CalendarDays size={16} />,
  procedure: <ClipboardList size={16} />,
  return: <RefreshCw size={16} />,
  note: <NotebookPen size={16} />,
  contract: <FileSignature size={16} />,
  photo: <Camera size={16} />,
  anamnesis: <FileText size={16} />,
  injectable: <MapPin size={16} />,
};

export function TimelineTab({ patientId, onOpen }: Props) {
  const timeline = usePatientTimeline(patientId, 20);

  if (timeline.loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" /></div>;
  if (timeline.error && timeline.events.length === 0) return <div className="empty-state"><p>{timeline.error}</p><button className="btn btn--secondary btn--sm" onClick={() => void timeline.refresh()}>Tentar novamente</button></div>;
  if (timeline.events.length === 0) return <div className="empty-state"><ClipboardList size={42} strokeWidth={1} /><p>Nenhum evento registrado ainda.</p></div>;

  return <div style={{ display: 'grid', gap: 0 }}>
    {timeline.events.map((event, index) => <div key={event.eventKey} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 10, position: 'relative', paddingBottom: 16 }}>
      {index < timeline.events.length - 1 && <div style={{ position: 'absolute', left: 17, top: 32, bottom: 0, width: 1, background: 'var(--border)' }} />}
      <div style={{ width: 34, height: 34, borderRadius: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-2)', border: '1px solid var(--border)', zIndex: 1 }}>{ICONS[event.eventType] ?? <ClipboardList size={16} />}</div>
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'start', gap: 8 }}><div style={{ flex: 1 }}><strong style={{ fontSize: 13 }}>{event.title}</strong>{event.subtitle && <div className="page-sub" style={{ marginTop: 2 }}>{event.subtitle}</div>}<div className="page-sub" style={{ marginTop: 5 }}>{format(new Date(event.occurredAt), "dd 'de' MMM 'de' yyyy · HH:mm", { locale: ptBR })}</div></div><button className="btn btn--ghost btn--sm" onClick={() => onOpen(event.eventType)}>Abrir</button></div>
      </div>
    </div>)}
    {timeline.hasMore && <button className="btn btn--secondary btn--md" onClick={() => void timeline.loadMore()} disabled={timeline.loadingMore}>{timeline.loadingMore ? 'Carregando…' : 'Carregar mais'}</button>}
    {timeline.error && <p className="page-sub" style={{ marginTop: 8 }}>A próxima página não pôde ser carregada.</p>}
  </div>;
}

import { MessageCircle } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { usePatientCommunications } from '../../hooks/useCommunications';
import { communicationStatusLabel } from '../../lib/communications';

export function PatientCommunicationCard({ patientId }: { patientId: string }) {
  const { items, loading, error } = usePatientCommunications(patientId, 5);
  return <div className="card" style={{ padding: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><MessageCircle size={15} /><strong style={{ flex: 1, fontSize: 13 }}>Comunicação recente</strong></div>
    {loading ? <Skeleton lines={3} /> : error ? <p className="page-sub">Não foi possível carregar as comunicações recentes.</p> : items.length === 0 ? <p className="page-sub">Nenhuma mensagem foi registrada manualmente pela Central.</p> : <div style={{ display: 'grid', gap: 8 }}>{items.map(item => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}><span className="page-sub">{new Date(item.sent_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span><div><strong style={{ fontSize: 13 }}>WhatsApp · {communicationStatusLabel(item.context)}</strong><div className="page-sub">Enviado manualmente · entrega e leitura não disponíveis</div></div></div>)}</div>}
  </div>;
}

import { HeartHandshake } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRelationshipPersonDetail } from '../../hooks/useRelationship';
import { relationshipDateTime } from '../../lib/relationship';
import { Skeleton } from '../ui/Skeleton';

export function PatientRelationshipCard({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { person, loading, error } = useRelationshipPersonDetail('patient', patientId);
  const open = () => navigate(`/relacionamento?person_type=patient&person_id=${patientId}`);
  if (loading) return <div className="card" style={{ padding: 14 }}><Skeleton lines={2} /></div>;
  return <div className="card" style={{ padding: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}><HeartHandshake size={16} /><strong style={{ flex: 1, fontSize: 13 }}>Relacionamento</strong>{person && <span className="page-sub">{person.opportunities.length} motivo{person.opportunities.length === 1 ? '' : 's'}</span>}</div>
    {error ? <p className="page-sub" style={{ margin: 0 }}>Contexto de relacionamento indisponível no momento.</p> : !person ? <p className="page-sub" style={{ margin: 0 }}>Nenhuma oportunidade de relacionamento agora.</p> : <div style={{ display: 'grid', gap: 6 }}>{person.opportunities.slice(0, 3).map(item => <div key={item.key} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', background: 'var(--bg-2)', fontSize: 12 }}><strong>{item.label}</strong></div>)}{person.last_contact_at && <div className="page-sub">Último contato: {relationshipDateTime(person.last_contact_at)}</div>}</div>}
    <button className="btn btn--ghost btn--sm" type="button" onClick={open} style={{ marginTop: 8 }}>Abrir Relacionamento</button>
  </div>;
}

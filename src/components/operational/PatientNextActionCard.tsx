import { ArrowRight, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePatientNextAction } from '../../hooks/useOperational';

export function PatientNextActionCard({ patientId, appointmentId }: { patientId: string; appointmentId?: string | null }) {
  const navigate = useNavigate();
  const query = usePatientNextAction(patientId, appointmentId);
  if (query.isLoading) return <div className="card" style={{ padding: 13 }}><span className="page-sub">Verificando próxima ação…</span></div>;
  if (query.error) return <div className="card" style={{ padding: 13 }}><span className="page-sub">Próxima ação indisponível no momento.</span></div>;
  if (!query.data) return null;
  return <section className="card" style={{ padding: 14, display: 'grid', gap: 8, borderColor: 'var(--rose-border, var(--border))' }} aria-label="Próxima ação">
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-2)' }}><Sparkles size={15} /><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>Próxima ação</strong></div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><div><strong>{query.data.title}</strong><div className="page-sub">Regra factual compartilhada pelo Hub.</div></div><button type="button" className="btn btn--primary btn--sm" onClick={() => navigate(query.data!.route)}>{query.data.action_label} <ArrowRight size={14} /></button></div>
  </section>;
}

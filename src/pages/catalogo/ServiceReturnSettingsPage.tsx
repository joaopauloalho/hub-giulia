import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ServiceAftercareSettings } from './ServiceAftercareSettings';
import { ServiceReturnSettings } from './ServiceReturnSettings';

export function ServiceReturnSettingsPage() {
  const navigate = useNavigate();
  return <div className="page">
    <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/catalogo')}><ArrowLeft size={16} /> Voltar catálogo</button>
      <div><h1 className="page-title">Rotinas por serviço</h1><p className="page-sub">Retornos continuam no Returns 2.0. Pós-atendimento configura orientações e check-ins sem criar uma segunda fonte clínica.</p></div>
    </header>
    <div style={{ marginTop: 16, display: 'grid', gap: 14 }}><ServiceReturnSettings /><ServiceAftercareSettings /></div>
  </div>;
}

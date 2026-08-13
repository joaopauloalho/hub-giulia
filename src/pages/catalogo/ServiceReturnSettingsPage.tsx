import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ServiceReturnSettings } from './ServiceReturnSettings';

export function ServiceReturnSettingsPage() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Catálogo · Acompanhamentos</h1><p className="page-sub">Configure a regra usada somente em novos procedimentos.</p></div>
        <button className="btn btn--sm btn--ghost" onClick={() => navigate('/catalogo')}><ArrowLeft size={16} /> Voltar ao catálogo</button>
      </div>
      <ServiceReturnSettings />
    </div>
  );
}

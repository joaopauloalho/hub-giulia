import { Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { RetornosPage } from './RetornosPage';
import './retornos.css';

export function RetornosHubPage() {
  const navigate = useNavigate();
  return (
    <>
      <RetornosPage />
      <div className="page" style={{ paddingTop: 0 }}>
        <div className="card returns-settings-link">
          <div>
            <strong>Regras de acompanhamento por serviço</strong>
            <p className="page-sub">Defina retorno clínico ou recomendação de nova sessão para os próximos atendimentos.</p>
          </div>
          <button className="btn btn--sm btn--ghost" onClick={() => navigate('/catalogo/acompanhamentos')}>
            <Settings2 size={16} /> Configurar serviços
          </button>
        </div>
      </div>
    </>
  );
}

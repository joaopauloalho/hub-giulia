import { useNavigate } from 'react-router-dom';
import { useContacts } from '../../hooks/useContacts';
import { useDeals } from '../../hooks/useDeals';
import { usePacientes } from '../../hooks/usePacientes';
import { Users, Briefcase, Award, UserRound, Plus } from 'lucide-react';

export function DashboardPage() {
  const navigate = useNavigate();
  const { contacts } = useContacts();
  const { deals } = useDeals();
  const { pacientes } = usePacientes();

  const totalRevenue = deals
    .filter(d => d.stage === 'won')
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  const stats = [
    { label: 'Pacientes', value: pacientes.length, icon: UserRound, color: 'stat--gold' },
    { label: 'Contatos', value: contacts.length, icon: Users, color: 'stat--blue' },
    { label: 'Negócios ativos', value: deals.filter(d => !['won', 'lost'].includes(d.stage)).length, icon: Briefcase, color: 'stat--amber' },
    { label: 'Ganhos', value: `R$ ${totalRevenue.toLocaleString('pt-BR')}`, icon: Award, color: 'stat--green' },
  ];

  const recentPacientes = pacientes.slice(0, 5);
  const recentDeals = deals.slice(0, 5);

  const stageLabel: Record<string, string> = {
    lead: 'Lead', qualified: 'Qualificado', proposal: 'Proposta', won: 'Ganho', lost: 'Perdido',
  };
  const stageBadge: Record<string, string> = {
    lead: 'badge--gray', qualified: 'badge--blue', proposal: 'badge--amber', won: 'badge--green', lost: 'badge--red',
  };

  const fmtDate = (iso: string) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Visão geral do hub</p>
        </div>
        <button
          className="btn btn--primary btn--md"
          onClick={() => navigate('/pacientes')}
          style={{ gap: 8 }}
        >
          <Plus size={16} strokeWidth={2} />
          Nova Cliente
        </button>
      </div>

      <div className="stats-grid">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={`stat-card ${color}`}>
            <div className="stat-icon"><Icon size={20} strokeWidth={1.5} /></div>
            <div>
              <p className="stat-value">{value}</p>
              <p className="stat-label">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Pacientes recentes</h2>
            <button className="btn btn--ghost btn--sm" onClick={() => navigate('/pacientes')}>
              Ver todas
            </button>
          </div>
          {recentPacientes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <p className="empty-text">Nenhuma paciente cadastrada ainda.</p>
              <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={() => navigate('/pacientes')}>
                <Plus size={14} /> Cadastrar
              </button>
            </div>
          ) : (
            <ul className="list">
              {recentPacientes.map(p => (
                <li key={p.id} className="list-item">
                  <div className="avatar">{p.nome[0]?.toUpperCase() ?? '?'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="list-item-name">{p.nome}</p>
                    <p className="list-item-sub">{p.motivoConsulta || p.profissao || '—'}</p>
                  </div>
                  {p.dataConsulta && (
                    <span className="badge badge--gray">{fmtDate(p.dataConsulta)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="card-title">Negócios recentes</h2>
          {recentDeals.length === 0 ? (
            <p className="empty-text">Nenhum negócio ainda.</p>
          ) : (
            <ul className="list">
              {recentDeals.map(d => (
                <li key={d.id} className="list-item">
                  <div className="deal-info">
                    <p className="list-item-name">{d.title}</p>
                    <p className="list-item-sub">{d.contact?.name ?? '—'}</p>
                  </div>
                  <span className={`badge ${stageBadge[d.stage]}`}>{stageLabel[d.stage]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

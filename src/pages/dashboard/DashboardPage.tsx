import { useContacts } from '../../hooks/useContacts';
import { useDeals } from '../../hooks/useDeals';
import { Users, Briefcase, TrendingUp, Award } from 'lucide-react';

export function DashboardPage() {
  const { contacts } = useContacts();
  const { deals } = useDeals();

  const totalRevenue = deals
    .filter(d => d.stage === 'won')
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  const pipeline = deals
    .filter(d => !['won', 'lost'].includes(d.stage))
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  const stats = [
    { label: 'Contatos', value: contacts.length, icon: Users, color: 'stat--blue' },
    { label: 'Negócios ativos', value: deals.filter(d => !['won', 'lost'].includes(d.stage)).length, icon: Briefcase, color: 'stat--amber' },
    { label: 'Pipeline', value: `R$ ${pipeline.toLocaleString('pt-BR')}`, icon: TrendingUp, color: 'stat--green' },
    { label: 'Ganhos', value: `R$ ${totalRevenue.toLocaleString('pt-BR')}`, icon: Award, color: 'stat--gold' },
  ];

  const recentContacts = contacts.slice(0, 5);
  const recentDeals = deals.slice(0, 5);

  const stageLabel: Record<string, string> = {
    lead: 'Lead', qualified: 'Qualificado', proposal: 'Proposta', won: 'Ganho', lost: 'Perdido',
  };
  const stageBadge: Record<string, string> = {
    lead: 'badge--gray', qualified: 'badge--blue', proposal: 'badge--amber', won: 'badge--green', lost: 'badge--red',
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-sub">Visão geral do seu CRM</p>
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
          <h2 className="card-title">Contatos recentes</h2>
          {recentContacts.length === 0 ? (
            <p className="empty-text">Nenhum contato ainda.</p>
          ) : (
            <ul className="list">
              {recentContacts.map(c => (
                <li key={c.id} className="list-item">
                  <div className="avatar">{c.name[0].toUpperCase()}</div>
                  <div>
                    <p className="list-item-name">{c.name}</p>
                    <p className="list-item-sub">{c.company ?? c.email ?? '—'}</p>
                  </div>
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

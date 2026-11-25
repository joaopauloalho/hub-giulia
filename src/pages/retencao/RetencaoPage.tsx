import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { money } from '../../lib/dashboardMetrics';
import { cohortLabel, formatShare, originLabel, retentionRates } from '../../lib/retention';
import { Skeleton } from '../../components/ui/Skeleton';
import '../simple/simple.css';

type PersonValue = { patient_id: string; name: string; paid_total: number; visits: number };
type AtRisk = { patient_id: string; name: string; last_visit_on: string; days_since_visit: number };
type Cohort = { month: string; customers: number; returning: number; paid_total: number };
type Origin = { source: string; customers: number; paid_total: number };
type Panel = {
  threshold_days: number;
  customers: number;
  returning_customers: number;
  one_time_customers: number;
  paid_total: number;
  returning_paid_total: number;
  at_risk: AtRisk[];
  ltv: PersonValue[];
  cohorts: Cohort[];
  origins: Origin[];
};

const PREVIEW = 8;

export function RetencaoPage() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRisk, setShowRisk] = useState(false);
  const [showValue, setShowValue] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('get_retention_panel_v1').then(({ data, error: rpcError }) => {
      if (!alive) return;
      if (rpcError || !data) setError('Não foi possível carregar a retenção.');
      else setPanel(data as Panel);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const rates = panel ? retentionRates(Number(panel.customers), Number(panel.returning_customers), Number(panel.paid_total), Number(panel.returning_paid_total)) : null;
  const risk = panel ? (showRisk ? panel.at_risk : panel.at_risk.slice(0, PREVIEW)) : [];
  const values = panel ? (showValue ? panel.ltv : panel.ltv.slice(0, PREVIEW)) : [];

  return <div className="page simple-page" data-testid="retencao-page">
    <header className="simple-head">
      <div>
        <h1 className="page-title">Retenção</h1>
        <p className="page-sub">Valor realmente pago, desde abril de 2026. Sessão de pacote não entra pelo preço de tabela.</p>
      </div>
    </header>
    {loading ? <Skeleton height={96} /> : error || !panel || !rates ? <div className="card simple-empty" role="alert">{error ?? 'Sem dados.'}</div> : <>
      <div className="simple-metrics">
        <div className="card simple-metric"><span className="page-sub">Taxa de retorno</span><strong>{formatShare(rates.returnRate)}</strong></div>
        <div className="card simple-metric"><span className="page-sub">Veio uma vez</span><strong>{formatShare(rates.oneTimeShare)}</strong><span className="page-sub">{panel.one_time_customers} de {panel.customers}</span></div>
        <div className="card simple-metric"><span className="page-sub">Receita de quem voltou</span><strong>{formatShare(rates.returningRevenueShare)}</strong><span className="page-sub">{money(Number(panel.returning_paid_total))}</span></div>
      </div>

      <section className="simple-section">
        <div className="simple-section__head">
          <div><h2>Esfriando</h2><p className="page-sub">Sem voltar há mais de {panel.threshold_days} dias e sem consulta marcada.</p></div>
          {panel.at_risk.length > PREVIEW && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowRisk(value => !value)}>{showRisk ? 'Menos' : 'Ver todos'}</button>}
        </div>
        {risk.length === 0 ? <div className="card simple-empty"><span className="page-sub">Ninguém nesse prazo.</span></div> : <div className="simple-list">
          {risk.map(person => <article key={person.patient_id} className="card simple-row">
            <div className="simple-row__body"><strong>{person.name}</strong><span className="page-sub">há {person.days_since_visit} dias</span></div>
            <Link className="btn btn--primary btn--sm" to={`/pacientes/${person.patient_id}`}>Abrir</Link>
          </article>)}
        </div>}
      </section>

      <section className="simple-section">
        <div className="simple-section__head">
          <div><h2>Valor pago</h2><p className="page-sub">Soma do que foi cobrado e pago, por paciente.</p></div>
          {panel.ltv.length > PREVIEW && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowValue(value => !value)}>{showValue ? 'Menos' : 'Ver todos'}</button>}
        </div>
        {values.length === 0 ? <div className="card simple-empty"><span className="page-sub">Ainda não há pagamento registrado.</span></div> : <div className="simple-list">
          {values.map(person => <article key={person.patient_id} className="card simple-row">
            <div className="simple-row__body"><strong>{person.name}</strong><span className="page-sub">{person.visits} visita{Number(person.visits) === 1 ? '' : 's'} pagas</span></div>
            <strong>{money(Number(person.paid_total))}</strong>
          </article>)}
        </div>}
      </section>

      <section className="simple-section">
        <div className="simple-section__head"><h2>Coortes</h2><p className="page-sub">Mês do primeiro pagamento.</p></div>
        {panel.cohorts.length === 0 ? <div className="card simple-empty"><span className="page-sub">Sem coorte desde abril.</span></div> : <div className="card" style={{ overflowX: 'auto' }}>
          <table className="simple-table">
            <thead><tr><th>Mês</th><th>Pacientes</th><th>Voltaram</th><th>Pago</th></tr></thead>
            <tbody>{panel.cohorts.map(row => <tr key={row.month}><td>{cohortLabel(row.month)}</td><td>{row.customers}</td><td>{row.returning}</td><td>{money(Number(row.paid_total))}</td></tr>)}</tbody>
          </table>
        </div>}
      </section>

      <section className="simple-section">
        <div className="simple-section__head"><h2>Por origem</h2></div>
        {panel.origins.length === 0 ? <div className="card simple-empty"><span className="page-sub">Sem origem para os pagamentos.</span></div> : <div className="card" style={{ overflowX: 'auto' }}>
          <table className="simple-table">
            <thead><tr><th>Origem</th><th>Pacientes</th><th>Pago</th></tr></thead>
            <tbody>{panel.origins.map(row => <tr key={row.source}><td>{originLabel(row.source)}</td><td>{row.customers}</td><td>{money(Number(row.paid_total))}</td></tr>)}</tbody>
          </table>
        </div>}
      </section>
    </>}
  </div>;
}

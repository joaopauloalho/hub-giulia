import { useMemo, useState } from 'react';
import { Activity, ChevronDown, Clock3, Info, Loader2, RefreshCcw, TrendingUp } from 'lucide-react';
import { usePatientProfitability, type PatientProfitabilityRow } from '../../../hooks/usePatientProfitability';

type Period = 'all' | 'year' | 'month' | 'custom';
const money = (n: number | null | undefined) => n == null ? 'Não calculável' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (n: number | null) => n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const day = (value: string) => new Date(value).toLocaleDateString('pt-BR');
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;

function Metric({ label, value, description }: { label: string; value: string; description?: string }) {
  return <div className="card" style={{ padding: 14, minWidth: 0 }}>
    <div className="page-sub" style={{ fontSize: 12 }}>{label}</div>
    <strong style={{ display: 'block', fontSize: 'clamp(16px, 2vw, 22px)', marginTop: 4, overflowWrap: 'anywhere' }}>{value}</strong>
    {description && <div className="page-sub" style={{ fontSize: 11, marginTop: 4 }}>{description}</div>}
  </div>;
}

function Detail({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '6px 0' }}>
    <span className="page-sub">{label}</span>
    <strong style={{ fontSize: 13, color: emphasize ? 'var(--primary)' : undefined }}>{value}</strong>
  </div>;
}

function AttendanceResult({ row }: { row: PatientProfitabilityRow }) {
  const title = row.kind === 'package' ? `Venda de pacote · ${row.title}` : row.is_return ? `Retorno · ${row.title}` : row.title;
  return <details style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '11px 13px' }}>
    <summary style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', listStyle: 'none' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 13 }}>{title}</strong>
        <span className="page-sub" style={{ fontSize: 12 }}>{day(row.event_at)}{row.is_return ? ' · Sem nova cobrança' : ''}</span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <strong style={{ display: 'block', fontSize: 13, color: row.contribution !== null && row.contribution < 0 ? '#b45309' : undefined }}>{money(row.contribution)}</strong>
        <span className="page-sub" style={{ fontSize: 11 }}>Contribuição</span>
      </div>
      <ChevronDown size={16} color="var(--text-3)" aria-hidden="true" />
    </summary>
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 8 }}>
      <Detail label="Valor vendido" value={money(row.sales)} />
      <Detail label="Efetivamente recebido" value={money(row.received)} />
      <Detail label="Em aberto" value={money(row.pending)} />
      {row.barter > 0 && <Detail label="Valor em permuta (não é dinheiro)" value={money(row.barter)} />}
      <Detail label="Custos do atendimento" value={money(row.costs)} />
      <Detail label="Dos quais: tempo clínico" value={money(row.clinical_time_cost)} />
      <Detail label="Tempo registrado" value={hours(row.clinical_minutes)} />
      <Detail label="Taxas financeiras" value={money(row.fees)} />
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 5 }}>
        <Detail label="Contribuição direta" value={money(row.contribution)} emphasize />
      </div>
      {!row.complete && <p className="page-sub" style={{ fontSize: 12 }}>O custo ou as taxas históricas não têm cobertura suficiente para calcular este resultado com segurança.</p>}
      {row.is_return && <p className="page-sub" style={{ fontSize: 12 }}>O custo deste retorno entra no total da paciente mesmo sem cobrança adicional.</p>}
      {row.kind === 'package' && <p className="page-sub" style={{ fontSize: 12 }}>A venda foi contabilizada uma vez. Custos das sessões consumidas entram em seus respectivos atendimentos.</p>}
    </div>
  </details>;
}

export function PatientProfitabilityPanel({ patientId }: { patientId: string }) {
  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const today = isoDate(new Date());

  const dates = useMemo(() => {
    if (period === 'all') return { from: null, to: null };
    if (period === 'custom') return { from: customFrom || null, to: customTo || null };
    const from = new Date();
    if (period === 'year') from.setFullYear(from.getFullYear() - 1);
    else from.setDate(1);
    return { from: isoDate(from), to: today };
  }, [period, customFrom, customTo, today]);

  const invalid = period === 'custom' && (
    !customFrom || !customTo || customTo < customFrom ||
    (customFrom && customTo && Math.round((new Date(`${customTo}T12:00:00`).getTime() - new Date(`${customFrom}T12:00:00`).getTime()) / 86400000) > 366)
  );
  const { report, loading, loadingMore, error, refresh, loadMore } = usePatientProfitability(
    patientId, invalid ? null : dates.from, invalid ? null : dates.to,
  );

  return <section style={{ display: 'grid', gap: 12 }} aria-label="Rentabilidade da paciente">
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
      <div>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 16 }}><TrendingUp size={18} /> Resultado financeiro acumulado</strong>
        <span className="page-sub">LTV e contribuição direta · histórico de atendimentos, retornos e pacotes</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
        <label htmlFor="patient-profitability-period" className="page-sub">Período</label>
        <select id="patient-profitability-period" className="input" value={period} onChange={event => setPeriod(event.target.value as Period)} style={{ width: 'auto', minHeight: 36 }}>
          <option value="all">Todo o histórico</option>
          <option value="year">Últimos 12 meses</option>
          <option value="month">Este mês</option>
          <option value="custom">Personalizado</option>
        </select>
        <button type="button" className="btn btn--ghost btn--sm" aria-label="Atualizar rentabilidade" onClick={() => void refresh()}><RefreshCcw size={15}/></button>
      </div>
    </div>
    {period === 'custom' && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <label className="page-sub">De <input aria-label="Data inicial" type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} className="input" style={{ display: 'block' }}/></label>
      <label className="page-sub">Até <input aria-label="Data final" type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} className="input" style={{ display: 'block' }}/></label>
      {invalid && <p role="alert" style={{ color: '#b45309', fontSize: 12 }}>Escolha datas válidas, com intervalo máximo de 366 dias.</p>}
    </div>}
    {invalid ? null : loading ? <div className="card" style={{ padding: 28, display: 'flex', justifyContent: 'center' }}><Loader2 size={20} className="spin" aria-label="Carregando resultados"/></div> : error && !report ? <div className="card" style={{ padding: 14, color: '#b45309' }}>{error}</div> : report && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 10 }}>
        <Metric label="Valor total vendido" value={money(report.summary.sales)} description="Atendimentos e vendas de pacotes" />
        <Metric label="Custos registrados" value={money(report.summary.costs)} description="Inclui sessões e retornos" />
        <Metric label="Contribuição direta" value={money(report.summary.contribution)} description={report.summary.complete ? 'Antes das despesas fixas' : 'Cobertura histórica insuficiente'} />
        <Metric label="Margem direta" value={pct(report.summary.margin_pct)} description="Contribuição ÷ vendas" />
      </div>
      <div className="card" style={{ padding: 14 }}>
        <strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Composição dos resultados</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(185px,1fr))', gap: '0 22px' }}>
          <Detail label="Recebido" value={money(report.summary.received)} />
          <Detail label="A receber" value={money(report.summary.pending)} />
          <Detail label="Taxas financeiras" value={money(report.summary.fees)} />
          <Detail label="Permutas" value={money(report.summary.barter)} />
          <Detail label="Produtos, procedimentos e materiais" value={money(report.summary.materials_and_procedures_cost)} />
          <Detail label="Tempo clínico (custo)" value={money(report.summary.clinical_time_cost)} />
          <Detail label="Tempo clínico registrado" value={hours(report.summary.clinical_minutes)} />
          <Detail label="Resultado de caixa após custos" value={money(report.summary.cash_result)} />
        </div>
        <div className="page-sub" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, marginTop: 8 }}>
          <Info size={15} style={{ flexShrink: 0 }} />
          <span>Contribuição direta = vendas − custos registrados − taxas. Não representa lucro líquido: não inclui despesas fixas e custos indiretos. Em protocolos vendidos antecipadamente, o resultado ainda mudará com a execução das sessões. Pagamentos parciais afetam o caixa, mas não a venda.</span>
        </div>
        {!report.summary.complete && <div style={{ color: '#92400e', fontSize: 12, marginTop: 8 }}>Há {report.summary.incomplete_rows} registro(s) com custos históricos ou taxas sem cobertura verificável. Para evitar resultado enganoso, a contribuição e a margem não são exibidas.</div>}
        {period !== 'all' && <p className="page-sub" style={{ fontSize: 12, marginTop: 8 }}>O filtro seleciona a data do atendimento ou venda. O campo recebido considera os pagamentos associados a essas vendas, mesmo quando pagos posteriormente.</p>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={15} /> {report.summary.attendances} atendimentos (inclui {report.summary.returns} retornos)</span>
        <span className="page-sub">{report.summary.package_sales} vendas de pacotes independentes</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Resultado por atendimento e venda</strong>
        {report.rows.length === 0 && <div className="card" style={{ padding: 14 }}><span className="page-sub">Nenhum atendimento ou venda no período.</span></div>}
        {report.rows.map(row => <AttendanceResult key={`${row.kind}-${row.id}`} row={row} />)}
        {error && <p role="alert" className="page-sub">{error}</p>}
        {report.rows.length < report.summary.total_rows && <button type="button" className="btn btn--secondary btn--sm" style={{ justifyContent: 'center' }} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <Loader2 size={15} className="spin" /> : <Clock3 size={15}/>} Carregar mais ({report.rows.length} de {report.summary.total_rows})</button>}
      </div>
    </>}
  </section>;
}

import { useEffect, useMemo, useState } from 'react';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Clock3, Info, Loader2, Package, ReceiptText, Users, X } from 'lucide-react';
import {
  type ServiceFinancialDetailRow,
  type ServiceFinancialPeriod,
  type ServiceFinancialRow,
  type ServiceFinancialSort,
  useServiceFinancials,
} from '../../hooks/useServiceFinancials';
import './service-financial.css';

type PeriodPreset = 'current' | 'previous' | 'three_months' | 'custom';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : money.format(value);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${percent.format(value)}%`;
}

function formatDuration(value: number | null | undefined) {
  if (!value) return '—';
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function periodForPreset(preset: Exclude<PeriodPreset, 'custom'>, now = new Date()): ServiceFinancialPeriod {
  if (preset === 'previous') {
    const previous = subMonths(now, 1);
    return { from: format(startOfMonth(previous), 'yyyy-MM-dd'), to: format(endOfMonth(previous), 'yyyy-MM-dd') };
  }
  if (preset === 'three_months') {
    return { from: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') };
  }
  return { from: format(startOfMonth(now), 'yyyy-MM-dd'), to: format(endOfMonth(now), 'yyyy-MM-dd') };
}

function Coverage({ value, label = 'Cobertura' }: { value: number; label?: string }) {
  if (value >= 99.95) return null;
  return <span className="sf-coverage">{label}: {formatPercent(value)}</span>;
}

function SummaryCard({ label, value, coverage, help }: { label: string; value: string; coverage?: number; help?: string }) {
  return (
    <div className="sf-summary-card">
      <div className="sf-summary-label">
        <span>{label}</span>
        {help ? <span title={help} aria-label={help}><Info size={14} /></span> : null}
      </div>
      <strong className="sf-summary-value">{value}</strong>
      {coverage !== undefined ? <Coverage value={coverage} /> : null}
    </div>
  );
}

function Metric({ label, value, coverage }: { label: string; value: string; coverage?: number }) {
  return (
    <div className="sf-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {coverage !== undefined ? <Coverage value={coverage} /> : null}
    </div>
  );
}

function ServiceRowCard({ row, onOpen }: { row: ServiceFinancialRow; onOpen: () => void }) {
  return (
    <button type="button" className="sf-service-row" onClick={onOpen}>
      <div className="sf-service-main">
        <div className="sf-service-title">
          <strong>{row.service_name}</strong>
          {row.is_archived ? <span className="sf-neutral-badge">Arquivado</span> : null}
          {row.package_realizations > 0 ? <span className="sf-neutral-badge"><Package size={12} /> {row.package_realizations} via pacote</span> : null}
        </div>
        <div className="sf-service-sub">{row.realizations} realizações · {row.unique_patients} pacientes</div>
        {row.unvalued_package_realizations > 0 ? <div className="sf-note">{row.unvalued_package_realizations} realização(ões) via pacote sem valoração canônica completa.</div> : null}
      </div>
      <Metric label="Valor realizado" value={formatMoney(row.realized_value)} coverage={row.valuation_coverage_pct} />
      <Metric label="Desconto" value={formatMoney(row.discount_value)} coverage={row.valuation_coverage_pct} />
      <Metric label="Custo direto" value={formatMoney(row.direct_cost_value)} coverage={row.cost_coverage_pct} />
      <Metric label="Taxas" value={formatMoney(row.attributed_fee_value)} coverage={row.fee_coverage_pct} />
      <Metric label="Contribuição" value={formatMoney(row.contribution_value)} coverage={row.contribution_coverage_pct} />
      <Metric label="Margem" value={formatPercent(row.margin_pct)} coverage={row.contribution_coverage_pct} />
      <Metric label="Tempo" value={formatDuration(row.duration_minutes)} coverage={row.duration_coverage_pct} />
      <Metric label="Contribuição/h" value={row.contribution_per_hour === null ? 'Sem duração suficiente' : formatMoney(row.contribution_per_hour)} coverage={row.duration_coverage_pct} />
      <ChevronRight className="sf-chevron" size={18} />
    </button>
  );
}

function DetailMetric({ label, value, unavailable }: { label: string; value: string; unavailable?: string }) {
  return <div className="sf-detail-metric"><span>{label}</span><strong>{unavailable ?? value}</strong></div>;
}

function ServiceDetail({ row, period, loadDetail, onClose }: {
  row: ServiceFinancialRow;
  period: ServiceFinancialPeriod;
  loadDetail: (serviceId: string, page?: number, pageSize?: number) => Promise<ServiceFinancialDetailRow[]>;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<ServiceFinancialDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loadDetail(row.service_id, page, pageSize)
      .then(data => { if (active) setItems(data); })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Erro ao carregar detalhes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadDetail, page, row.service_id]);

  const total = items[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const contributionKnownCount = Math.round(row.realizations * row.contribution_coverage_pct / 100);
  const averageContribution = contributionKnownCount > 0 ? row.contribution_value / contributionKnownCount : null;

  return (
    <div className="sf-drawer-overlay" onClick={onClose}>
      <aside className="sf-drawer" role="dialog" aria-modal="true" aria-labelledby="sf-detail-title" onClick={event => event.stopPropagation()}>
        <div className="sf-drawer-header">
          <div>
            <span className="sf-eyebrow">Por serviço</span>
            <h2 id="sf-detail-title">{row.service_name}</h2>
            <p>{format(new Date(`${period.from}T12:00:00`), 'dd/MM/yyyy')} a {format(new Date(`${period.to}T12:00:00`), 'dd/MM/yyyy')}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Fechar detalhes"><X size={20} /></button>
        </div>

        <div className="sf-detail-summary">
          <DetailMetric label="Realizações" value={String(row.realizations)} />
          <DetailMetric label="Pacientes" value={String(row.unique_patients)} />
          <DetailMetric label="Ticket médio" value={formatMoney(row.average_ticket)} unavailable={row.average_ticket === null ? 'Sem valor suficiente' : undefined} />
          <DetailMetric label="Contribuição média" value={formatMoney(averageContribution)} unavailable={averageContribution === null ? 'Sem base suficiente' : undefined} />
          <DetailMetric label="Margem de contribuição direta" value={formatPercent(row.margin_pct)} unavailable={row.margin_pct === null ? 'Sem base suficiente' : undefined} />
          <DetailMetric label="Contribuição/hora" value={formatMoney(row.contribution_per_hour)} unavailable={row.contribution_per_hour === null ? 'Sem duração suficiente' : undefined} />
        </div>

        <div className="sf-contribution-help"><Info size={16} /><span>Contribuição direta = valor realizado menos custos diretos registrados e taxas financeiras atribuídas. Não representa o lucro líquido da clínica.</span></div>

        {loading ? <div className="sf-loading"><Loader2 className="spin" size={20} /> Carregando detalhes...</div> : null}
        {error ? <div className="sf-error">{error}</div> : null}

        {!loading && !error ? (
          <div className="sf-detail-list">
            {items.map(item => (
              <div className="sf-detail-item" key={item.procedure_item_id}>
                <div className="sf-detail-item-head">
                  <div><strong>{item.patient_name}</strong><span>{format(new Date(item.performed_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}{item.via_package ? ' · via pacote' : ''}</span></div>
                  <strong>{formatMoney(item.realized_value)}</strong>
                </div>
                <div className="sf-detail-grid">
                  <DetailMetric label="Valor de tabela" value={formatMoney(item.table_value)} />
                  <DetailMetric label="Desconto" value={formatMoney(item.discount_value)} unavailable={!item.valuation_known ? 'Cobertura incompleta' : undefined} />
                  <DetailMetric label="Custo direto" value={formatMoney(item.direct_cost_value)} unavailable={!item.cost_known ? 'Não informado' : undefined} />
                  <DetailMetric label="Taxa atribuída" value={formatMoney(item.attributed_fee_value)} unavailable={!item.fee_known ? 'Cobertura incompleta' : undefined} />
                  <DetailMetric label="Contribuição" value={formatMoney(item.contribution_value)} unavailable={!item.contribution_known ? 'Não calculável' : undefined} />
                  <DetailMetric label="Duração" value={formatDuration(item.duration_minutes)} unavailable={!item.duration_minutes ? 'Sem duração histórica' : undefined} />
                </div>
              </div>
            ))}
            {items.length === 0 ? <div className="sf-empty-small">Nenhuma realização neste período.</div> : null}
          </div>
        ) : null}

        {total > pageSize ? (
          <div className="sf-pagination">
            <button className="btn btn--ghost btn--sm" type="button" disabled={page === 0 || loading} onClick={() => setPage(value => Math.max(0, value - 1))}><ChevronLeft size={15} /> Anterior</button>
            <span>{page + 1} de {totalPages}</span>
            <button className="btn btn--ghost btn--sm" type="button" disabled={page + 1 >= totalPages || loading} onClick={() => setPage(value => value + 1)}>Próxima <ChevronRight size={15} /></button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export function ServiceFinancialPage() {
  const [preset, setPreset] = useState<PeriodPreset>('current');
  const [period, setPeriod] = useState<ServiceFinancialPeriod>(() => periodForPreset('current'));
  const [sortBy, setSortBy] = useState<ServiceFinancialSort>('realized_value');
  const [selected, setSelected] = useState<ServiceFinancialRow | null>(null);
  const { summary, rows, loading, error, refresh, loadDetail } = useServiceFinancials(period, sortBy);

  const periodLabel = useMemo(() => {
    if (preset === 'current' || preset === 'previous') return format(new Date(`${period.from}T12:00:00`), 'MMMM yyyy', { locale: ptBR });
    return `${format(new Date(`${period.from}T12:00:00`), 'dd/MM/yyyy')} – ${format(new Date(`${period.to}T12:00:00`), 'dd/MM/yyyy')}`;
  }, [period.from, period.to, preset]);

  const choosePreset = (next: PeriodPreset) => {
    setPreset(next);
    if (next !== 'custom') setPeriod(periodForPreset(next));
  };
  const invalidCustom = period.to < period.from;

  return (
    <section className="sf-page" data-testid="service-financial-page">
      <div className="sf-heading">
        <div><span className="sf-eyebrow">Inteligência financeira</span><h1>Por serviço</h1><p>Quanto cada serviço realizou, consumiu em custos e taxas e gerou de contribuição direta.</p></div>
        <div className="sf-period-label"><Clock3 size={16} /> {periodLabel}</div>
      </div>

      <div className="sf-toolbar" aria-label="Filtros financeiros por serviço">
        <div className="sf-presets">
          <button type="button" className={preset === 'current' ? 'is-active' : ''} onClick={() => choosePreset('current')}>Este mês</button>
          <button type="button" className={preset === 'previous' ? 'is-active' : ''} onClick={() => choosePreset('previous')}>Mês anterior</button>
          <button type="button" className={preset === 'three_months' ? 'is-active' : ''} onClick={() => choosePreset('three_months')}>Últimos 3 meses</button>
          <button type="button" className={preset === 'custom' ? 'is-active' : ''} onClick={() => choosePreset('custom')}>Personalizado</button>
        </div>
        <label className="sf-sort"><span>Ordenar por</span><select value={sortBy} onChange={event => setSortBy(event.target.value as ServiceFinancialSort)}><option value="realized_value">Valor realizado</option><option value="contribution">Contribuição</option><option value="realizations">Realizações</option><option value="contribution_per_hour">Contribuição/hora</option></select></label>
      </div>

      {preset === 'custom' ? <div className="sf-custom-period"><label>De<input type="date" value={period.from} onChange={event => setPeriod(value => ({ ...value, from: event.target.value }))} /></label><label>Até<input type="date" value={period.to} onChange={event => setPeriod(value => ({ ...value, to: event.target.value }))} /></label>{invalidCustom ? <span>O fim do período precisa ser igual ou posterior ao início.</span> : null}</div> : null}

      {loading ? <div className="sf-loading"><Loader2 className="spin" size={20} /> Calculando indicadores...</div> : null}
      {error ? <div className="sf-error">{error}<button type="button" className="btn btn--ghost btn--sm" onClick={() => void refresh()}>Tentar novamente</button></div> : null}

      {!loading && !error && summary.realizations === 0 ? <div className="sf-empty"><ReceiptText size={28} /><h2>Os indicadores aparecem quando procedimentos forem registrados.</h2><p>O Hub usa os snapshots financeiros dos atendimentos realizados; não preenche histórico com preço, custo ou duração atuais.</p></div> : null}

      {!loading && !error && summary.realizations > 0 ? (
        <>
          <div className="sf-summary-grid">
            <SummaryCard label="Valor realizado" value={formatMoney(summary.realized_value)} coverage={summary.valuation_coverage_pct} />
            <SummaryCard label="Descontos concedidos" value={formatMoney(summary.discount_value)} coverage={summary.valuation_coverage_pct} />
            <SummaryCard label="Custos diretos registrados" value={formatMoney(summary.direct_cost_value)} coverage={summary.cost_coverage_pct} />
            <SummaryCard label="Taxas atribuídas" value={formatMoney(summary.attributed_fee_value)} coverage={summary.fee_coverage_pct} />
            <SummaryCard label="Contribuição direta" value={formatMoney(summary.contribution_value)} coverage={summary.contribution_coverage_pct} help="Valor realizado menos custos diretos registrados e taxas financeiras atribuídas. Não representa lucro líquido da clínica." />
          </div>

          <div className="sf-context-strip">
            <span><ReceiptText size={15} /> {summary.realizations} realizações</span><span><Users size={15} /> {summary.unique_patients} pacientes</span><span><Package size={15} /> {summary.package_realizations} via pacote</span><span><Clock3 size={15} /> {formatDuration(summary.duration_minutes)} de duração com {formatPercent(summary.duration_coverage_pct)} de cobertura</span><span>Margem de contribuição direta: <strong>{formatPercent(summary.margin_pct)}</strong></span><span>Contribuição/hora: <strong>{summary.contribution_per_hour === null ? 'Sem duração suficiente' : formatMoney(summary.contribution_per_hour)}</strong></span>
          </div>

          <div className="sf-contribution-help"><Info size={16} /><span>{summary.contribution_coverage_pct < 100 ? `A contribuição exibida é a parcela calculável. Cobertura atual: ${formatPercent(summary.contribution_coverage_pct)}. Custos desconhecidos, vouchers sem valoração ou taxas não atribuíveis não viram zero silenciosamente. Contribuição direta não representa o lucro líquido da clínica.` : 'Contribuição direta não representa o lucro líquido da clínica.'}</span></div>

          <div className="sf-list-header" aria-hidden="true"><span>Serviço</span><span>Realizado</span><span>Desconto</span><span>Custo</span><span>Taxas</span><span>Contribuição</span><span>Margem</span><span>Tempo</span><span>Contrib./h</span><span /></div>
          <div className="sf-service-list">{rows.map(row => <ServiceRowCard key={row.service_id} row={row} onOpen={() => setSelected(row)} />)}</div>
        </>
      ) : null}

      {selected ? <ServiceDetail row={selected} period={period} loadDetail={loadDetail} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

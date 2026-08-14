import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Loader2, WalletCards } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface PackageFinanceRow {
  package_id: string;
  patient_id: string;
  title_snapshot: string;
  sale_recorded_at: string | null;
  sale_value: number;
  paid_value: number;
  paid_fee_value: number;
  paid_net_value: number;
  pending_value: number;
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function monthRange(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const start = new Date(year, monthIndex - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function PackageFinancePanel() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [rows, setRows] = useState<PackageFinanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { start, end } = monthRange(month);
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('package_finance_v')
        .select('package_id,patient_id,title_snapshot,sale_recorded_at,sale_value,paid_value,paid_fee_value,paid_net_value,pending_value')
        .gte('sale_recorded_at', start)
        .lt('sale_recorded_at', end)
        .order('sale_recorded_at', { ascending: false });
      if (queryError) throw queryError;
      setRows((data ?? []).map(row => ({
        ...row,
        sale_value: Number(row.sale_value ?? 0),
        paid_value: Number(row.paid_value ?? 0),
        paid_fee_value: Number(row.paid_fee_value ?? 0),
        paid_net_value: Number(row.paid_net_value ?? 0),
        pending_value: Number(row.pending_value ?? 0),
      })) as PackageFinanceRow[]);
    } catch (err) {
      console.error('[PackageFinancePanel]', err);
      setRows([]);
      setError('Não foi possível carregar o financeiro de pacotes.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void refresh(); }, [refresh]);

  const summary = useMemo(() => rows.reduce((acc, row) => ({
    sold: acc.sold + row.sale_value,
    received: acc.received + row.paid_value,
    fees: acc.fees + row.paid_fee_value,
    net: acc.net + row.paid_net_value,
    pending: acc.pending + row.pending_value,
  }), { sold: 0, received: 0, fees: 0, net: 0, pending: 0 }), [rows]);

  return (
    <div className="page" style={{ paddingTop: 0 }}>
      <div className="card" style={{ padding: 14, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flex: 1, minWidth: 220 }}>
            <WalletCards size={17} />
            <div>
              <strong style={{ display: 'block' }}>Receita de pacotes</strong>
              <span className="page-sub">Origem financeira separada de atendimentos. Consumir crédito não cria nova receita.</span>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
            <CalendarRange size={14} />
            <input className="field-input" type="month" value={month} onChange={event => setMonth(event.target.value)} style={{ minWidth: 150 }} />
          </label>
        </div>

        {loading ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 16, color: 'var(--text-3)' }}><Loader2 className="spin" size={16} /> Carregando pacotes…</div>
        ) : error ? (
          <div className="empty-state"><p>{error}</p></div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(125px,1fr))', gap: 8, marginBottom: 12 }}>
              {[
                ['Vendido', summary.sold],
                ['Recebido', summary.received],
                ['Taxas', summary.fees],
                ['Líquido', summary.net],
                ['Pendente', summary.pending],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ padding: '10px 11px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-2)' }}>
                  <div className="page-sub">{label}</div>
                  <strong style={{ fontSize: 14 }}>{money(Number(value))}</strong>
                </div>
              ))}
            </div>

            {rows.length === 0 ? <p className="page-sub">Nenhuma venda de pacote registrada neste mês.</p> : (
              <div style={{ display: 'grid', gap: 7 }}>
                {rows.map(row => (
                  <div key={row.package_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-2)' }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{row.title_snapshot}</strong>
                      <div className="page-sub">Origem: Pacote · {row.sale_recorded_at ? new Date(row.sale_recorded_at).toLocaleDateString('pt-BR') : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12 }}>
                      <strong>{money(row.paid_value)}</strong>
                      {row.pending_value > 0 && <div style={{ color: '#b45309' }}>{money(row.pending_value)} pendente</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

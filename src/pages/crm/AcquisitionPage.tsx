import { useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { addIsoDays, clinicDateIso } from '../../lib/agendaTime';
import { useAcquisition } from '../../hooks/useAcquisition';

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

export function AcquisitionPage() {
  const navigate = useNavigate();
  const today = clinicDateIso();
  const [startDate, setStartDate] = useState(monthStart(today));
  const [endDate, setEndDate] = useState(today);
  const endExclusive = useMemo(() => addIsoDays(endDate, 1), [endDate]);
  const { data, loading, error, refresh } = useAcquisition(startDate, endExclusive);
  const totals = useMemo(() => (data?.sources ?? []).reduce((acc, row) => ({ registrations: acc.registrations + Number(row.registrations), attended: acc.attended + Number(row.attended_patients), procedures: acc.procedures + Number(row.procedures), value: acc.value + Number(row.production_value) }), { registrations: 0, attended: 0, procedures: 0, value: 0 }), [data]);

  return <div className="page" data-testid="acquisition-page">
    <div className="page-header"><div><button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/crm')}><ArrowLeft size={15}/> CRM</button><h1 className="page-title" style={{ marginTop: 6 }}>Origem das pacientes</h1><p className="page-sub">Aquisição e indicações, sem confundir origem com canal ou pagamento.</p></div><button className="btn btn--ghost btn--md" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15}/> Atualizar</button></div>

    <div className="card" style={{ padding: 12, marginBottom: 12 }}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}><div className="field"><label className="field-label">De</label><input className="field-input" type="date" value={startDate} max={endDate} onChange={event => setStartDate(event.target.value)} /></div><div className="field"><label className="field-label">Até</label><input className="field-input" type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)} /></div><div className="page-sub">Cadastros usam <strong>data de cadastro</strong>. Produção usa <strong>data do procedimento realizado</strong>. Timezone: America/Sao_Paulo.</div></div></div>

    {loading ? <div className="card" style={{ padding: 18 }}>Carregando aquisição…</div> : error ? <div className="empty-state"><p>{error}</p><button className="btn btn--secondary btn--sm" onClick={() => void refresh()}>Tentar novamente</button></div> : <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, marginBottom: 12 }}>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Cadastros no período</div><strong style={{ fontSize: 24 }}>{totals.registrations}</strong></div>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Pacientes com atendimento no período</div><strong style={{ fontSize: 24 }}>{totals.attended}</strong></div>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Procedimentos realizados</div><strong style={{ fontSize: 24 }}>{totals.procedures}</strong></div>
        <div className="card" style={{ padding: 14 }}><div className="page-sub">Valor realizado</div><strong style={{ fontSize: 20 }}>{money(totals.value)}</strong><div className="page-sub">Soma do valor dos procedimentos realizados por pacientes com essas origens.</div></div>
      </div>

      <div className="card" style={{ overflowX: 'auto', marginBottom: 12 }}><div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><strong>Por origem</strong><div className="page-sub">“Não informado” permanece visível para medir qualidade do dado histórico.</div></div><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}><thead><tr><th style={{ textAlign: 'left', padding: 10 }}>Origem</th><th style={{ textAlign: 'right', padding: 10 }}>Cadastros</th><th style={{ textAlign: 'right', padding: 10 }}>Pacientes com atendimento</th><th style={{ textAlign: 'right', padding: 10 }}>Procedimentos</th><th style={{ textAlign: 'right', padding: 10 }}>Valor realizado</th></tr></thead><tbody>{data?.sources.map(row => <tr key={row.source ?? 'not_informed'} data-testid={`acquisition-row-${row.source ?? 'not-informed'}`} style={{ borderTop: '1px solid var(--border)' }}><td style={{ padding: 10 }}><strong>{row.label}</strong></td><td style={{ padding: 10, textAlign: 'right' }}>{row.registrations}</td><td style={{ padding: 10, textAlign: 'right' }}>{row.attended_patients}</td><td style={{ padding: 10, textAlign: 'right' }}>{row.procedures}</td><td style={{ padding: 10, textAlign: 'right' }}>{money(row.production_value)}</td></tr>)}</tbody></table></div>

      <div className="card" style={{ padding: 14 }}><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Users size={17}/><strong>Pacientes que mais indicaram</strong></div><div className="page-sub" style={{ marginTop: 3 }}>Somente vínculos explícitos entre Patients; nomes digitados manualmente não são convertidos em Patient.</div>{(data?.top_referrers.length ?? 0) === 0 ? <div className="empty-state" style={{ padding: '18px 0 4px' }}>Ainda não há indicações canônicas no período.</div> : <div style={{ display: 'grid', gap: 4, marginTop: 10 }}>{data?.top_referrers.map((item, index) => <div key={item.patient_id} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--border)' }}><span className="page-sub">{index + 1}</span><strong>{item.name}</strong><span className="page-sub">{item.referred_registered} indicada{item.referred_registered === 1 ? '' : 's'} cadastrada{item.referred_registered === 1 ? '' : 's'} · {item.referred_with_attendance} com atendimento</span></div>)}</div>}</div>
    </>}
  </div>;
}

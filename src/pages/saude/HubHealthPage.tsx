import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, CheckCircle2, ChevronRight, Database, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGoogleCalendar } from '../../hooks/useGoogleCalendar';
import { useDataQualityIssues, useDataQualitySummary, useDismissDataQualityIssue, usePossibleDuplicatePair } from '../../hooks/useOperational';
import type { DataQualityIssue } from '../../lib/operational';
import { useToast } from '../../hooks/useToast';
import './health.css';

const severityLabel = { ERROR: 'Crítico', WARNING: 'Revisar', INFO: 'Informativo' } as const;
const date = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

function QualityCard({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'ok' }) {
  return <div className={`card health-metric${tone ? ` health-metric--${tone}` : ''}`}><strong>{value}</strong><span>{label}</span></div>;
}

function IssueRow({ issue, onOpen }: { issue: DataQualityIssue; onOpen: () => void }) {
  return <button type="button" className="health-issue" onClick={onOpen}><span className={`health-severity health-severity--${issue.severity.toLowerCase()}`}>{severityLabel[issue.severity]}</span><span className="health-issue-body"><strong>{issue.title}</strong><small>{issue.detail}</small></span><ChevronRight size={16} /></button>;
}

export function HubHealthPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<string | null>(null);
  const summary = useDataQualitySummary();
  const issues = useDataQualityIssues({ severity, search });
  const calendar = useGoogleCalendar();
  const duplicateKey = params.get('issue')?.startsWith('possible_duplicate:') ? params.get('issue') : null;
  const duplicate = usePossibleDuplicatePair(duplicateKey);
  const dismissDuplicate = useDismissDataQualityIssue();

  useEffect(() => { const id = window.setTimeout(() => setSearch(searchDraft.trim().slice(0, 80)), 250); return () => window.clearTimeout(id); }, [searchDraft]);
  const databaseResponding = !summary.isLoading && !summary.error;
  const filteredTitle = useMemo(() => severity ? `${severityLabel[severity as keyof typeof severityLabel] ?? severity}` : 'Itens para revisar', [severity]);
  const closeDuplicate = () => { const next = new URLSearchParams(params); next.delete('issue'); setParams(next, { replace: true }); };
  const markNotDuplicate = async () => {
    if (!duplicateKey) return;
    try { await dismissDuplicate(duplicateKey); toast.success('Par marcado como “não são duplicados”. O alerta não voltará.'); closeDuplicate(); }
    catch { toast.error('Não foi possível salvar a revisão.'); }
  };

  return <div className="page health-page">
    <header className="health-header"><div><span className="page-sub">Administração</span><h1 className="page-title">Saúde do Hub</h1><p className="page-sub">Poucos sinais confiáveis para responder se a operação e os dados precisam de revisão.</p></div><button type="button" className="btn btn--secondary btn--sm" onClick={() => void Promise.all([summary.refetch(), issues.refetch(), calendar.refreshStatus()])}><RefreshCw size={15} /> Verificar agora</button></header>

    <section className="health-status-grid" aria-label="Checks verificáveis">
      <div className="card health-status"><Database size={18} /><span><strong>Database</strong><small>{summary.isLoading ? 'Verificando read models…' : databaseResponding ? 'Read models respondendo' : 'Verificação indisponível'}</small></span>{databaseResponding ? <CheckCircle2 size={17} /> : summary.error ? <AlertTriangle size={17} /> : null}</div>
      <div className="card health-status"><CalendarCheck size={18} /><span><strong>Google Calendar</strong><small>{calendar.loading ? 'Verificando conexão…' : calendar.needsReauth ? 'Precisa reconectar' : calendar.connected ? 'Conectado' : 'Não conectado'}</small></span>{calendar.connected && !calendar.needsReauth ? <CheckCircle2 size={17} /> : !calendar.loading ? <AlertTriangle size={17} /> : null}</div>
      <div className="card health-status"><ShieldCheck size={18} /><span><strong>Qualidade de dados</strong><small>{summary.error ? 'Não foi possível verificar' : 'Detecção somente leitura; sem correção automática'}</small></span></div>
    </section>

    {summary.error ? <div className="dashboard-error" role="alert"><strong>Qualidade de dados indisponível.</strong> O Hub não está convertendo erro em “zero”.</div> : <section className="health-quality" aria-labelledby="health-quality-title"><div className="health-section-heading"><div><h2 id="health-quality-title">Dados</h2><p className="page-sub">INFO é dado incompleto permitido; WARNING merece revisão; ERROR é violação estrutural real.</p></div></div><div className="health-metrics"><QualityCard label="problemas críticos" value={summary.data?.critical ?? 0} tone={(summary.data?.critical ?? 0) === 0 ? 'ok' : 'warning'} /><QualityCard label="itens para revisar" value={summary.data?.warning ?? 0} tone={(summary.data?.warning ?? 0) === 0 ? 'ok' : 'warning'} /><QualityCard label="informativos" value={summary.data?.info ?? 0} /><QualityCard label="possíveis duplicidades" value={summary.data?.possible_duplicate ?? 0} /></div></section>}

    <section className="card health-list-card"><div className="health-list-head"><div><strong>{filteredTitle}</strong><span className="page-sub">Nenhum item é corrigido automaticamente.</span></div><label className="health-search"><Search size={15} /><input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Buscar paciente" /></label></div><div className="health-filters"><button className={!severity ? 'is-active' : ''} onClick={() => setSeverity(null)}>Todos</button><button className={severity === 'ERROR' ? 'is-active' : ''} onClick={() => setSeverity('ERROR')}>Críticos</button><button className={severity === 'WARNING' ? 'is-active' : ''} onClick={() => setSeverity('WARNING')}>Revisar</button><button className={severity === 'INFO' ? 'is-active' : ''} onClick={() => setSeverity('INFO')}>Informativos</button></div>{issues.isLoading ? <div className="health-empty">Carregando diagnósticos…</div> : issues.error ? <div className="health-empty"><AlertTriangle size={20} /> Não foi possível carregar os itens.</div> : issues.data?.length ? <div className="health-issues">{issues.data.map(issue => <IssueRow key={issue.issue_key} issue={issue} onOpen={() => issue.category === 'possible_duplicate' ? setParams(prev => { const next = new URLSearchParams(prev); next.set('issue', issue.issue_key); return next; }) : navigate(issue.route)} />)}</div> : <div className="health-empty"><CheckCircle2 size={20} /> Nenhum item neste filtro.</div>}</section>

    {duplicateKey && <div className="health-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && closeDuplicate()}><section className="health-modal" role="dialog" aria-modal="true" aria-label="Comparar possível duplicidade"><header><div><span className="page-sub">Possível duplicidade</span><h2>Comparar cadastros</h2></div><button type="button" className="icon-btn" onClick={closeDuplicate}><X size={18} /></button></header>{duplicate.isLoading ? <div className="health-empty">Carregando comparação…</div> : duplicate.error || !duplicate.data ? <div className="health-empty">Este par não está mais disponível.</div> : <><div className="health-compare"><div><strong>{duplicate.data.patient_a_name}</strong><dl><div><dt>Telefone</dt><dd>{duplicate.data.patient_a_phone ?? '—'}</dd></div><div><dt>E-mail</dt><dd>{duplicate.data.patient_a_email ?? '—'}</dd></div><div><dt>CPF</dt><dd>{duplicate.data.patient_a_cpf_masked ?? '—'}</dd></div><div><dt>Nascimento</dt><dd>{duplicate.data.patient_a_birth_date ?? '—'}</dd></div><div><dt>Último atendimento</dt><dd>{date(duplicate.data.patient_a_last_appointment_at)}</dd></div><div><dt>Criado</dt><dd>{date(duplicate.data.patient_a_created_at)}</dd></div></dl></div><div><strong>{duplicate.data.patient_b_name}</strong><dl><div><dt>Telefone</dt><dd>{duplicate.data.patient_b_phone ?? '—'}</dd></div><div><dt>E-mail</dt><dd>{duplicate.data.patient_b_email ?? '—'}</dd></div><div><dt>CPF</dt><dd>{duplicate.data.patient_b_cpf_masked ?? '—'}</dd></div><div><dt>Nascimento</dt><dd>{duplicate.data.patient_b_birth_date ?? '—'}</dd></div><div><dt>Último atendimento</dt><dd>{date(duplicate.data.patient_b_last_appointment_at)}</dd></div><div><dt>Criado</dt><dd>{date(duplicate.data.patient_b_created_at)}</dd></div></dl></div></div><div className="health-match-reasons">Coincidência exata: {duplicate.data.match_cpf ? 'CPF ' : ''}{duplicate.data.match_phone ? 'telefone ' : ''}{duplicate.data.match_email ? 'e-mail' : ''}. Nome parecido sozinho nunca cria este alerta.</div><footer><button type="button" className="btn btn--secondary btn--sm" onClick={() => navigate(`/pacientes/${duplicate.data!.patient_a_id}?return_to=/saude`)}>Revisar A</button><button type="button" className="btn btn--secondary btn--sm" onClick={() => navigate(`/pacientes/${duplicate.data!.patient_b_id}?return_to=/saude`)}>Revisar B</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => void markNotDuplicate()}>Não são duplicados</button></footer></>}</section></div>}
  </div>;
}

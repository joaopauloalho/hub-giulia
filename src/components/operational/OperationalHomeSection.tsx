import { AlertTriangle, ArrowRight, CalendarDays, CakeSlice, CheckCircle2, Clock3, HeartHandshake, MessageCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDataQualitySummary, useOperationalHome } from '../../hooks/useOperational';
import { useRelationshipCounts } from '../../hooks/useRelationship';
import { attentionCategoryLabel } from '../../lib/operational';
import './operational.css';

function time(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }

export function OperationalHomeSection({ today }: { today: string }) {
  const navigate = useNavigate();
  const hub = useOperationalHome(today);
  const quality = useDataQualitySummary();
  const relationship = useRelationshipCounts();
  if (hub.error) return <section className="operational-home"><div className="dashboard-error" role="alert"><strong>O resumo operacional está indisponível.</strong> Não foi exibido como zero. <button type="button" className="btn btn--ghost btn--sm" onClick={() => void hub.refresh()}>Tentar novamente</button></div></section>;
  if (hub.loading || !hub.day || !hub.week) return <section className="operational-home"><div className="card operational-loading">Carregando o que precisa de atenção…</div></section>;
  const next = hub.day.next_appointment;
  const relevantCounts = [
    { key: 'agenda', label: 'Atendimentos hoje', value: hub.day.agenda.total, icon: <CalendarDays size={15} />, route: `/agenda?date=${today}` },
    { key: 'birthday', label: 'Aniversariantes hoje', value: relationship.summary.birthday_today, icon: <CakeSlice size={15} />, route: '/relacionamento' },
    { key: 'confirmation', label: 'Aguardando confirmação', value: hub.counts.confirmation, icon: <Clock3 size={15} />, route: '/comunicacao?category=confirmation' },
    { key: 'aftercare', label: 'Pós-atendimento', value: hub.counts.aftercare, icon: <MessageCircle size={15} />, route: '/comunicacao?category=aftercare' },
    { key: 'returns', label: 'Retornos', value: hub.counts.return, icon: <RotateCcw size={15} />, route: '/retornos' },
    { key: 'relationship', label: 'Relacionamento', value: hub.counts.relationship, icon: <HeartHandshake size={15} />, route: '/relacionamento' },
  ].filter(item => item.key === 'agenda' || item.value > 0);
  return <section className="operational-home" aria-labelledby="operational-home-title">
    <div className="operational-heading"><div><h2 id="operational-home-title">Hoje</h2><p className="page-sub">Quem vem, o que exige ação e o que não pode ficar para trás.</p></div><span className="dashboard-snapshot-tag">Agora</span></div>
    <div className="operational-counts">{relevantCounts.map(item => <button type="button" key={item.key} onClick={() => navigate(item.route)}><span>{item.icon}{item.label}</span><strong>{item.value}</strong></button>)}</div>
    {next && <div className="card operational-next"><div className="operational-next-time">{time(next.scheduled_at)}</div><div className="operational-next-body"><span className="page-sub">Próximo atendimento</span><strong>{next.patient_name}</strong><span>{next.service_name ?? 'Serviço não informado'} · {next.status === 'confirmado' ? 'Confirmada' : 'Aguardando confirmação'}</span></div><button type="button" className="btn btn--primary btn--sm" onClick={() => navigate(next.status === 'confirmado' ? next.route : '/comunicacao?category=confirmation')}>{next.status === 'confirmado' ? 'Iniciar atendimento' : 'Confirmar'} <ArrowRight size={14} /></button></div>}
    <div className="operational-grid">
      <div className="card operational-attention-list"><div className="operational-card-head"><div><strong>Precisa da sua atenção</strong><p className="page-sub">Uma fila única, ordenada por prioridade factual.</p></div><span>{hub.counts.total}</span></div>{hub.items.length === 0 ? <div className="operational-clear"><CheckCircle2 size={20} /><span>Nada exige ação agora.</span></div> : <div className="operational-items">{hub.items.map(item => <button type="button" key={item.attention_key} onClick={() => navigate(item.action_route)}><span className={`operational-dot operational-dot--${item.source_priority}`} aria-hidden="true" /><span className="operational-item-body"><small>{attentionCategoryLabel(item.category)}</small><strong>{item.person_name}</strong><span>{item.title}</span></span><span className="operational-action">{item.action_label}<ArrowRight size={13} /></span></button>)}</div>}</div>
      <div className="operational-side">
        <div className="card operational-summary"><strong>Fim do dia</strong><div><span>Agendamentos realizados</span><b>{hub.day.agenda.completed}</b></div><div><span>Procedimentos registrados</span><b>{hub.day.procedures_performed}</b></div>{hub.day.pending_payment > 0 && <div><span>Pagamentos pendentes registrados</span><b>{hub.day.pending_payment}</b></div>}<div><span>Retornos futuros (30 dias)</span><b>{hub.day.future_returns_30d}</b></div>{hub.day.attention_total > 0 && <div className="is-attention"><span>Pendências operacionais agora</span><b>{hub.day.attention_total}</b></div>}</div>
        <div className="card operational-summary"><strong>Próximos 7 dias</strong><div><span>Atendimentos</span><b>{hub.week.appointments}</b></div>{relationship.summary.birthday > 0 && <div><span>Aniversariantes</span><b>{relationship.summary.birthday}</b></div>}{hub.week.overdue_returns > 0 && <div><span>Retornos atrasados</span><b>{hub.week.overdue_returns}</b></div>}{hub.week.aftercare > 0 && <div><span>Acompanhamentos</span><b>{hub.week.aftercare}</b></div>}{hub.week.relationship > 0 && <div><span>Relacionamento</span><b>{hub.week.relationship}</b></div>}{hub.week.expiring_credits > 0 && <div><span>Créditos próximos da validade</span><b>{hub.week.expiring_credits}</b></div>}</div>
        <button type="button" className="card operational-health" onClick={() => navigate('/saude')}><span><ShieldCheck size={17} /><strong>Dados</strong></span>{quality.isLoading ? <small>Verificando…</small> : quality.error ? <small className="is-warning"><AlertTriangle size={13} /> Verificação indisponível</small> : quality.data && quality.data.critical === 0 && quality.data.warning === 0 && quality.data.info === 0 ? <small className="is-ok"><CheckCircle2 size={13} /> Tudo certo</small> : <small className={quality.data?.critical ? 'is-warning' : ''}>{quality.data?.critical ?? 0} críticos · {quality.data?.warning ?? 0} revisar · {quality.data?.info ?? 0} informativos</small>}</button>
      </div>
    </div>
  </section>;
}

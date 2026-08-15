import { AlertTriangle, CalendarDays, ClipboardCheck, CreditCard, FileClock, HeartPulse, History, StickyNote, WalletCards } from 'lucide-react';
import { differenceInCalendarDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Skeleton } from '../../../components/ui/Skeleton';
import { aftercareDate, orientationStatusLabel, usePatientFollowupPlans } from '../../../hooks/useAftercare';
import { usePatient360Overview, usePatientTimeline } from '../../../hooks/usePatient360';
import { usePatientEntitlements, usePatientPackages } from '../../../hooks/usePackages';
import { formatPatientMoney } from '../../../lib/patient360';

interface Props { patientId: string; onAgenda: () => void; onReturns: () => void; onHistory: () => void; onFinance: () => void; onNotes: () => void; onAnamnesis: () => void; onTimeline: () => void; }
const dateTime = (value: string) => format(new Date(value), "dd/MM 'às' HH:mm", { locale: ptBR });
const dateOnly = (value: string) => format(new Date(`${value}T12:00:00`), 'dd/MM/yyyy', { locale: ptBR });
const sourceLabel = (source: string) => ({ proposal: 'Proposta', manual: 'Manual', voucher: 'Voucher', complimentary: 'Cortesia' }[source] ?? source);
const movementLabel = (type: string) => ({ grant: 'Crédito concedido', redeem: 'Crédito utilizado', reversal: 'Crédito estornado', adjustment: 'Ajuste de créditos' }[type] ?? type);

function SummaryCard({ title, icon, children, action, onAction }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: string; onAction?: () => void; }) {
  return <div className="card" style={{ padding: 14, minHeight: 126 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-2)', marginBottom: 9 }}>{icon}<strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</strong></div><div style={{ minHeight: 48 }}>{children}</div>{action && onAction && <button className="btn btn--ghost btn--sm" type="button" onClick={onAction} style={{ marginTop: 8 }}>{action}</button>}</div>;
}

export function OverviewTab(props: Props) {
  const { overview, loading, error } = usePatient360Overview(props.patientId);
  const recent = usePatientTimeline(props.patientId, 4);
  const followup = usePatientFollowupPlans(props.patientId, 5);
  const entitlements = usePatientEntitlements(props.patientId);
  const packageData = usePatientPackages(props.patientId);

  if (loading) return <div style={{ display: 'grid', gap: 10 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>{Array.from({ length: 4 }, (_, index) => <div className="card" key={index} style={{ padding: 14 }}><Skeleton lines={3} /></div>)}</div><div className="card" style={{ padding: 14 }}><Skeleton lines={4} /></div></div>;
  if (error || !overview) return <div className="empty-state"><p>{error ?? 'Não foi possível carregar a paciente.'}</p></div>;

  const expiring = packageData.packages.filter(pkg => pkg.effective_status === 'active' && pkg.valid_until).map(pkg => ({ ...pkg, days: differenceInCalendarDays(new Date(`${pkg.valid_until}T12:00:00`), new Date()) })).filter(pkg => pkg.days >= 0 && pkg.days <= 30).sort((a, b) => a.days - b.days)[0];
  const alerts = [
    expiring ? { key: 'package-expiry', label: `${expiring.package_title} expira em ${expiring.days} dia${expiring.days === 1 ? '' : 's'}`, action: undefined } : null,
    overview.anamnesis.draftInProgress ? { key: 'anamnesis-draft', label: 'Anamnese em atualização — rascunho não concluído', action: props.onAnamnesis } : null,
    overview.priorityReturn?.status === 'overdue' ? { key: 'return', label: 'Retorno atrasado', action: props.onReturns } : null,
    overview.financialSummary.pending > 0 ? { key: 'finance', label: `${formatPatientMoney(overview.financialSummary.pending)} pendente`, action: props.onFinance } : null,
    overview.overdueNotesCount > 0 ? { key: 'note', label: `${overview.overdueNotesCount} lembrete${overview.overdueNotesCount === 1 ? '' : 's'} vencido${overview.overdueNotesCount === 1 ? '' : 's'}`, action: props.onNotes } : null,
    overview.anamnesis.allergies ? { key: 'allergy', label: `Alergia registrada: ${overview.anamnesis.allergies}`, action: props.onAnamnesis } : null,
    overview.anamnesis.medications ? { key: 'medication', label: `Medicação registrada: ${overview.anamnesis.medications}`, action: props.onAnamnesis } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 4);
  const activeEntitlements = entitlements.data.filter(item => item.available_balance > 0 && item.effective_status === 'active');

  return <div style={{ display: 'grid', gap: 12 }}>
    {alerts.length > 0 && <div className="card" style={{ padding: 12 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}><AlertTriangle size={16} /><strong style={{ fontSize: 13 }}>Precisa de atenção</strong></div><div style={{ display: 'grid', gap: 6 }}>{alerts.map(alert => alert.action ? <button key={alert.key} type="button" onClick={alert.action} style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-2)', padding: '9px 10px', textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }}>{alert.label}</button> : <div key={alert.key} style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-2)', padding: '9px 10px', color: 'var(--text)' }}>{alert.label}</div>)}</div></div>}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
      <SummaryCard title="Próxima consulta" icon={<CalendarDays size={15} />} action={overview.nextAppointment ? 'Ver na Agenda' : 'Agendar'} onAction={props.onAgenda}>{overview.nextAppointment ? <><strong style={{ display: 'block' }}>{dateTime(overview.nextAppointment.scheduledAt)}</strong><span className="page-sub">{overview.nextAppointment.serviceName} · {overview.nextAppointment.status}</span></> : <span className="page-sub">Nenhuma consulta futura ativa.</span>}</SummaryCard>
      <SummaryCard title="Retorno" icon={<FileClock size={15} />} action={overview.activeReturnsCount ? 'Ver retornos' : undefined} onAction={props.onReturns}>{overview.activeReturnsCount > 0 ? <><strong style={{ display: 'block' }}>{overview.activeReturnsCount} retorno{overview.activeReturnsCount === 1 ? '' : 's'} ativo{overview.activeReturnsCount === 1 ? '' : 's'}</strong>{overview.priorityReturn && <span className="page-sub">{overview.priorityReturn.serviceName} · {dateOnly(overview.priorityReturn.windowStart)}–{dateOnly(overview.priorityReturn.windowEnd)}</span>}</> : <span className="page-sub">Nenhum retorno ativo.</span>}</SummaryCard>
      <SummaryCard title="Último atendimento" icon={<ClipboardCheck size={15} />} action={overview.lastProcedure ? 'Abrir histórico' : undefined} onAction={props.onHistory}>{overview.lastProcedure ? <><strong style={{ display: 'block' }}>{dateTime(overview.lastProcedure.performedAt)}</strong><span className="page-sub">{overview.lastProcedure.itemNames.join(' + ') || 'Atendimento registrado'}</span></> : <span className="page-sub">Nenhum atendimento realizado.</span>}</SummaryCard>
      <SummaryCard title="Financeiro" icon={<CreditCard size={15} />} action="Ver financeiro" onAction={props.onFinance}><strong style={{ display: 'block' }}>{formatPatientMoney(overview.financialSummary.pending)} pendente</strong><span className="page-sub">Recebido {formatPatientMoney(overview.financialSummary.received)} · Total {formatPatientMoney(overview.financialSummary.total)}</span></SummaryCard>
    </div>

    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><HeartPulse size={16} /><strong style={{ flex: 1, fontSize: 13 }}>Acompanhamento</strong>{!followup.loading && <span className="page-sub">{followup.plans.length} plano{followup.plans.length === 1 ? '' : 's'}</span>}</div>
      {followup.loading ? <Skeleton lines={3} /> : followup.error ? <p className="page-sub">Não foi possível carregar o acompanhamento.</p> : followup.plans.length === 0 ? <p className="page-sub">Nenhum plano pós-atendimento registrado para esta paciente.</p> : <div style={{ display: 'grid', gap: 10 }}>{followup.plans.slice(0, 3).map(plan => <div key={plan.plan_id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 11, background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><strong style={{ fontSize: 13 }}>Procedimento · {aftercareDate(plan.performed_on)}</strong><div className="page-sub">Orientações: {orientationStatusLabel(plan.orientation_status)}</div></div><span className={`badge ${plan.status === 'active' ? 'badge--green' : ''}`}>{plan.status === 'active' ? 'Ativo' : 'Cancelado'}</span></div>
        <div style={{ display: 'grid', gap: 5, marginTop: 9 }}>{plan.tasks.map(task => <div key={task.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}><span>{task.label ?? 'Check-in'} · {aftercareDate(task.due_on)}</span><strong>{task.status === 'completed' ? 'Concluído' : task.status === 'cancelled' ? 'Cancelado' : task.requires_professional_review ? 'Revisar' : 'Pendente'}</strong></div>)}</div>
        {plan.returns.length > 0 && <div className="page-sub" style={{ marginTop: 7 }}>Retorno: {aftercareDate(plan.returns[0].window_start)}–{aftercareDate(plan.returns[0].window_end)} · Returns 2.0</div>}
        {plan.photo_followup && <div className="page-sub" style={{ marginTop: 4 }}>Fotos de evolução lembradas para o acompanhamento · capturar no Photos 2.0 quando aplicável.</div>}
      </div>)}</div>}
    </div>

    <div className="card" style={{ padding: 14 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}><WalletCards size={16} /><strong style={{ flex: 1, fontSize: 13 }}>Pacotes & Créditos</strong>{!entitlements.loading && <span className="page-sub">{activeEntitlements.length} benefício{activeEntitlements.length === 1 ? '' : 's'} ativo{activeEntitlements.length === 1 ? '' : 's'}</span>}</div>{entitlements.loading || packageData.loading ? <Skeleton lines={3} /> : entitlements.data.length === 0 ? <p className="page-sub">A paciente ainda não possui pacotes ou créditos.</p> : <div style={{ display: 'grid', gap: 10 }}>
      {packageData.packages.slice(0, 6).map(pkg => { const items = entitlements.data.filter(item => item.package_id === pkg.package_id); return <div key={pkg.package_id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 11, background: 'var(--bg-2)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}><div><strong style={{ fontSize: 13 }}>{pkg.package_title}</strong><div className="page-sub">Origem: {sourceLabel(pkg.source_type)}{pkg.valid_until ? ` · válido até ${dateOnly(pkg.valid_until)}` : ''}</div></div><span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: pkg.effective_status === 'active' ? 'var(--green)' : 'var(--text-3)' }}>{pkg.effective_status === 'active' ? 'Ativo' : pkg.effective_status === 'completed' ? 'Concluído' : pkg.effective_status === 'expired' ? 'Expirado' : pkg.effective_status === 'draft' ? 'Pendente' : 'Anulado'}</span></div><div style={{ display: 'grid', gap: 5 }}>{items.map(item => <div key={item.package_item_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}><span>{item.service_name_snapshot}</span><strong>{item.available_balance.toLocaleString('pt-BR')} de {item.quantity_granted.toLocaleString('pt-BR')} disponível{item.available_balance === 1 ? '' : 'is'}</strong></div>)}</div></div>; })}
      {packageData.ledger.length > 0 && <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}><History size={14} /><strong style={{ fontSize: 12 }}>Movimentações recentes</strong></div><div style={{ display: 'grid', gap: 6 }}>{packageData.ledger.slice(0, 5).map(movement => <div key={movement.id} style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 7, alignItems: 'center', fontSize: 12 }}><span className="page-sub">{format(new Date(movement.created_at), 'dd/MM HH:mm')}</span><span>{movementLabel(movement.movement_type)}{movement.reason ? ` · ${movement.reason}` : ''}</span><strong style={{ color: movement.quantity_delta > 0 ? 'var(--green)' : 'var(--text)' }}>{movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta.toLocaleString('pt-BR')}</strong></div>)}</div></div>}
    </div>}</div>

    <div className="card" style={{ padding: 14 }}><div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><StickyNote size={15} /><strong style={{ flex: 1, fontSize: 13 }}>Últimas interações</strong><button className="btn btn--ghost btn--sm" onClick={props.onTimeline}>Ver histórico 360</button></div>{recent.loading ? <Skeleton lines={3} /> : recent.error ? <p className="page-sub">Não foi possível carregar as interações.</p> : recent.events.length === 0 ? <p className="page-sub">Ainda não há interações registradas.</p> : <div style={{ display: 'grid', gap: 8 }}>{recent.events.map(event => <div key={event.eventKey} style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}><span className="page-sub">{format(new Date(event.occurredAt), 'dd/MM HH:mm')}</span><div><strong style={{ fontSize: 13 }}>{event.title}</strong>{event.subtitle && <div className="page-sub">{event.subtitle}</div>}</div></div>)}</div>}</div>
  </div>;
}

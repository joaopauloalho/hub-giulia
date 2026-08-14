import { AlertTriangle, CalendarDays, ClipboardCheck, CreditCard, FileClock, StickyNote } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Skeleton } from '../../../components/ui/Skeleton';
import { usePatient360Overview, usePatientTimeline } from '../../../hooks/usePatient360';
import { formatPatientMoney } from '../../../lib/patient360';

interface Props {
  patientId: string;
  onAgenda: () => void;
  onReturns: () => void;
  onHistory: () => void;
  onFinance: () => void;
  onNotes: () => void;
  onAnamnesis: () => void;
  onTimeline: () => void;
}

const dateTime = (value: string) => format(new Date(value), "dd/MM 'às' HH:mm", { locale: ptBR });
const dateOnly = (value: string) => format(new Date(`${value}T12:00:00`), 'dd/MM/yyyy', { locale: ptBR });

function SummaryCard({ title, icon, children, action, onAction }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return <div className="card" style={{ padding: 14, minHeight: 126 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-2)', marginBottom: 9 }}>
      {icon}<strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{title}</strong>
    </div>
    <div style={{ minHeight: 48 }}>{children}</div>
    {action && onAction && <button className="btn btn--ghost btn--sm" type="button" onClick={onAction} style={{ marginTop: 8 }}>{action}</button>}
  </div>;
}

export function OverviewTab(props: Props) {
  const { overview, loading, error } = usePatient360Overview(props.patientId);
  const recent = usePatientTimeline(props.patientId, 4);

  if (loading) {
    return <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        {Array.from({ length: 4 }, (_, index) => <div className="card" key={index} style={{ padding: 14 }}><Skeleton lines={3} /></div>)}
      </div>
      <div className="card" style={{ padding: 14 }}><Skeleton lines={4} /></div>
    </div>;
  }

  if (error || !overview) return <div className="empty-state"><p>{error ?? 'Não foi possível carregar a paciente.'}</p></div>;

  const alerts = [
    overview.anamnesis.draftInProgress ? { key: 'anamnesis-draft', label: 'Anamnese em atualização — rascunho não concluído', action: props.onAnamnesis } : null,
    overview.priorityReturn?.status === 'overdue' ? { key: 'return', label: 'Retorno atrasado', action: props.onReturns } : null,
    overview.financialSummary.pending > 0 ? { key: 'finance', label: `${formatPatientMoney(overview.financialSummary.pending)} pendente`, action: props.onFinance } : null,
    overview.overdueNotesCount > 0 ? { key: 'note', label: `${overview.overdueNotesCount} lembrete${overview.overdueNotesCount === 1 ? '' : 's'} vencido${overview.overdueNotesCount === 1 ? '' : 's'}`, action: props.onNotes } : null,
    overview.anamnesis.allergies ? { key: 'allergy', label: `Alergia registrada: ${overview.anamnesis.allergies}`, action: props.onAnamnesis } : null,
    overview.anamnesis.medications ? { key: 'medication', label: `Medicação registrada: ${overview.anamnesis.medications}`, action: props.onAnamnesis } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 4);

  return <div style={{ display: 'grid', gap: 12 }}>
    {alerts.length > 0 && <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}><AlertTriangle size={16} /><strong style={{ fontSize: 13 }}>Precisa de atenção</strong></div>
      <div style={{ display: 'grid', gap: 6 }}>{alerts.map(alert => <button key={alert.key} type="button" onClick={alert.action} style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-2)', padding: '9px 10px', textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }}>{alert.label}</button>)}</div>
    </div>}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
      <SummaryCard title="Próxima consulta" icon={<CalendarDays size={15} />} action={overview.nextAppointment ? 'Ver na Agenda' : 'Agendar'} onAction={props.onAgenda}>
        {overview.nextAppointment ? <><strong style={{ display: 'block' }}>{dateTime(overview.nextAppointment.scheduledAt)}</strong><span className="page-sub">{overview.nextAppointment.serviceName} · {overview.nextAppointment.status}</span></> : <span className="page-sub">Nenhuma consulta futura ativa.</span>}
      </SummaryCard>

      <SummaryCard title="Retorno" icon={<FileClock size={15} />} action={overview.activeReturnsCount ? 'Ver retornos' : undefined} onAction={props.onReturns}>
        {overview.activeReturnsCount > 0 ? <><strong style={{ display: 'block' }}>{overview.activeReturnsCount} retorno{overview.activeReturnsCount === 1 ? '' : 's'} ativo{overview.activeReturnsCount === 1 ? '' : 's'}</strong>{overview.priorityReturn && <span className="page-sub">{overview.priorityReturn.serviceName} · {dateOnly(overview.priorityReturn.windowStart)}–{dateOnly(overview.priorityReturn.windowEnd)}</span>}</> : <span className="page-sub">Nenhum retorno ativo.</span>}
      </SummaryCard>

      <SummaryCard title="Último atendimento" icon={<ClipboardCheck size={15} />} action={overview.lastProcedure ? 'Abrir histórico' : undefined} onAction={props.onHistory}>
        {overview.lastProcedure ? <><strong style={{ display: 'block' }}>{dateTime(overview.lastProcedure.performedAt)}</strong><span className="page-sub">{overview.lastProcedure.itemNames.join(' + ') || 'Atendimento registrado'}</span></> : <span className="page-sub">Nenhum atendimento realizado.</span>}
      </SummaryCard>

      <SummaryCard title="Financeiro" icon={<CreditCard size={15} />} action="Ver financeiro" onAction={props.onFinance}>
        <strong style={{ display: 'block' }}>{formatPatientMoney(overview.financialSummary.pending)} pendente</strong>
        <span className="page-sub">Recebido {formatPatientMoney(overview.financialSummary.received)} · Total {formatPatientMoney(overview.financialSummary.total)}</span>
      </SummaryCard>
    </div>

    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}><StickyNote size={15} /><strong style={{ flex: 1, fontSize: 13 }}>Últimas interações</strong><button className="btn btn--ghost btn--sm" onClick={props.onTimeline}>Ver histórico 360</button></div>
      {recent.loading ? <Skeleton lines={3} /> : recent.error ? <p className="page-sub">Não foi possível carregar as interações.</p> : recent.events.length === 0 ? <p className="page-sub">Ainda não há interações registradas.</p> : <div style={{ display: 'grid', gap: 8 }}>{recent.events.map(event => <div key={event.eventKey} style={{ display: 'grid', gridTemplateColumns: '82px 1fr', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}><span className="page-sub">{format(new Date(event.occurredAt), 'dd/MM HH:mm')}</span><div><strong style={{ fontSize: 13 }}>{event.title}</strong>{event.subtitle && <div className="page-sub">{event.subtitle}</div>}</div></div>)}</div>}
    </div>
  </div>;
}

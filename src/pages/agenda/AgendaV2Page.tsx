import { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAgenda, type AgendaAppointment, type AgendaStatus } from '../../hooks/useAgenda';
import { useGoogleCalendar } from '../../hooks/useGoogleCalendar';
import { useRetornos } from '../../hooks/useRetornos';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { addIsoDays, addIsoMonths, agendaRange, clinicDateIso, clinicTime, startOfClinicMonth, startOfClinicWeek } from '../../lib/agendaTime';
import { AgendaFormDrawer } from './AgendaFormDrawer';
import { AppointmentDetailDrawer } from './AppointmentDetailDrawer';
import { AGENDA_STATUS_BAR, AGENDA_STATUS_LABEL, agendaStatusStyle } from './agendaStyles';

type View = 'day' | 'week' | 'month';
type Filter = 'all' | AgendaStatus;
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

function Event({ appointment, onOpen }: { appointment: AgendaAppointment; onOpen: () => void }) {
  const duration = appointment.duration_minutes ?? appointment.service?.duration_minutes ?? 60;
  return <button type="button" onClick={onOpen} style={{ width: '100%', textAlign: 'left', padding: 9, borderRadius: 9, border: '1px solid var(--border)', borderLeft: `4px solid ${AGENDA_STATUS_BAR[appointment.status]}`, background: '#fff', cursor: 'pointer' }}><div style={{ display: 'flex', gap: 8 }}><strong style={{ flex: 1 }}>{appointment.patient?.name ?? 'Paciente'}</strong><strong style={{ color: 'var(--primary)', fontSize: 12 }}>{clinicTime(appointment.scheduled_at)}</strong></div><div className="page-sub">{appointment.service?.name ?? 'Consulta'} · {duration} min</div><span style={{ ...agendaStatusStyle[appointment.status], display: 'inline-block', marginTop: 5, padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>{AGENDA_STATUS_LABEL[appointment.status]}</span></button>;
}

export function AgendaV2Page() {
  const { toast } = useToast();
  const [view, setView] = useState<View>(() => window.matchMedia('(max-width: 767px)').matches ? 'day' : 'week');
  const [anchor, setAnchor] = useState(clinicDateIso());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ date: string; time: string; appointment: AgendaAppointment | null } | null>(null);
  const [detail, setDetail] = useState<AgendaAppointment | null>(null);
  const range = useMemo(() => agendaRange(anchor, view), [anchor, view]);
  const agenda = useAgenda({ from: range.from, to: range.to });
  const { servicos } = useServicos();
  const { retornos } = useRetornos(servicos);
  const google = useGoogleCalendar();
  const mobile = window.matchMedia('(max-width: 767px)').matches;

  const rows = useMemo(() => agenda.agendamentos.filter(appointment => {
    if (filter !== 'all' && appointment.status !== filter) return false;
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return !term || `${appointment.patient?.name ?? ''} ${appointment.patient?.phone ?? ''}`.toLocaleLowerCase('pt-BR').includes(term);
  }), [agenda.agendamentos, filter, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AgendaAppointment[]>();
    rows.forEach(appointment => {
      const date = clinicDateIso(appointment.scheduled_at);
      groups.set(date, [...(groups.get(date) ?? []), appointment]);
    });
    return groups;
  }, [rows]);

  const counts = {
    total: agenda.agendamentos.length,
    confirmado: agenda.agendamentos.filter(item => item.status === 'confirmado').length,
    realizado: agenda.agendamentos.filter(item => item.status === 'realizado').length,
    pendente: agenda.agendamentos.filter(item => item.status === 'pendente').length,
  };

  const start = view === 'week' ? startOfClinicWeek(anchor) : startOfClinicMonth(anchor);
  const days = view === 'week'
    ? Array.from({ length: 7 }, (_, index) => addIsoDays(start, index))
    : Array.from({ length: Math.round((noon(addIsoMonths(start, 1)).getTime() - noon(start).getTime()) / 86400000) }, (_, index) => addIsoDays(start, index));
  const returnIds = new Set(retornos.map(item => item.appointmentId).filter(Boolean));
  const openCreate = (date = anchor, time = '09:00') => setForm({ date, time, appointment: null });
  const move = (delta: number) => setAnchor(view === 'day' ? addIsoDays(anchor, delta) : view === 'week' ? addIsoDays(anchor, delta * 7) : addIsoMonths(anchor, delta));

  return <div className="page">
    <div className="page-header"><div><h1 className="page-title">Agenda</h1><p className="page-sub">{view === 'day' ? format(noon(anchor), "d 'de' MMMM", { locale: ptBR }) : view === 'week' ? `${format(noon(startOfClinicWeek(anchor)), 'd MMM', { locale: ptBR })} – ${format(noon(addIsoDays(startOfClinicWeek(anchor), 6)), 'd MMM', { locale: ptBR })}` : format(noon(startOfClinicMonth(anchor)), 'MMMM yyyy', { locale: ptBR })}</p></div><button className="btn btn--primary btn--md" onClick={() => openCreate()}><Plus size={16} /> Nova consulta</button></div>

    <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><button className="icon-btn" onClick={() => move(-1)}><ChevronLeft size={18} /></button><button className="btn btn--secondary btn--sm" onClick={() => setAnchor(clinicDateIso())}>Hoje</button><button className="icon-btn" onClick={() => move(1)}><ChevronRight size={18} /></button><div style={{ flex: 1 }} />{(['day', 'week', 'month'] as View[]).filter(option => !(mobile && option === 'week')).map(option => <button key={option} className={`btn btn--sm ${view === option ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setView(option)}>{option === 'day' ? 'Dia' : option === 'week' ? 'Semana' : 'Mês'}</button>)}</div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px,1fr))', gap: 8, marginBottom: 10 }}><div className="card" style={{ padding: 10 }}><strong>{counts.total}</strong><div className="page-sub">Agendadas</div></div><div className="card" style={{ padding: 10 }}><strong>{counts.confirmado}</strong><div className="page-sub">Confirmadas</div></div><div className="card" style={{ padding: 10 }}><strong>{counts.realizado}</strong><div className="page-sub">Realizadas</div></div><div className="card" style={{ padding: 10 }}><strong>{counts.pendente}</strong><div className="page-sub">Pendentes</div></div></div>

    {!google.loading && (!google.connected || google.needsReauth) && <div className="card" style={{ padding: 10, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}><Calendar size={16} /><span style={{ flex: 1, fontSize: 12 }}>{google.needsReauth ? 'Google Calendar precisa ser reconectado. A Agenda local continua funcionando.' : 'Google Calendar desconectado. A Agenda local continua funcionando.'}</span><button className="btn btn--ghost btn--sm" onClick={() => void google.connect().catch(error => toast.error(error instanceof Error ? error.message : 'Falha ao conectar.'))}>{google.needsReauth ? 'Reconectar' : 'Conectar'}</button></div>}

    <div className="card" style={{ padding: 10, marginBottom: 10 }}><div style={{ position: 'relative', marginBottom: 8 }}><Search size={16} style={{ position: 'absolute', left: 11, top: 12 }} /><input className="field-input" style={{ paddingLeft: 34 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar paciente ou telefone" /></div><div style={{ display: 'flex', gap: 5, overflowX: 'auto' }}>{(['all','pendente','confirmado','realizado','cancelado','nao_compareceu'] as Filter[]).map(status => <button key={status} className={`btn btn--sm ${filter === status ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setFilter(status)}>{status === 'all' ? 'Todos' : AGENDA_STATUS_LABEL[status]}</button>)}</div></div>

    {agenda.loading ? <div style={{ display: 'grid', gap: 8 }}><div className="card"><strong>Carregando agenda…</strong></div></div> : agenda.error ? <div className="empty-state"><p>{agenda.error}</p><button className="btn btn--secondary btn--sm" onClick={() => void agenda.refresh()}>Tentar novamente</button></div> : view === 'day' ? <div style={{ display: 'grid', gap: 8 }}>{(grouped.get(anchor) ?? []).map(item => <Event key={item.id} appointment={item} onOpen={() => setDetail(item)} />)}{!(grouped.get(anchor)?.length) && <div className="empty-state"><p>Nenhum atendimento agendado para este dia.</p><button className="btn-primary" onClick={() => openCreate()}>Agendar consulta</button></div>}</div> : <div style={{ display: 'grid', gridTemplateColumns: view === 'week' && !mobile ? 'repeat(7,minmax(135px,1fr))' : 'repeat(auto-fit,minmax(150px,1fr))', gap: 7, overflowX: 'auto' }}>{days.map(day => { const items = grouped.get(day) ?? []; if (view === 'month' && mobile && !items.length) return null; return <div className="card" key={day} style={{ padding: 8, minHeight: view === 'week' ? 180 : 90 }}><button type="button" onClick={() => { setAnchor(day); setView('day'); }} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 700 }}>{format(noon(day), view === 'week' ? 'EEE d' : 'd', { locale: ptBR })}</button><div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{items.slice(0, view === 'month' ? 3 : items.length).map(item => <Event key={item.id} appointment={item} onOpen={() => setDetail(item)} />)}</div>{view === 'month' && items.length > 3 && <div className="page-sub">+{items.length - 3}</div>}</div>; })}</div>}

    {form && <AgendaFormDrawer initialDate={form.date} initialTime={form.time} appointment={form.appointment} findConflict={agenda.findConflict} onCreate={agenda.create} onUpdate={agenda.update} onClose={() => setForm(null)} />}
    {detail && <AppointmentDetailDrawer appointment={detail} isReturn={detail.source === 'return' || returnIds.has(detail.id)} googleConnected={google.connected} needsReauth={google.needsReauth} onEdit={() => { const item = detail; setDetail(null); setForm({ date: clinicDateIso(item.scheduled_at), time: clinicTime(item.scheduled_at), appointment: item }); }} onConfirm={() => agenda.confirm(detail.id)} onCancel={reason => agenda.cancel(detail.id, reason)} onNoShow={() => agenda.markNoShow(detail.id)} onRetryGoogle={() => agenda.retryGoogle(detail.id)} onClose={() => { setDetail(null); void agenda.refresh(); }} />}
    <button className="fab" onClick={() => openCreate()} aria-label="Nova consulta"><Plus size={26} /></button>
  </div>;
}

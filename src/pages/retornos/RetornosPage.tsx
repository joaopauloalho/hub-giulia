import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { buildWhatsAppUrl } from '../../lib/whatsapp';
import { clinicTodayIso } from '../../lib/returnStatus';
import { useRetornos, type RetornoInfo } from '../../hooks/useRetornos';
import { useAgenda } from '../../hooks/useAgenda';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { Skeleton } from '../../components/ui/Skeleton';
import { RetornoCard } from './RetornoCard';
import { ReturnScheduleDrawer } from './ReturnScheduleDrawer';

type Filter = 'all' | 'in_window' | 'overdue' | 'upcoming' | 'scheduled' | 'completed';
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'in_window', label: 'Na janela' },
  { value: 'overdue', label: 'Atrasados' },
  { value: 'upcoming', label: 'Próximos' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'completed', label: 'Concluídos' },
];

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '34px 20px' }}>
      <Clock3 size={28} style={{ margin: '0 auto 10px', color: 'var(--primary-lt)' }} />
      <strong style={{ display: 'block' }}>{title}</strong>
      <span className="page-sub" style={{ display: 'block', marginTop: '5px' }}>{detail}</span>
    </div>
  );
}

export function RetornosPage() {
  const navigate = useNavigate();
  const { toast, confirm } = useToast();
  const { servicos } = useServicos();
  const { retornos, loading, error, refresh, markContacted, complete, dismiss } = useRetornos();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [scheduleReturn, setScheduleReturn] = useState<RetornoInfo | null>(null);
  const [scheduleDate, setScheduleDate] = useState(clinicTodayIso());
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduling, setScheduling] = useState(false);
  const agenda = useAgenda(new Date(`${scheduleDate}T12:00:00`));

  const serviceOptions = useMemo(
    () => Array.from(new Set(retornos.map(item => item.serviceName))).sort(),
    [retornos],
  );

  const base = useMemo(() => retornos.filter(item => {
    const query = search.trim().toLocaleLowerCase('pt-BR');
    if (query && !`${item.patientName} ${item.serviceName}`.toLocaleLowerCase('pt-BR').includes(query)) return false;
    if (service && item.serviceName !== service) return false;
    if (fromDate && item.procedureDate < fromDate) return false;
    if (toDate && item.procedureDate > toDate) return false;
    return true;
  }), [retornos, search, service, fromDate, toDate]);

  const filtered = useMemo(() => base.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'in_window') return !item.completedAt && !item.dismissedAt && item.operationalStatus !== 'scheduled' && ['available', 'due_soon'].includes(item.temporalStatus);
    if (filter === 'overdue') return !item.completedAt && !item.dismissedAt && item.operationalStatus !== 'scheduled' && item.temporalStatus === 'overdue';
    if (filter === 'upcoming') return !item.completedAt && !item.dismissedAt && item.operationalStatus !== 'scheduled' && item.temporalStatus === 'waiting';
    if (filter === 'scheduled') return item.operationalStatus === 'scheduled';
    return item.operationalStatus === 'completed' || item.operationalStatus === 'dismissed';
  }), [base, filter]);

  const attention = base.filter(item => item.needsAttention);
  const upcoming = base.filter(item => !item.completedAt && !item.dismissedAt && item.operationalStatus !== 'scheduled' && item.temporalStatus === 'waiting');
  const scheduled = base.filter(item => item.operationalStatus === 'scheduled');
  const history = base.filter(item => item.operationalStatus === 'completed' || item.operationalStatus === 'dismissed');

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : 'Não foi possível atualizar o retorno.');
    }
  };

  const openSchedule = (item: RetornoInfo) => {
    const today = clinicTodayIso();
    setScheduleDate(item.windowStartIso > today ? item.windowStartIso : today);
    setScheduleTime('09:00');
    setScheduleReturn(item);
  };

  const submitSchedule = async () => {
    if (!scheduleReturn) return;
    const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
    const serviceRow = servicos.find(item => item.id === scheduleReturn.serviceId);
    setScheduling(true);
    try {
      const conflict = await agenda.findConflict(scheduledAt, serviceRow?.duration_minutes ?? 60);
      if (conflict) {
        const proceed = await confirm({
          title: 'Conflito de horário',
          message: `Já existe um agendamento nesse horário para ${conflict.patient?.name ?? 'outra paciente'}. Deseja continuar?`,
          confirmLabel: 'Continuar',
          cancelLabel: 'Revisar',
          tone: 'warning',
        });
        if (!proceed) return;
      }
      const { data, error: scheduleError } = await supabase.rpc('schedule_procedure_return_v2', {
        p_return_id: scheduleReturn.id,
        p_scheduled_at: scheduledAt,
        p_notes: `Retorno: ${scheduleReturn.serviceName}`,
      });
      if (scheduleError) throw scheduleError;
      const appointment = data as { id?: string } | null;
      if (!appointment?.id) throw new Error('Agendamento criado sem identificação.');
      void supabase.functions.invoke('google-calendar-upsert', { body: { appointment_id: appointment.id } }).catch(() => undefined);
      setScheduleReturn(null);
      await refresh();
      toast.success('Retorno agendado e vinculado à Agenda.');
    } catch (scheduleError) {
      console.error('[retornos] schedule failed', scheduleError);
      toast.error('Não foi possível agendar o retorno.');
    } finally {
      setScheduling(false);
    }
  };

  const openWhatsApp = (item: RetornoInfo) => {
    if (!item.patientPhone) return;
    const message = item.returnType === 'clinical_return'
      ? `Olá ${item.patientName}! 🌷 Está chegando o período ideal para avaliarmos seu retorno de ${item.serviceName}. Quando puder, me chama por aqui para combinarmos.`
      : `Olá ${item.patientName}! 🌷 Está chegando o período recomendado para sua próxima sessão de ${item.serviceName}. Quando puder, me chama por aqui para combinarmos.`;
    window.open(buildWhatsAppUrl(item.patientPhone, message), '_blank', 'noopener,noreferrer');
  };

  const card = (item: RetornoInfo) => (
    <RetornoCard
      key={item.id}
      item={item}
      onPatient={() => navigate(`/pacientes?patient_id=${item.patientId}`)}
      onContact={() => void runAction(() => markContacted(item.id, 'whatsapp'), 'Paciente marcada como contatada.')}
      onWhatsApp={() => openWhatsApp(item)}
      onSchedule={() => openSchedule(item)}
      onAgenda={() => navigate('/agenda')}
      onComplete={() => void runAction(() => complete(item.id), 'Retorno concluído.')}
      onDismiss={() => void (async () => {
        const ok = await confirm({
          title: 'Dispensar retorno',
          message: 'O retorno sairá da fila ativa, mas continuará disponível no histórico.',
          confirmLabel: 'Dispensar',
          cancelLabel: 'Cancelar',
          tone: 'danger',
        });
        if (ok) await runAction(() => dismiss(item.id, null), 'Retorno dispensado.');
      })()}
    />
  );

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Retornos</h1><p className="page-sub">Quem precisa da minha atenção hoje?</p></div>
        <span className="badge badge--rose">{attention.length} para atenção</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <div className="card" style={{ padding: '14px' }}><strong>{attention.length}</strong><div className="page-sub">Precisa atenção</div></div>
        <div className="card" style={{ padding: '14px' }}><strong>{upcoming.length}</strong><div className="page-sub">Próximos</div></div>
        <div className="card" style={{ padding: '14px' }}><strong>{scheduled.length}</strong><div className="page-sub">Agendados</div></div>
      </div>

      <div className="card" style={{ padding: '14px', marginBottom: '16px' }}>
        <div className="returns-filters-grid">
          <div style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', left: '12px', top: '14px', color: 'var(--text-3)' }} /><input className="field-input" style={{ paddingLeft: '36px' }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar paciente ou serviço" /></div>
          <select className="field-input" value={service} onChange={e => setService(e.target.value)}><option value="">Todos os serviços</option>{serviceOptions.map(name => <option key={name} value={name}>{name}</option>)}</select>
          <input className="field-input" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} aria-label="Procedimentos a partir de" />
          <input className="field-input" type="date" value={toDate} onChange={e => setToDate(e.target.value)} aria-label="Procedimentos até" />
        </div>
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginTop: '10px' }}>
          {FILTERS.map(option => <button key={option.value} className={`btn btn--sm ${filter === option.value ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setFilter(option.value)}>{option.label}</button>)}
        </div>
      </div>

      {loading && <div style={{ display: 'grid', gap: '10px' }}><Skeleton height={180} /><Skeleton height={180} /></div>}
      {!loading && error && <div className="card" style={{ textAlign: 'center' }}><p style={{ color: 'var(--red)', marginBottom: '12px' }}>{error}</p><button className="btn btn--sm btn--secondary" onClick={() => void refresh()}>Tentar novamente</button></div>}
      {!loading && !error && filter !== 'all' && <div style={{ display: 'grid', gap: '10px' }}>{filtered.map(card)}{filtered.length === 0 && <EmptyState title="Nenhum retorno neste filtro." detail="Ajuste os filtros ou acompanhe a fila principal." />}</div>}
      {!loading && !error && filter === 'all' && (
        <div style={{ display: 'grid', gap: '24px' }}>
          {base.length === 0 && <EmptyState title="Nenhum retorno precisa de atenção hoje." detail="Os próximos retornos aparecerão aqui conforme os atendimentos forem realizados." />}
          {attention.length > 0 && <section><h2 className="card-title">Precisa de atenção</h2><div style={{ display: 'grid', gap: '10px' }}>{attention.map(card)}</div></section>}
          {upcoming.length > 0 && <section><h2 className="card-title">Próximos</h2><div style={{ display: 'grid', gap: '10px' }}>{upcoming.map(card)}</div></section>}
          {scheduled.length > 0 && <section><h2 className="card-title">Agendados</h2><div style={{ display: 'grid', gap: '10px' }}>{scheduled.map(card)}</div></section>}
          {history.length > 0 && <section><h2 className="card-title">Concluídos / histórico</h2><div style={{ display: 'grid', gap: '10px' }}>{history.map(card)}</div></section>}
        </div>
      )}

      {scheduleReturn && <ReturnScheduleDrawer item={scheduleReturn} date={scheduleDate} time={scheduleTime} saving={scheduling} onDate={setScheduleDate} onTime={setScheduleTime} onSave={() => void submitSchedule()} onClose={() => setScheduleReturn(null)} />}
    </div>
  );
}

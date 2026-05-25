import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, endOfMonth, format, startOfDay, startOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarClock, ChevronRight, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import { useAgenda } from '../../hooks/useAgenda';
import { useFinanceiro } from '../../hooks/useFinanceiro';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useRetornos } from '../../hooks/useRetornos';
import { Skeleton } from '../../components/ui/Skeleton';
import { supabase } from '../../lib/supabase';

function currency(value: number) {
  return `R$ ${value.toFixed(2)}`;
}

function KpiCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: 'var(--primary)', display: 'flex' }}>{icon}</span>
        <h2 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [today] = useState(() => startOfDay(new Date()));
  const tomorrow = startOfDay(addDays(today, 1));
  const { agendamentos: todayAppointments, loading: loadingToday } = useAgenda(today);
  const { agendamentos: tomorrowAppointments } = useAgenda(tomorrow);
  const { summary, procedures, loading: loadingFinanceiro } = useFinanceiro(today);
  const { summary: previousSummary } = useFinanceiro(subMonths(today, 1));
  const { total, loading: loadingPacientes } = usePacientes({ pageSize: 50 });
  const [monthPatients, setMonthPatients] = useState(0);
  const { servicos } = useServicos();
  const { retornos } = useRetornos(servicos);

  const now = new Date();
  const nextAppointment = todayAppointments
    .filter(item => new Date(item.scheduled_at) >= now && item.status !== 'cancelado')
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
  const uniqueToday = new Set(todayAppointments.map(item => item.patient_id)).size;
  const urgentReturns = retornos.filter(item => item.status === 'overdue' || item.status === 'in_window' || item.status === 'upcoming');
  const visibleReturns = urgentReturns.slice(0, 3);
  const next48h = [...todayAppointments, ...tomorrowAppointments]
    .filter(item => item.status !== 'cancelado' && new Date(item.scheduled_at) >= now)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 5);

  useEffect(() => {
    const start = startOfMonth(today).toISOString();
    const end = endOfMonth(today).toISOString();
    supabase
      .from('patients')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lte('created_at', end)
      .then(({ count }) => setMonthPatients(count ?? 0));
  }, [today]);

  const variation = previousSummary.receitaTotal > 0
    ? ((summary.receitaTotal - previousSummary.receitaTotal) / previousSummary.receitaTotal) * 100
    : summary.receitaTotal > 0 ? 100 : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">{format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, paddingBottom: 80 }}>
        <KpiCard title="Hoje" icon={<CalendarClock size={18} />}>
          {loadingToday ? <Skeleton lines={3} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-3)' }}>Proxima consulta</div>
                <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                  {nextAppointment ? `${format(new Date(nextAppointment.scheduled_at), 'HH:mm')} - ${nextAppointment.patient?.name ?? 'Paciente'}` : 'Nenhuma consulta futura hoje'}
                </div>
                {nextAppointment?.service && <div style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>{nextAppointment.service.name}</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <strong>{todayAppointments.length}<span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 500 }}>consultas hoje</span></strong>
                <strong>{uniqueToday}<span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 500 }}>pacientes unicas</span></strong>
              </div>
            </div>
          )}
        </KpiCard>

        <KpiCard title="Mes atual" icon={<Wallet size={18} />}>
          {loadingFinanceiro ? <Skeleton lines={4} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <strong style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>{currency(summary.receitaTotal)}</strong>
              <span style={{ fontSize: '0.84rem', color: 'var(--text-2)' }}>Recebido {currency(summary.recebido)} · Pendente {currency(summary.pendente)}</span>
              <span style={{ fontSize: '0.84rem', color: summary.lucro >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>Lucro estimado {currency(summary.lucro)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: variation >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.82rem', fontWeight: 700 }}>
                {variation >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {Math.abs(variation).toFixed(1)}% vs mes anterior
              </span>
            </div>
          )}
        </KpiCard>

        <KpiCard title="Pacientes" icon={<Users size={18} />}>
          {loadingPacientes ? <Skeleton lines={3} /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <strong>{total}<span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 500 }}>total</span></strong>
              <strong>{monthPatients}<span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 500 }}>novas</span></strong>
              <strong>{procedures.length}<span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-3)', fontWeight: 500 }}>atendimentos</span></strong>
            </div>
          )}
        </KpiCard>

        <KpiCard title="Retornos urgentes" icon={<ChevronRight size={18} />}>
          {visibleReturns.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '0.86rem' }}>Nenhum retorno urgente.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleReturns.map(item => (
                <div key={item.patientId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{item.patientName}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--amber)' }}>{item.daysLabel}</div>
                  </div>
                  <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/pacientes?patient_id=${item.patientId}`)}>Ver ficha</button>
                </div>
              ))}
              {urgentReturns.length > 3 && <button className="btn btn--ghost btn--sm" onClick={() => navigate('/agenda')}>Ver todos ({urgentReturns.length})</button>}
            </div>
          )}
        </KpiCard>

        <KpiCard title="Proximas 48h" icon={<CalendarClock size={18} />}>
          {next48h.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: '0.86rem' }}>Sem agendamentos proximos.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {next48h.map(item => (
                <button key={item.id} onClick={() => navigate(`/pacientes?patient_id=${item.patient_id}&appointment_id=${item.id}`)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--border)', background: 'var(--bg-2)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontWeight: 700 }}>{format(new Date(item.scheduled_at), 'dd/MM HH:mm')}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.patient?.name ?? 'Paciente'}</span>
                  <ChevronRight size={15} style={{ color: 'var(--text-3)' }} />
                </button>
              ))}
            </div>
          )}
        </KpiCard>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, Clock, MessageCircle, RefreshCw, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { buildSafeWhatsAppUrl } from '../../lib/whatsapp';
import { agendaRange, clinicDateIso, clinicLocalToIso, clinicTime } from '../../lib/agendaTime';
import { useAgenda } from '../../hooks/useAgenda';
import { useRetornos } from '../../hooks/useRetornos';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { useAuth } from '../../hooks/useAuth';
import { ReturnScheduleDrawer } from '../retornos/ReturnScheduleDrawer';

export type TodayRow = {
  patient_id: string; first_name: string; phone: string | null; motive: string;
  service_name: string; days_since_last_visit: number | null; days_since_last_contact: number | null;
  estimated_amount: number | string | null; whatsapp_opt_in: boolean; suggested_message: string;
  source_type: string; source_id: string; opportunity_type: string; due_date: string | null;
  last_contact_at: string | null; service_id: string | null;
};
type TodayAction = 'spoke' | 'no_reply' | 'scheduled';
const currency = (amount: number) => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayKey = () => clinicDateIso();
const addDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

export function RelationshipTodayPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { retornos, refresh: refreshReturns } = useRetornos();
  const { servicos } = useServicos();
  const [items, setItems] = useState<TodayRow[]>([]);
  const [daily, setDaily] = useState({ contacts: 0, scheduled: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [awaitingWhatsApp, setAwaitingWhatsApp] = useState<TodayRow | null>(null);
  const [confirmContact, setConfirmContact] = useState<TodayRow | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<TodayRow | null>(null);
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('09:00');
  const [scheduling, setScheduling] = useState(false);
  const pendingRef = useRef<TodayRow | null>(null);
  const range = useMemo(() => agendaRange(date, 'day'), [date]);
  const agenda = useAgenda({ from: range.from, to: range.to });

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const start = clinicLocalToIso(todayKey(), '00:00');
      const [response, actions] = await Promise.all([
        supabase.rpc('relationship_today_v1', { p_limit: 250 }),
        supabase.from('relationship_today_actions').select('outcome').gte('occurred_at', start),
      ]);
      if (response.error) throw response.error;
      if (actions.error) throw actions.error;
      setItems((response.data ?? []) as TodayRow[]);
      const rows = (actions.data ?? []) as { outcome: TodayAction }[];
      setDaily({ contacts: rows.filter(r => r.outcome === 'spoke' || r.outcome === 'no_reply').length,
        scheduled: rows.filter(r => r.outcome === 'scheduled').length });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a fila de hoje.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      const row = pendingRef.current;
      if (row) { pendingRef.current = null; setAwaitingWhatsApp(null); setConfirmContact(row); }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const record = async (row: TodayRow, outcome: TodayAction) => {
    setWorkingId(row.patient_id);
    try {
      const { error: recordError } = await supabase.rpc('record_relationship_today_outcome_v1', {
        p_patient_id: row.patient_id, p_outcome: outcome, p_message_body: row.suggested_message,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (recordError) throw recordError;
      setConfirmContact(null); setAwaitingWhatsApp(null); pendingRef.current = null;
      await refresh();
      toast.success(outcome === 'scheduled' ? 'Agendamento e contato registrados.' : 'Contato registrado.');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Falha ao registrar contato.'); }
    finally { setWorkingId(null); }
  };

  const openWhatsApp = (row: TodayRow) => {
    if (!row.whatsapp_opt_in) { toast.error('É necessário consentimento para contatar pelo WhatsApp.'); return; }
    const url = buildSafeWhatsAppUrl(row.phone, row.suggested_message);
    if (!url) { toast.error('Telefone inválido para WhatsApp.'); return; }
    pendingRef.current = row; setAwaitingWhatsApp(row);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const snooze = async (row: TodayRow, days: number) => {
    if (!user) { toast.error('Entre novamente para continuar.'); return; }
    setWorkingId(row.patient_id);
    const { error: snoozeError } = await supabase.from('communication_attention_state').upsert({
      user_id: user.id, item_key: 'relationship:patient:' + row.patient_id, snoozed_until: addDays(days),
    }, { onConflict: 'user_id,item_key' });
    if (snoozeError) toast.error('Não foi possível adiar esta paciente.');
    else { toast.success('Adiado por ' + days + ' dias.'); await refresh(); }
    setWorkingId(null);
  };

  const scheduleReturn = useMemo(() => scheduleTarget?.source_type === 'procedure_return'
    ? (retornos.find(r => r.id === scheduleTarget.source_id) ?? null) : null, [scheduleTarget, retornos]);
  const submitSchedule = async () => {
    if (!scheduleTarget) return;
    setScheduling(true);
    try {
      const scheduledAt = clinicLocalToIso(date, time);
      const service = servicos.find(s => s.id === (scheduleTarget.service_id ?? scheduleReturn?.serviceId));
      const duration = service?.duration_minutes && service.duration_minutes > 0 ? service.duration_minutes : 60;
      const conflict = await agenda.findConflict(scheduledAt, duration);
      if (conflict) throw new Error('Já existe um atendimento às ' + clinicTime(conflict.scheduled_at) + '.');
      if (scheduleReturn) {
        const { data, error: scheduleError } = await supabase.rpc('schedule_procedure_return_v2', {
          p_return_id: scheduleReturn.id, p_scheduled_at: scheduledAt, p_notes: 'Retorno agendado pela fila Hoje',
        });
        if (scheduleError) throw scheduleError;
        const appointment = data as { id?: string } | null;
        if (appointment?.id) void supabase.functions.invoke('google-calendar-upsert', { body: { appointment_id: appointment.id } });
        await refreshReturns();
      } else {
        await agenda.create({ patient_id: scheduleTarget.patient_id, service_id: scheduleTarget.service_id,
          scheduled_at: scheduledAt, duration_minutes: duration, notes: 'Agendado pela fila de relacionamento Hoje' });
      }
      const done = scheduleTarget;
      setScheduleTarget(null);
      await record(done, 'scheduled');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Não foi possível agendar.'); }
    finally { setScheduling(false); }
  };

  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.estimated_amount) || 0), 0);
  return <div className="page">
    <header className="page-header"><div><h1 className="page-title">Hoje · Retomar pacientes</h1>
      <p className="page-sub">Uma pessoa por vez, priorizada pelo motivo mais importante. Confirme cada contato manualmente.</p></div>
      <button className="btn btn--ghost btn--sm" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Atualizar</button>
    </header>
    <section className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <div><strong style={{ fontSize: 24 }}>{items.length}</strong><div className="page-sub">Pessoas para contatar</div></div>
        <div><strong style={{ fontSize: 24 }}>{currency(total)}</strong><div className="page-sub">Potencial estimado (não é receita)</div></div>
        <div><strong style={{ fontSize: 24 }}>{daily.contacts}</strong><div className="page-sub">Contatos feitos hoje</div></div>
        <div><strong style={{ fontSize: 24 }}>{daily.scheduled}</strong><div className="page-sub">Agendados hoje</div></div>
      </div>
    </section>
    {loading && <p className="page-sub">Carregando oportunidades...</p>}
    {error && <div role="alert" className="card" style={{ padding: 16 }}>{error}</div>}
    {!loading && !error && items.length === 0 && <div className="card" style={{ padding: 24 }}>Você está em dia com os contatos elegíveis. Novas oportunidades aparecerão automaticamente.</div>}
    <section style={{ display: 'grid', gap: 12 }}>
      {items.map(row => <article key={row.patient_id} className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div><strong>{row.first_name}</strong><div className="page-sub">{row.motive}</div>
            <div className="page-sub">Oferecer: avaliação e opções da clínica · Referência interna: {row.service_name}</div>
            <div className="page-sub">Última visita: {row.days_since_last_visit ?? '—'} dias · Último contato: {row.days_since_last_contact ?? '—'} dias</div>
          </div>
          <strong>{row.estimated_amount == null ? 'Sem estimativa' : currency(Number(row.estimated_amount))}</strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <button className="btn btn--primary btn--sm" disabled={!row.phone || !row.whatsapp_opt_in} onClick={() => openWhatsApp(row)}><MessageCircle size={15} /> WhatsApp</button>
          <button className="btn btn--secondary btn--sm" disabled={workingId === row.patient_id || !row.whatsapp_opt_in} onClick={() => void record(row, 'spoke')}>Falei</button>
          <button className="btn btn--secondary btn--sm" disabled={workingId === row.patient_id || !row.whatsapp_opt_in} onClick={() => void record(row, 'no_reply')}>Sem resposta</button>
          <button className="btn btn--secondary btn--sm" onClick={() => {
            setDate(todayKey()); setTime('09:00'); setScheduleTarget(row);
          }}><CalendarPlus size={15} /> Agendou</button>
          <button className="btn btn--ghost btn--sm" disabled={workingId === row.patient_id} onClick={() => void snooze(row, 7)}><Clock size={14}/> 7 dias</button>
          <button className="btn btn--ghost btn--sm" disabled={workingId === row.patient_id} onClick={() => void snooze(row, 30)}>30 dias</button>
          <button className="btn btn--ghost btn--sm" onClick={() => navigate('/pacientes/' + row.patient_id)}><UserRound size={15}/> Abrir ficha</button>
        </div>
        {!row.whatsapp_opt_in && <div className="page-sub" style={{ marginTop: 8 }}>WhatsApp indisponível até registrar autorização da paciente.</div>}
      </article>)}
    </section>
    {awaitingWhatsApp && <p className="page-sub" role="status" style={{ marginTop: 10 }}>WhatsApp aberto para {awaitingWhatsApp.first_name}. Ao voltar, confirme se conversou.</p>}
    {confirmContact && <div className="drawer-overlay"><div className="drawer" role="dialog" aria-modal="true" aria-label="Confirmar contato">
      <div className="drawer-header"><strong>Falou com {confirmContact.first_name}?</strong></div>
      <div className="drawer-body">Só confirmamos o contato depois da sua resposta. Abrir o WhatsApp não registra envio.</div>
      <div className="drawer-footer"><button className="btn btn--ghost" onClick={() => setConfirmContact(null)}>Agora não</button>
        <button className="btn btn--secondary" onClick={() => void record(confirmContact, 'no_reply')}>Sem resposta</button>
        <button className="btn btn--primary" onClick={() => void record(confirmContact, 'spoke')}>Sim, falei</button>
      </div></div></div>}
    {scheduleTarget && <ReturnScheduleDrawer item={scheduleReturn} patientName={scheduleTarget.first_name} serviceName={scheduleTarget.service_name}
      date={date} time={time} saving={scheduling} onDate={setDate} onTime={setTime} onSave={() => void submitSchedule()} onClose={() => setScheduleTarget(null)} />}
  </div>;
}

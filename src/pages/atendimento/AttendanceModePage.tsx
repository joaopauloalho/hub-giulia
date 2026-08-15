import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, Camera, CheckCircle2, ClipboardList, FileSignature, HeartPulse, MessageCircle, RefreshCw, RotateCcw, Syringe, UserRound, WalletCards } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useProcedureFollowupSummary, aftercareDate, orientationStatusLabel } from '../../hooks/useAftercare';
import { supabase } from '../../lib/supabase';
import { PatientNextActionCard } from '../../components/operational/PatientNextActionCard';

interface AttendanceContext {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string | null;
  service_id: string | null;
  service_name: string | null;
  service_is_injectable: boolean;
  scheduled_at: string;
  duration_minutes: number;
  appointment_status: string;
  anamnesis_status: string | null;
  anamnesis_last_saved_at: string | null;
  photo_count: number;
  procedure_id: string | null;
  procedure_performed_at: string | null;
  procedure_total_value: number | null;
  procedure_gross_value: number | null;
  procedure_covered_value: number | null;
  procedure_pending_amount: number | null;
  contract_count: number;
  payment_count: number;
  injectable_map_count: number;
}

const APPOINTMENT_LABEL: Record<string, string> = { pendente: 'Pendente', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', nao_compareceu: 'Não compareceu' };
function dateTime(value: string) { return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function money(value: number | null) { if (value === null || value === undefined) return '—'; return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

export function AttendanceModePage() {
  const { appointmentId = '' } = useParams();
  const navigate = useNavigate();
  const [context, setContext] = useState<AttendanceContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const followup = useProcedureFollowupSummary(context?.procedure_id);

  const load = useCallback(async () => {
    if (!appointmentId) return;
    setLoading(true); setError(null);
    const { data, error: contextError } = await supabase.rpc('get_attendance_context_v1', { p_appointment_id: appointmentId });
    if (contextError) { console.error('[attendance:context]', contextError); setContext(null); setError('Não foi possível carregar o atendimento. Tente novamente.'); }
    else { const row = ((data ?? []) as AttendanceContext[])[0] ?? null; setContext(row); if (!row) setError('Atendimento não encontrado ou sem acesso.'); }
    setLoading(false);
  }, [appointmentId]);
  useEffect(() => { void load(); }, [load]);

  const returnTo = `/atendimento/${appointmentId}`;
  const patientUrl = useCallback((tab: string) => {
    if (!context) return '/pacientes';
    const params = new URLSearchParams({ tab, appointment_id: appointmentId, return_to: returnTo });
    return `/pacientes/${context.patient_id}?${params.toString()}`;
  }, [appointmentId, context, returnTo]);
  const registrarUrl = useMemo(() => {
    if (!context) return '/registrar';
    const params = new URLSearchParams({ patient_id: context.patient_id, appointment_id: appointmentId, return_to: returnTo });
    if (context.service_id) params.set('service_id', context.service_id);
    return `/registrar?${params.toString()}`;
  }, [appointmentId, context, returnTo]);

  if (loading) return <div className="page attendance-page"><div className="attendance-skeleton card">Carregando contexto do atendimento…</div></div>;
  if (!context || error) return <div className="page attendance-page"><div className="empty-state"><HeartPulse size={38} /><p>{error ?? 'Atendimento indisponível.'}</p><button className="btn btn--secondary btn--md" onClick={() => navigate('/agenda')}>Voltar à Agenda</button></div></div>;

  const anamnesisReady = context.anamnesis_status === 'completed';
  const hasProcedure = Boolean(context.procedure_id);
  const covered = Number(context.procedure_covered_value ?? 0) > 0;
  const pending = Number(context.procedure_pending_amount ?? 0);
  const agendaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(context.scheduled_at));
  const nextReturn = followup.summary?.returns.find(item => !item.completed_at && !item.dismissed_at) ?? null;
  const pendingTasks = followup.summary?.tasks.filter(task => task.status === 'pending').length ?? 0;

  return <div className="page attendance-page">
    <header className="attendance-header">
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate(`/agenda?date=${agendaDate}`)}><ArrowLeft size={16} /> Agenda</button>
      <div className="attendance-title-block"><div className="attendance-eyebrow">Modo Atendimento</div><h1 className="page-title">{context.patient_name}</h1><p className="page-sub">{dateTime(context.scheduled_at)} · {context.service_name ?? 'Serviço não definido'} · {context.duration_minutes} min</p></div>
      <span className={`badge ${context.appointment_status === 'realizado' ? 'badge--green' : context.appointment_status === 'cancelado' || context.appointment_status === 'nao_compareceu' ? 'badge--red' : 'badge--rose'}`}>{APPOINTMENT_LABEL[context.appointment_status] ?? context.appointment_status}</span>
    </header>

    <section className="attendance-status-card card" aria-labelledby="attendance-status-title">
      <div className="attendance-section-heading"><div><h2 id="attendance-status-title">Contexto do atendimento</h2><p className="page-sub">Leitura factual dos módulos atuais. Nenhuma etapa é marcada como obrigatória por esta tela.</p></div><button className="btn btn--ghost btn--sm" onClick={() => void Promise.all([load(), followup.refresh()])}><RefreshCw size={14} /> Atualizar</button></div>
      <div className="attendance-readiness-grid">
        <div className="attendance-readiness is-ready"><UserRound size={17} /><span><strong>Paciente</strong><small>Cadastro localizado</small></span><CheckCircle2 size={16} /></div>
        <div className={`attendance-readiness${anamnesisReady ? ' is-ready' : ''}`}><ClipboardList size={17} /><span><strong>Anamnese</strong><small>{anamnesisReady ? 'Versão concluída' : context.anamnesis_status === 'draft' ? 'Rascunho salvo no servidor' : 'Sem versão atual'}</small></span>{anamnesisReady && <CheckCircle2 size={16} />}</div>
        <div className={`attendance-readiness${context.photo_count > 0 ? ' is-ready' : ''}`}><Camera size={17} /><span><strong>Fotos</strong><small>{context.photo_count > 0 ? `${context.photo_count} registrada${context.photo_count === 1 ? '' : 's'}` : 'Nenhuma foto registrada'}</small></span>{context.photo_count > 0 && <CheckCircle2 size={16} />}</div>
        <div className={`attendance-readiness${hasProcedure ? ' is-ready' : ''}`}><HeartPulse size={17} /><span><strong>Procedimento</strong><small>{hasProcedure ? 'Registrado' : 'Ainda não registrado'}</small></span>{hasProcedure && <CheckCircle2 size={16} />}</div>
        <div className={`attendance-readiness${context.contract_count > 0 ? ' is-ready' : ''}`}><FileSignature size={17} /><span><strong>Contratos</strong><small>{context.contract_count > 0 ? `${context.contract_count} relacionado${context.contract_count === 1 ? '' : 's'}` : 'Sem contrato relacionado'}</small></span>{context.contract_count > 0 && <CheckCircle2 size={16} />}</div>
        {context.service_is_injectable && <div className={`attendance-readiness${context.injectable_map_count > 0 ? ' is-ready' : ''}`}><Syringe size={17} /><span><strong>Injetáveis</strong><small>{context.injectable_map_count > 0 ? 'Mapa/aplicação registrada' : 'Serviço injetável'}</small></span>{context.injectable_map_count > 0 && <CheckCircle2 size={16} />}</div>}
      </div>
    </section>

    <section className="attendance-flow" aria-label="Ações do atendimento">
      <button className="attendance-action card" onClick={() => navigate(patientUrl('anamnesis'))}><ClipboardList size={21} /><span><strong>Anamnese</strong><small>{anamnesisReady ? 'Ver atual ou iniciar nova versão' : context.anamnesis_status === 'draft' ? 'Continuar rascunho' : 'Abrir Anamnese 2.0'}</small></span></button>
      <button className="attendance-action card" onClick={() => navigate(patientUrl('photos'))}><Camera size={21} /><span><strong>Fotos</strong><small>Abrir fotos da paciente sem nova busca</small></span></button>
      <button className={`attendance-action card${!hasProcedure ? ' is-primary' : ''}`} onClick={() => navigate(registrarUrl)}><HeartPulse size={21} /><span><strong>{hasProcedure ? 'Ver / registrar outro procedimento' : 'Registrar procedimento'}</strong><small>Paciente, agendamento e serviço já contextualizados</small></span></button>
      {context.service_is_injectable && <button className="attendance-action card" onClick={() => navigate(hasProcedure ? patientUrl('injectables') : registrarUrl)}><Syringe size={21} /><span><strong>Injetáveis</strong><small>{hasProcedure ? 'Abrir mapas/aplicações da paciente' : 'Integrado ao fluxo de Registrar'}</small></span></button>}
      <button className="attendance-action card" onClick={() => navigate(patientUrl('contracts'))}><FileSignature size={21} /><span><strong>Contratos</strong><small>Ver contratos relevantes ou iniciar assinatura</small></span></button>
      <button className="attendance-action card" onClick={() => navigate(patientUrl('finance'))}><WalletCards size={21} /><span><strong>Pagamento</strong><small>{!hasProcedure ? 'Disponível após o procedimento' : covered && pending <= 0 ? `Coberto por pacote · ${money(context.procedure_covered_value)}` : pending > 0 ? `Pendente ${money(pending)}` : context.payment_count > 0 ? `${context.payment_count} pagamento${context.payment_count === 1 ? '' : 's'} registrado${context.payment_count === 1 ? '' : 's'}` : 'Abrir resumo financeiro real'}</small></span></button>
      <button className="attendance-action card" onClick={() => navigate(`/retornos?patient_id=${context.patient_id}`)}><RotateCcw size={21} /><span><strong>Retorno</strong><small>Ver necessidade real e agendar quando aplicável</small></span></button>
    </section>

    {hasProcedure && <section className="card" style={{ padding: 16, display: 'grid', gap: 10 }} aria-labelledby="attendance-completion-title"><div><div className="attendance-eyebrow">Resumo factual</div><h2 id="attendance-completion-title" style={{ margin: '4px 0 2px', fontSize: 17 }}>Conclusão do atendimento</h2><p className="page-sub">Mostra somente fatos canônicos; foto, contrato ou pagamento pendente não viram “erro” por si só.</p></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 9 }}><div className="attendance-readiness is-ready"><HeartPulse size={17} /><span><strong>Procedimento</strong><small>Registrado</small></span><CheckCircle2 size={16} /></div><div className="attendance-readiness"><WalletCards size={17} /><span><strong>Pagamento</strong><small>{covered && pending <= 0 ? 'Coberto por pacote' : pending > 0 ? `Pendente ${money(pending)}` : context.payment_count > 0 ? 'Registrado' : 'Sem pagamento registrado'}</small></span></div><div className="attendance-readiness"><RotateCcw size={17} /><span><strong>Retorno</strong><small>{nextReturn ? `${aftercareDate(nextReturn.window_start)}–${aftercareDate(nextReturn.window_end)}` : 'Sem retorno ativo'}</small></span></div><div className="attendance-readiness"><MessageCircle size={17} /><span><strong>Pós-atendimento</strong><small>{followup.summary ? `${pendingTasks} tarefa${pendingTasks === 1 ? '' : 's'} pendente${pendingTasks === 1 ? '' : 's'}` : 'Sem plano ativo'}</small></span></div></div></section>}

    {hasProcedure && <PatientNextActionCard patientId={context.patient_id} appointmentId={appointmentId} />}

    {hasProcedure && <section className="card" style={{ padding: 16, display: 'grid', gap: 12 }} aria-labelledby="attendance-aftercare-title"><div><div className="attendance-eyebrow">Acompanhamento</div><h2 id="attendance-aftercare-title" style={{ margin: '4px 0 2px', fontSize: 17 }}>Pós-atendimento</h2><p className="page-sub">O plano é preparado automaticamente quando existe protocolo configurado. Nenhuma pendência bloqueia a conclusão do atendimento.</p></div>{followup.loading ? <div className="page-sub">Carregando acompanhamento…</div> : followup.error ? <div className="communication-error">Não foi possível carregar o pós-atendimento. Atualize antes de registrar qualquer ação.</div> : !followup.summary ? <div className="page-sub">Este procedimento não possui protocolo pós-atendimento configurado.</div> : <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 9 }}><div className="attendance-readiness"><span><strong>Orientações</strong><small>{orientationStatusLabel(followup.summary.orientation_status)}</small></span></div><div className="attendance-readiness"><span><strong>Próximo check-in</strong><small>{followup.summary.next_task ? aftercareDate(followup.summary.next_task.due_on) : 'Nenhum pendente'}</small></span></div><div className="attendance-readiness"><span><strong>Retorno</strong><small>{nextReturn ? `${aftercareDate(nextReturn.window_start)}–${aftercareDate(nextReturn.window_end)}` : 'Sem retorno ativo'}</small></span></div><div className="attendance-readiness"><span><strong>Fotos no acompanhamento</strong><small>{followup.summary.photo_followup ? 'Sim · usar Photos 2.0 na clínica' : 'Não configurado'}</small></span></div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{followup.summary.instructions_snapshot && followup.summary.orientation_status === 'pending' && <button className="btn btn--secondary btn--md" onClick={() => navigate('/comunicacao?category=aftercare')}><MessageCircle size={16} /> Ver orientações na Comunicação</button>}<button className="btn btn--secondary btn--md" onClick={() => navigate(`/pacientes/${context.patient_id}`)}>Ver paciente</button><button className="btn btn--ghost btn--md" onClick={() => navigate(`/agenda?date=${agendaDate}`)}>Voltar à Agenda</button></div></>}</section>}

    <footer className="attendance-footer card"><CalendarDays size={18} /><div><strong>Conclusão sem estado paralelo</strong><p className="page-sub">O status continua vindo da Agenda, o procedimento continua vindo do Registrar e o retorno continua no Returns 2.0.</p></div></footer>
  </div>;
}

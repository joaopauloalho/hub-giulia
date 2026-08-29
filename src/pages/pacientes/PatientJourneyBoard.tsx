import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  HeartPulse,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { usePatientJourney } from '../../hooks/usePatientJourney';
import { useToast } from '../../hooks/useToast';
import {
  filterPatientJourneyRows,
  journeyAgeLabel,
  journeyAttentionLabel,
  journeyDateTime,
  journeyMoney,
  PATIENT_JOURNEY_DESCRIPTION,
  PATIENT_JOURNEY_LABEL,
  PATIENT_JOURNEY_MANUAL_MOMENTS,
  PATIENT_JOURNEY_MOMENTS,
  type PatientJourneyMoment,
  type PatientJourneyRow,
} from '../../lib/patientJourney';
import './patient-journey.css';

type JourneyFilter = PatientJourneyMoment | 'all';

interface Props {
  search: string;
  onOpenPatient: (patientId: string) => void;
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function statusIcon(moment: PatientJourneyMoment) {
  if (moment === 'assessment_scheduled') return <Calendar size={15} />;
  if (moment === 'awaiting_quote' || moment === 'quote_sent' || moment === 'negotiation') return <FileText size={15} />;
  if (moment === 'won_waiting_start' || moment === 'in_treatment') return <HeartPulse size={15} />;
  if (moment === 'treatment_completed') return <CheckCircle2 size={15} />;
  return <UserRound size={15} />;
}

function JourneyCard({ row, onOpen, onClassify }: { row: PatientJourneyRow; onOpen: () => void; onClassify: () => void }) {
  const attention = journeyAttentionLabel(row.attention_level);
  const money = journeyMoney(row.proposal_total_value);
  const appointment = journeyDateTime(row.next_appointment_at);

  return <article className={`journey-card journey-card--${row.attention_level}`}>
    <button type="button" className="journey-card__main" onClick={onOpen}>
      <div className="journey-card__head">
        <span className="journey-avatar">{initials(row.patient_name)}</span>
        <span className="journey-card__identity">
          <strong>{row.patient_name}</strong>
          <small>{[row.phone, row.profession].filter(Boolean).join(' · ') || 'Paciente cadastrada'}</small>
        </span>
        <span className="journey-card__age">{journeyAgeLabel(row.days_in_moment)}</span>
      </div>

      {attention && <div className={`journey-attention journey-attention--${row.attention_level}`}><AlertTriangle size={13} />{attention}</div>}

      <div className="journey-card__action">
        <span>Próxima ação</span>
        <strong>{row.next_action}</strong>
      </div>

      <div className="journey-card__signals">
        {row.proposal_title && <span><FileText size={12} />{row.proposal_title}{money ? ` · ${money}` : ''}</span>}
        {row.active_package_title && <span><HeartPulse size={12} />{row.active_package_title}{row.available_balance > 0 ? ` · ${row.available_balance.toLocaleString('pt-BR')} sessão(ões)` : ''}</span>}
        {appointment && <span><Calendar size={12} />Próximo: {appointment}</span>}
        {row.open_returns_count > 0 && <span><RefreshCw size={12} />{row.open_returns_count} retorno(s) aberto(s)</span>}
        {row.followup_due_on && <span><Clock size={12} />Follow-up: {row.followup_due_on.split('-').reverse().join('/')}</span>}
      </div>

      <div className="journey-card__reason" title={row.moment_reason}>
        <span className={`journey-source journey-source--${row.moment_source}`}>{row.moment_source === 'manual' ? 'Manual' : 'Automático'}</span>
        <span>{row.moment_reason}</span>
      </div>
    </button>
    <button type="button" className="journey-card__classify" onClick={onClassify}>{row.moment === 'unclassified' ? 'Classificar' : 'Alterar momento'}</button>
  </article>;
}

function ClassificationModal({ row, onClose, onSave }: { row: PatientJourneyRow; onClose: () => void; onSave: (moment: PatientJourneyMoment | null, note: string) => Promise<void> }) {
  const [moment, setMoment] = useState<PatientJourneyMoment | null>(row.moment_source === 'manual' ? row.moment : null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try { await onSave(moment, note); } finally { setSaving(false); }
  };

  return <div className="journey-modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="journey-modal" onSubmit={submit}>
      <div className="journey-modal__head">
        <div><strong>Momento da paciente</strong><div className="page-sub">{row.patient_name}</div></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
      </div>
      <div className="journey-modal__body">
        <p className="journey-modal__intro">Use a classificação manual somente quando o Hub não conseguir concluir pelo histórico. Um evento objetivo mais novo — como proposta aceita, procedimento ou pacote ativo — volta a assumir automaticamente.</p>

        {row.moment_source === 'manual' && <label className={`journey-choice ${moment === null ? 'is-selected' : ''}`}>
          <input type="radio" name="journey-moment" checked={moment === null} onChange={() => setMoment(null)} />
          <span><strong>Voltar ao automático</strong><small>O Hub usa CRM, orçamento, agenda e tratamento como fonte.</small></span>
        </label>}

        <div className="journey-choice-grid">
          {PATIENT_JOURNEY_MANUAL_MOMENTS.map(item => <label className={`journey-choice ${moment === item ? 'is-selected' : ''}`} key={item}>
            <input type="radio" name="journey-moment" checked={moment === item} onChange={() => setMoment(item)} />
            <span><strong>{PATIENT_JOURNEY_LABEL[item]}</strong><small>{PATIENT_JOURNEY_DESCRIPTION[item]}</small></span>
          </label>)}
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label className="field-label" htmlFor="journey-note">Observação opcional</label>
          <textarea id="journey-note" className="field-input" rows={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="Ex.: paciente pediu para pensar e retornar na próxima semana" />
        </div>
      </div>
      <div className="journey-modal__actions">
        <button type="button" className="btn btn--ghost btn--md" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary btn--md" disabled={saving || (moment === null && row.moment_source !== 'manual')}>{saving ? 'Salvando…' : 'Salvar momento'}</button>
      </div>
    </form>
  </div>;
}

export function PatientJourneyBoard({ search, onOpenPatient }: Props) {
  const { rows, loading, error, refresh, setMoment } = usePatientJourney({ search });
  const { toast } = useToast();
  const [momentFilter, setMomentFilter] = useState<JourneyFilter>('all');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [classifying, setClassifying] = useState<PatientJourneyRow | null>(null);

  const counts = useMemo(() => Object.fromEntries(PATIENT_JOURNEY_MOMENTS.map(moment => [moment, rows.filter(row => row.moment === moment).length])) as Record<PatientJourneyMoment, number>, [rows]);
  const attentionCount = useMemo(() => rows.filter(row => row.attention_level !== 'none').length, [rows]);
  const visibleRows = useMemo(() => filterPatientJourneyRows(rows, momentFilter, attentionOnly), [attentionOnly, momentFilter, rows]);
  const lanes = momentFilter === 'all' ? PATIENT_JOURNEY_MOMENTS : [momentFilter];

  const saveClassification = async (moment: PatientJourneyMoment | null, note: string) => {
    if (!classifying) return;
    try {
      await setMoment(classifying.patient_id, moment, note);
      toast.success(moment ? `Paciente movida para ${PATIENT_JOURNEY_LABEL[moment]}.` : 'Classificação automática restaurada.');
      setClassifying(null);
    } catch (err) {
      console.error('[patient-journey:classify]', err);
      toast.error('Não foi possível atualizar o momento da paciente.');
    }
  };

  if (loading) return <div className="journey-loading" aria-live="polite"><div/><div/><div/></div>;
  if (error) return <div className="empty-state"><AlertTriangle size={40} strokeWidth={1.4} /><p>{error}</p><button className="btn btn--secondary btn--md" onClick={() => void refresh()}><RefreshCw size={15} /> Tentar novamente</button></div>;

  return <section className="journey-shell" aria-label="Jornada das pacientes">
    <div className="journey-kpis">
      <button type="button" className={`journey-kpi ${attentionOnly ? 'is-active' : ''}`} onClick={() => setAttentionOnly(value => !value)}>
        <span className="journey-kpi__icon"><AlertTriangle size={18} /></span><span><strong>{attentionCount}</strong><small>Precisam de atenção</small></span>
      </button>
      <button type="button" className="journey-kpi" onClick={() => setMomentFilter('quote_sent')}>
        <span className="journey-kpi__icon"><FileText size={18} /></span><span><strong>{counts.quote_sent + counts.negotiation}</strong><small>Orçamentos em aberto</small></span>
      </button>
      <button type="button" className="journey-kpi" onClick={() => setMomentFilter('in_treatment')}>
        <span className="journey-kpi__icon"><HeartPulse size={18} /></span><span><strong>{counts.in_treatment}</strong><small>Em tratamento</small></span>
      </button>
      <div className="journey-kpi journey-kpi--static"><span className="journey-kpi__icon"><UserRound size={18} /></span><span><strong>{rows.length}</strong><small>Pacientes na jornada</small></span></div>
    </div>

    <div className="journey-controls">
      <div className="journey-filter-strip" role="group" aria-label="Filtrar por momento">
        <button type="button" className={momentFilter === 'all' ? 'is-selected' : ''} onClick={() => setMomentFilter('all')}><SlidersHorizontal size={13} /> Todos <span>{rows.length}</span></button>
        {PATIENT_JOURNEY_MOMENTS.map(item => <button type="button" className={momentFilter === item ? 'is-selected' : ''} key={item} onClick={() => setMomentFilter(item)}>{PATIENT_JOURNEY_LABEL[item]} <span>{counts[item]}</span></button>)}
      </div>
      <button type="button" className={`journey-attention-toggle ${attentionOnly ? 'is-selected' : ''}`} onClick={() => setAttentionOnly(value => !value)}><AlertTriangle size={14} /> Só atenção</button>
    </div>

    {visibleRows.length === 0 ? <div className="journey-empty"><CheckCircle2 size={38} strokeWidth={1.4} /><strong>Nenhuma paciente neste filtro</strong><span>{attentionOnly ? 'Não há pendências de atenção aqui.' : 'Escolha outro momento para continuar.'}</span></div> : <div className="journey-board">
      {lanes.map(lane => {
        const laneRows = visibleRows.filter(row => row.moment === lane);
        return <section className={`journey-lane journey-lane--${lane}`} key={lane} aria-label={PATIENT_JOURNEY_LABEL[lane]}>
          <header className="journey-lane__head"><span className="journey-lane__icon">{statusIcon(lane)}</span><div><strong>{PATIENT_JOURNEY_LABEL[lane]}</strong><small>{PATIENT_JOURNEY_DESCRIPTION[lane]}</small></div><span className="journey-lane__count">{laneRows.length}</span></header>
          <div className="journey-lane__cards">{laneRows.map(row => <JourneyCard key={row.patient_id} row={row} onOpen={() => onOpenPatient(row.patient_id)} onClassify={() => setClassifying(row)} />)}{laneRows.length === 0 && <div className="journey-lane__empty">Nenhuma paciente</div>}</div>
        </section>;
      })}
    </div>}

    {classifying && <ClassificationModal row={classifying} onClose={() => setClassifying(null)} onSave={saveClassification} />}
  </section>;
}

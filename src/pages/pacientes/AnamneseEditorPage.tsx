import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CloudOff, RefreshCw, ShieldAlert } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAnamneseDraftV2 } from '../../hooks/useAnamneseDraftV2';
import {
  validateAnamnesisForCompletion,
  type AnswerStatus,
  type AnamnesisSaveStatus,
} from '../../lib/anamnesisV2';
import type {
  AnamnesisAesthetics,
  AnamnesisConditions,
  AnamnesisHabits,
  AnamnosisSurgicalHistory,
} from '../../types';
import './anamnese.css';

const SECTIONS = [
  ['conditions', 'Condições'],
  ['medications', 'Medicamentos e alergias'],
  ['history', 'Histórico médico'],
  ['womens-health', 'Saúde feminina'],
  ['habits', 'Hábitos'],
  ['aesthetics', 'Rotina estética'],
  ['review', 'Revisão'],
] as const;

const CONDITIONS: [keyof AnamnesisConditions, string][] = [
  ['hipertensao', 'Hipertensão'],
  ['hipotensao', 'Hipotensão'],
  ['diabetes', 'Diabetes'],
  ['cancer', 'Câncer'],
  ['problemas_cardiacos', 'Problemas cardíacos'],
  ['disfuncao_renal', 'Disfunção renal'],
  ['problemas_vasculares', 'Problemas vasculares'],
  ['epilepsia', 'Epilepsia'],
  ['problemas_respiratorios', 'Problemas respiratórios'],
  ['problemas_tireoide', 'Problemas de tireoide'],
  ['problemas_coagulacao', 'Problemas de coagulação'],
  ['marcapasso', 'Marcapasso'],
  ['fumante', 'Fumante'],
  ['hiv_aids', 'HIV/AIDS'],
  ['hepatite', 'Hepatite'],
];

const HABITS: [keyof AnamnesisHabits, string][] = [
  ['refrigerante', 'Refrigerante'],
  ['fast_food', 'Fast food'],
  ['doces', 'Doces'],
  ['frituras', 'Frituras'],
  ['cigarros', 'Cigarros'],
  ['bebidas_alcoolicas', 'Bebidas alcoólicas'],
];

function saveStatusLabel(status: AnamnesisSaveStatus, savedAt?: string | null) {
  if (status === 'saving') return 'Salvando…';
  if (status === 'pending') return 'Alterações aguardando autosave';
  if (status === 'offline') return 'Sem conexão — aguardando sincronização';
  if (status === 'error') return 'Erro ao salvar';
  if (status === 'session-expired') return 'Sessão expirada — alterações preservadas';
  if (status === 'conflict') return 'Alterada em outro dispositivo';
  if (status === 'saved' && savedAt) {
    const date = new Date(savedAt);
    return `Salvo às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return 'Rascunho ainda não salvo';
}

function TriStateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: boolean;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <div className="anamnesis-question">
      <span className="anamnesis-question__label">{label}</span>
      <div className="anamnesis-choice-group" role="group" aria-label={label}>
        <button type="button" className={value === true ? 'is-selected' : ''} aria-pressed={value === true} onClick={() => onChange(true)}>Sim</button>
        <button type="button" className={value === false ? 'is-selected' : ''} aria-pressed={value === false} onClick={() => onChange(false)}>Não</button>
        <button type="button" className={value === undefined ? 'is-selected is-muted' : 'is-muted'} aria-pressed={value === undefined} onClick={() => onChange(undefined)}>Não resp.</button>
      </div>
    </div>
  );
}

function ConditionalField({
  label,
  value,
  onChange,
  detail,
  onDetail,
  placeholder,
  type = 'text',
}: {
  label: string;
  value?: boolean;
  onChange: (value: boolean | undefined) => void;
  detail?: string;
  onDetail: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div className="anamnesis-conditional">
      <TriStateField label={label} value={value} onChange={onChange} />
      {value === true && (
        <input
          className="field-input"
          type={type}
          value={detail ?? ''}
          placeholder={placeholder}
          onChange={event => onDetail(event.target.value)}
          aria-label={`${label}: detalhe`}
        />
      )}
    </div>
  );
}

function TextStatusField({
  label,
  status,
  text,
  noneLabel,
  reportedLabel,
  placeholder,
  onStatus,
  onText,
}: {
  label: string;
  status: AnswerStatus;
  text: string;
  noneLabel: string;
  reportedLabel: string;
  placeholder: string;
  onStatus: (status: AnswerStatus) => void;
  onText: (value: string) => void;
}) {
  return (
    <div className="anamnesis-text-status">
      <label className="field-label">{label}</label>
      <div className="anamnesis-choice-group anamnesis-choice-group--wide" role="group" aria-label={`${label}: situação`}>
        <button type="button" className={status === 'reported' ? 'is-selected' : ''} onClick={() => onStatus('reported')}>{reportedLabel}</button>
        <button type="button" className={status === 'none' ? 'is-selected' : ''} onClick={() => onStatus('none')}>{noneLabel}</button>
        <button type="button" className={status === null ? 'is-selected is-muted' : 'is-muted'} onClick={() => onStatus(null)}>Não respondido</button>
      </div>
      {status === 'reported' && (
        <textarea className="field-input" rows={3} value={text} placeholder={placeholder} onChange={event => onText(event.target.value)} />
      )}
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="anamnesis-section" tabIndex={-1}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function AnamneseEditorPage() {
  const { patientId = '' } = useParams();
  const navigate = useNavigate();
  const [patientName, setPatientName] = useState('Paciente');
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [exitWarning, setExitWarning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    draft,
    current,
    loading,
    loadError,
    saveStatus,
    saveMessage,
    finalizing,
    setDraft,
    flush,
    retry,
    reloadServer,
    finalize,
    hasPendingChanges,
  } = useAnamneseDraftV2(patientId);

  useEffect(() => {
    let active = true;
    supabase
      .from('patients')
      .select('name')
      .eq('id', patientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setPatientName(String(data.name));
      });
    return () => { active = false; };
  }, [patientId]);

  const backUrl = `/pacientes?patient_id=${encodeURIComponent(patientId)}&tab=anamnesis`;

  const setCondition = (key: keyof AnamnesisConditions, value: boolean | undefined) =>
    setDraft(currentDraft => ({ ...currentDraft, conditions: { ...currentDraft.conditions, [key]: value } }));

  const setSurgical = (key: keyof AnamnosisSurgicalHistory, value: boolean | string | undefined) =>
    setDraft(currentDraft => ({ ...currentDraft, surgicalHistory: { ...currentDraft.surgicalHistory, [key]: value } }));

  const setHabit = (key: keyof AnamnesisHabits, value: boolean | string | undefined) =>
    setDraft(currentDraft => ({ ...currentDraft, habits: { ...currentDraft.habits, [key]: value } }));

  const setAesthetic = (key: keyof AnamnesisAesthetics, value: boolean | string | undefined) =>
    setDraft(currentDraft => ({ ...currentDraft, aesthetics: { ...currentDraft.aesthetics, [key]: value } }));

  const statusText = saveStatusLabel(saveStatus, current?.last_saved_at);
  const statusClass = ['offline', 'error', 'session-expired', 'conflict'].includes(saveStatus)
    ? 'anamnesis-save-status is-alert'
    : 'anamnesis-save-status';

  const goSection = (id: string) => {
    void flush();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const tryLeave = async () => {
    setActionError(null);
    await flush();
    if (hasPendingChanges()) {
      setExitWarning(true);
      return;
    }
    navigate(backUrl);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      void tryLeave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleFinalize = async () => {
    setActionError(null);
    setExitWarning(false);
    const issues = validateAnamnesisForCompletion(draft);
    setValidationIssues(issues);
    if (issues.length > 0) {
      document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    try {
      const result = await finalize();
      navigate(`${backUrl}&version=${result.version_number}`, { replace: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível concluir a anamnese.');
    }
  };

  const review = useMemo(() => ({
    conditionsAnswered: Object.values(draft.conditions).filter(value => typeof value === 'boolean').length,
    medications: draft.medicationsStatus,
    allergies: draft.allergiesStatus,
  }), [draft]);

  if (!patientId) return <div className="empty-state"><p>Paciente inválida.</p></div>;
  if (loading) return <div className="full-loader">Carregando anamnese...</div>;
  if (loadError) return <div className="empty-state"><ShieldAlert size={36} /><p>{loadError}</p></div>;

  return (
    <div className="anamnesis-editor-page">
      <header className="anamnesis-editor-header">
        <button className="btn btn--ghost btn--sm anamnesis-back" type="button" onClick={() => void tryLeave()}>
          <ArrowLeft size={17} /> Voltar
        </button>
        <div className="anamnesis-editor-heading">
          <strong>{patientName}</strong>
          <span>Anamnese · {current?.status === 'completed' ? `Concluída · versão ${current.latest_version_number}` : 'Rascunho'}</span>
        </div>
        <div className={statusClass}>
          {saveStatus === 'offline' ? <CloudOff size={14} /> : saveStatus === 'saved' ? <CheckCircle2 size={14} /> : <RefreshCw size={14} className={saveStatus === 'saving' ? 'is-spinning' : ''} />}
          <span>{statusText}</span>
        </div>
        <button
          className="btn btn--primary btn--sm anamnesis-finalize"
          type="button"
          disabled={finalizing || (current?.status !== 'draft' && !hasPendingChanges())}
          onClick={() => void handleFinalize()}
        >
          {finalizing ? 'Concluindo…' : current?.latest_version_number ? 'Concluir nova versão' : 'Concluir anamnese'}
        </button>
      </header>

      {(saveMessage || actionError || exitWarning) && (
        <div className="anamnesis-editor-banner" role="status">
          <div>
            <strong>{exitWarning ? 'Existem alterações que ainda não foram salvas.' : actionError ? 'Ação não concluída.' : 'Estado do salvamento'}</strong>
            <p>{actionError ?? saveMessage ?? 'Tente sincronizar antes de sair.'}</p>
          </div>
          <div className="anamnesis-editor-banner__actions">
            {saveStatus === 'conflict' ? (
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => void reloadServer()}>Recarregar versão atual</button>
            ) : (
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => void retry()}>Tentar salvar</button>
            )}
            {exitWarning && <button className="btn btn--ghost btn--sm" type="button" onClick={() => setExitWarning(false)}>Continuar editando</button>}
          </div>
        </div>
      )}

      <div className="anamnesis-editor-layout">
        <nav className="anamnesis-section-nav" aria-label="Seções da anamnese">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => goSection(id)}>{label}</button>
          ))}
        </nav>

        <main className="anamnesis-form">
          <Section id="conditions" title="Condições de Saúde">
            <p className="anamnesis-section-help">Cada item distingue Sim, Não e Não respondido.</p>
            <div className="anamnesis-grid">
              {CONDITIONS.map(([key, label]) => (
                <TriStateField key={key} label={label} value={draft.conditions[key]} onChange={value => setCondition(key, value)} />
              ))}
            </div>
          </Section>

          <Section id="medications" title="Medicamentos e Alergias">
            <TextStatusField
              label="Medicamentos em uso"
              status={draft.medicationsStatus}
              text={draft.medications}
              reportedLabel="Utiliza"
              noneLabel="Não utiliza"
              placeholder="Nome, dose, frequência..."
              onStatus={status => setDraft(value => ({ ...value, medicationsStatus: status }))}
              onText={medications => setDraft(value => ({ ...value, medications }))}
            />
            <TextStatusField
              label="Alergias conhecidas"
              status={draft.allergiesStatus}
              text={draft.allergies}
              reportedLabel="Possui"
              noneLabel="Não possui"
              placeholder="Alergias a medicamentos, produtos, alimentos..."
              onStatus={status => setDraft(value => ({ ...value, allergiesStatus: status }))}
              onText={allergies => setDraft(value => ({ ...value, allergies }))}
            />
          </Section>

          <Section id="history" title="Histórico Médico">
            <ConditionalField label="Cirurgias recentes" value={draft.surgicalHistory.cirurgias_recentes} onChange={value => setSurgical('cirurgias_recentes', value)} detail={draft.surgicalHistory.cirurgias_recentes_detalhe} placeholder="Qual/quando?" onDetail={value => setSurgical('cirurgias_recentes_detalhe', value)} />
            <ConditionalField label="Prótese metálica" value={draft.surgicalHistory.protese_metalica} onChange={value => setSurgical('protese_metalica', value)} detail={draft.surgicalHistory.protese_metalica_regiao} placeholder="Região" onDetail={value => setSurgical('protese_metalica_regiao', value)} />
            <ConditionalField label="Desmaios/convulsões" value={draft.surgicalHistory.desmaios} onChange={value => setSurgical('desmaios', value)} detail={draft.surgicalHistory.desmaio_porque} placeholder="Por quê?" onDetail={value => setSurgical('desmaio_porque', value)} />
            <ConditionalField label="Herpes" value={draft.surgicalHistory.herpes} onChange={value => setSurgical('herpes', value)} detail={draft.surgicalHistory.herpes_detalhe} placeholder="Com que frequência?" onDetail={value => setSurgical('herpes_detalhe', value)} />
            <ConditionalField label="Alergia a anestesia" value={draft.surgicalHistory.alergia_anestesia} onChange={value => setSurgical('alergia_anestesia', value)} detail={draft.surgicalHistory.alergia_anestesia_detalhe} placeholder="Qual?" onDetail={value => setSurgical('alergia_anestesia_detalhe', value)} />
            <ConditionalField label="Alergia a abelha/insetos" value={draft.surgicalHistory.alergia_abelha} onChange={value => setSurgical('alergia_abelha', value)} detail={draft.surgicalHistory.alergia_abelha_detalhe} placeholder="Reação" onDetail={value => setSurgical('alergia_abelha_detalhe', value)} />
            <ConditionalField label="Em tratamento médico" value={draft.surgicalHistory.tratamento_medico} onChange={value => setSurgical('tratamento_medico', value)} detail={draft.surgicalHistory.tratamento_medico_detalhe} placeholder="Qual tratamento?" onDetail={value => setSurgical('tratamento_medico_detalhe', value)} />
            <div className="anamnesis-grid">
              <TriStateField label="Ansiedade" value={draft.surgicalHistory.ansioso} onChange={value => setSurgical('ansioso', value)} />
              <TriStateField label="Estresse elevado" value={draft.surgicalHistory.estressado} onChange={value => setSurgical('estressado', value)} />
              <TriStateField label="Enxaqueca" value={draft.surgicalHistory.enxaqueca} onChange={value => setSurgical('enxaqueca', value)} />
              <TriStateField label="Intestino regular" value={draft.surgicalHistory.intestino_regular} onChange={value => setSurgical('intestino_regular', value)} />
            </div>
          </Section>

          <Section id="womens-health" title="Saúde Feminina">
            <div className="anamnesis-question anamnesis-question--stack">
              <span className="anamnesis-question__label">Gestante?</span>
              <div className="anamnesis-choice-group">
                {[
                  ['sim', 'Sim'],
                  ['não', 'Não'],
                  ['tentando', 'Tentando'],
                  ['', 'Não resp.'],
                ].map(([value, label]) => (
                  <button key={value || 'empty'} type="button" className={(draft.surgicalHistory.gestante ?? '') === value ? 'is-selected' : ''} onClick={() => setSurgical('gestante', value || undefined)}>{label}</button>
                ))}
              </div>
            </div>
            {draft.surgicalHistory.gestante === 'sim' && (
              <div className="form-grid">
                <div className="field">
                  <label className="field-label">Quantas gestações?</label>
                  <input className="field-input" value={draft.surgicalHistory.quantas_gestacoes ?? ''} onChange={event => setSurgical('quantas_gestacoes', event.target.value)} />
                </div>
                <div className="field">
                  <label className="field-label">Tipo de parto</label>
                  <input className="field-input" value={draft.surgicalHistory.tipo_parto ?? ''} placeholder="Normal / Cesárea" onChange={event => setSurgical('tipo_parto', event.target.value)} />
                </div>
              </div>
            )}
            <TriStateField label="Menstruação regular" value={draft.surgicalHistory.menstruacao_regular} onChange={value => setSurgical('menstruacao_regular', value)} />
            <div className="field">
              <label className="field-label">Método contraceptivo</label>
              <input className="field-input" value={draft.surgicalHistory.metodo_contraceptivo ?? ''} onChange={event => setSurgical('metodo_contraceptivo', event.target.value)} />
            </div>
            <ConditionalField label="TPM intensa" value={draft.surgicalHistory.tpm} onChange={value => setSurgical('tpm', value)} detail={draft.surgicalHistory.tpm_o_que_faz} placeholder="O que costuma fazer?" onDetail={value => setSurgical('tpm_o_que_faz', value)} />
          </Section>

          <Section id="habits" title="Hábitos Alimentares">
            <div className="anamnesis-grid">
              {HABITS.map(([key, label]) => (
                <TriStateField key={key} label={label} value={draft.habits[key] as boolean | undefined} onChange={value => setHabit(key, value)} />
              ))}
            </div>
            <ConditionalField label="Alimentação especial / dieta" value={draft.habits.alimentacao_especial} onChange={value => setHabit('alimentacao_especial', value)} detail={draft.habits.alimentacao_especial_qual} placeholder="Qual dieta?" onDetail={value => setHabit('alimentacao_especial_qual', value)} />
            <ConditionalField label="Suplementação" value={draft.habits.suplemento} onChange={value => setHabit('suplemento', value)} detail={draft.habits.suplemento_quais} placeholder="Quais suplementos?" onDetail={value => setHabit('suplemento_quais', value)} />
            <ConditionalField label="Atividade física" value={draft.habits.atividade_fisica} onChange={value => setHabit('atividade_fisica', value)} detail={draft.habits.atividade_fisica_detalhe} placeholder="Tipo / frequência" onDetail={value => setHabit('atividade_fisica_detalhe', value)} />
            <div className="field">
              <label className="field-label">Quantidade de água por dia</label>
              <input className="field-input" value={draft.habits.quantidade_agua ?? ''} placeholder="Ex: 2 litros" onChange={event => setHabit('quantidade_agua', event.target.value)} />
            </div>
          </Section>

          <Section id="aesthetics" title="Rotina Estética">
            <div className="form-grid">
              <div className="field field--full">
                <label className="field-label">Cuidados diários em casa</label>
                <textarea className="field-input" rows={3} value={draft.aesthetics.cuidados_diarios ?? ''} placeholder="Sabonete, hidratante, protetor..." onChange={event => setAesthetic('cuidados_diarios', event.target.value)} />
              </div>
              <div className="field field--full">
                <label className="field-label">Produtos em uso no rosto</label>
                <textarea className="field-input" rows={3} value={draft.aesthetics.produtos_em_uso ?? ''} onChange={event => setAesthetic('produtos_em_uso', event.target.value)} />
              </div>
            </div>
            <ConditionalField label="Usa produto com ácido" value={draft.aesthetics.produto_com_acido} onChange={value => setAesthetic('produto_com_acido', value)} detail={draft.aesthetics.produto_com_acido_detalhe} placeholder="Qual ácido / concentração?" onDetail={value => setAesthetic('produto_com_acido_detalhe', value)} />
            <ConditionalField label="Limpeza de pele recente" value={draft.aesthetics.limpeza_pele} onChange={value => setAesthetic('limpeza_pele', value)} detail={draft.aesthetics.limpeza_pele_data} placeholder="Data" type="date" onDetail={value => setAesthetic('limpeza_pele_data', value)} />
            <ConditionalField label="Microagulhamento recente" value={draft.aesthetics.microagulhamento} onChange={value => setAesthetic('microagulhamento', value)} detail={draft.aesthetics.microagulhamento_data} placeholder="Data" type="date" onDetail={value => setAesthetic('microagulhamento_data', value)} />
            <ConditionalField label="Peeling recente" value={draft.aesthetics.peeling} onChange={value => setAesthetic('peeling', value)} detail={draft.aesthetics.peeling_detalhe} placeholder="Tipo / data" onDetail={value => setAesthetic('peeling_detalhe', value)} />
            <ConditionalField label="Toxina botulínica" value={draft.aesthetics.toxina_botulinica} onChange={value => setAesthetic('toxina_botulinica', value)} detail={draft.aesthetics.toxina_botulinica_data} placeholder="Última aplicação" type="date" onDetail={value => setAesthetic('toxina_botulinica_data', value)} />
            <ConditionalField label="Fios de sustentação" value={draft.aesthetics.fios_sustentacao} onChange={value => setAesthetic('fios_sustentacao', value)} detail={draft.aesthetics.fios_sustentacao_data} placeholder="Quando?" type="date" onDetail={value => setAesthetic('fios_sustentacao_data', value)} />
            <ConditionalField label="Preenchimento com ácido hialurônico" value={draft.aesthetics.preenchimento_hialuronico} onChange={value => setAesthetic('preenchimento_hialuronico', value)} detail={draft.aesthetics.preenchimento_hialuronico_data} placeholder="Quando?" type="date" onDetail={value => setAesthetic('preenchimento_hialuronico_data', value)} />
            <ConditionalField label="Bioestimulador" value={draft.aesthetics.bioestimulador} onChange={value => setAesthetic('bioestimulador', value)} detail={draft.aesthetics.bioestimulador_data} placeholder="Quando?" type="date" onDetail={value => setAesthetic('bioestimulador_data', value)} />
            <ConditionalField label="Plástica facial" value={draft.aesthetics.plastica_facial} onChange={value => setAesthetic('plastica_facial', value)} detail={draft.aesthetics.plastica_facial_detalhe} placeholder="Qual / quando?" onDetail={value => setAesthetic('plastica_facial_detalhe', value)} />
            <ConditionalField label="PMMA" value={draft.aesthetics.pmma} onChange={value => setAesthetic('pmma', value)} detail={draft.aesthetics.pmma_regiao} placeholder="Região" onDetail={value => setAesthetic('pmma_regiao', value)} />
            <ConditionalField label="Outros tratamentos estéticos" value={draft.aesthetics.outros_tratamentos} onChange={value => setAesthetic('outros_tratamentos', value)} detail={draft.aesthetics.outros_tratamentos_detalhe} placeholder="Quais?" onDetail={value => setAesthetic('outros_tratamentos_detalhe', value)} />
            <ConditionalField label="Alterações recentes na pele" value={draft.aesthetics.alteracoes_recentes} onChange={value => setAesthetic('alteracoes_recentes', value)} detail={draft.aesthetics.alteracoes_recentes_detalhe} placeholder="Descrever" onDetail={value => setAesthetic('alteracoes_recentes_detalhe', value)} />
          </Section>

          <Section id="review" title="Revisão">
            <div className="anamnesis-review-grid">
              <div><span>Condições respondidas</span><strong>{review.conditionsAnswered} de {CONDITIONS.length}</strong></div>
              <div><span>Medicamentos</span><strong>{review.medications === 'reported' ? 'Informados' : review.medications === 'none' ? 'Não utiliza' : 'Não respondido'}</strong></div>
              <div><span>Alergias</span><strong>{review.allergies === 'reported' ? 'Informadas' : review.allergies === 'none' ? 'Não possui' : 'Não respondido'}</strong></div>
            </div>
            {validationIssues.length > 0 ? (
              <div className="anamnesis-validation" role="alert">
                <strong>Revise antes de concluir:</strong>
                <ul>{validationIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
              </div>
            ) : (
              <p className="anamnesis-section-help">Não há campos condicionais pendentes. Respostas opcionais podem permanecer como “Não respondido”.</p>
            )}
            <button className="btn btn--primary btn--md" type="button" disabled={finalizing || (current?.status !== 'draft' && !hasPendingChanges())} onClick={() => void handleFinalize()}>
              {finalizing ? 'Concluindo…' : current?.latest_version_number ? 'Concluir nova versão' : 'Concluir anamnese'}
            </button>
          </Section>
        </main>
      </div>
    </div>
  );
}

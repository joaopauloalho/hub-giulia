import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, CloudOff, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAnamneseDraftV2 } from '../../hooks/useAnamneseDraftV2';
import { validateAnamnesisForCompletion, type AnamnesisSaveStatus, type ClinicalAnswerMap } from '../../lib/anamnesisV2';
import './anamnese.css';
import './anamnese391.css';

const SECTIONS = [
  ['conditions', 'Condições'], ['medications', 'Medicamentos'], ['allergies', 'Alergias'], ['history', 'Histórico médico'],
  ['womens-health', 'Saúde feminina'], ['food', 'Alimentação'], ['routine', 'Hábitos / rotina'], ['procedures', 'Procedimentos'],
  ['skin-review', 'Pele e recomendações'], ['review', 'Revisão'],
] as const;

const CONDITIONS = [
  ['hipertensao', 'Hipertensão'], ['hipotensao', 'Hipotensão'], ['diabetes', 'Diabetes'], ['cancer', 'Câncer'],
  ['problemas_cardiacos', 'Problemas cardíacos'], ['disfuncao_renal', 'Disfunção renal'], ['problemas_vasculares', 'Problemas vasculares'],
  ['epilepsia', 'Epilepsia'], ['problemas_respiratorios', 'Problemas respiratórios'], ['problemas_tireoide', 'Problemas de tireoide'],
  ['problemas_coagulacao', 'Problemas de coagulação'], ['marcapasso', 'Marcapasso'], ['fumante', 'Fumante'], ['hiv_aids', 'HIV/AIDS'], ['hepatite', 'Hepatite'],
] as const;

const ALLERGIES = [
  ['alergia_medicamento', 'Alergia a medicamento?', 'alergia_medicamento_detalhe', 'Descreva medicamento e reação'],
  ['alergia_frutos_mar', 'Alergia a frutos do mar?', 'alergia_frutos_mar_detalhe', 'Descreva'],
  ['alergia_abelha', 'Alergia a picada de abelha/insetos?', 'alergia_abelha_detalhe', 'Descreva a reação'],
  ['outras_alergias', 'Outras alergias?', 'outras_alergias_detalhe', 'Descreva'],
] as const;

const HISTORY = [
  ['recebeu_anestesia', 'Já recebeu anestesia alguma vez?', 'recebeu_anestesia_detalhe', 'Conte qual anestesia/procedimento e se teve alguma reação.'],
  ['cirurgias_recentes', 'Cirurgias recentes', 'cirurgias_recentes_detalhe', 'Qual / quando?'],
  ['protese_metalica', 'Prótese metálica', 'protese_metalica_regiao', 'Região / contexto'],
  ['desmaios', 'Desmaios/convulsões', 'desmaio_porque', 'Contexto'],
  ['herpes', 'Herpes', 'herpes_detalhe', 'Frequência / contexto'],
  ['tratamento_medico', 'Em tratamento médico', 'tratamento_medico_detalhe', 'Qual tratamento?'],
  ['acne', 'Tem acne?', 'acne_detalhe', 'Descreva'],
] as const;

const HISTORY_SIMPLE = [
  ['ansioso', 'Ansiedade'], ['estressado', 'Estresse elevado'], ['enxaqueca', 'Enxaqueca'], ['intestino_regular', 'Intestino regular'],
] as const;

const FOOD = [
  ['leite_derivados', 'Leite e derivados', 'leite_derivados_frequencia'], ['doces', 'Açúcar / doces', 'doces_frequencia'],
  ['refrigerante', 'Refrigerante', 'refrigerante_frequencia'], ['fast_food', 'Fast food', 'fast_food_frequencia'],
  ['frituras', 'Frituras', 'frituras_frequencia'], ['bebidas_alcoolicas', 'Bebidas alcoólicas', 'bebidas_alcoolicas_frequencia'],
] as const;

const ROUTINE = [
  ['alimentacao_especial', 'Segue alguma dieta específica?', 'alimentacao_especial_qual', 'Qual dieta?'],
  ['suplemento', 'Faz uso de suplementos?', 'suplemento_quais', 'Qual(is)?'],
  ['atividade_fisica', 'Pratica atividade física?', 'atividade_fisica_detalhe', 'Tipo / frequência'],
] as const;

const PROCEDURES = [
  ['limpeza_pele', 'Limpeza de pele', 'limpeza_pele_data'], ['microagulhamento', 'Microagulhamento', 'microagulhamento_data'],
  ['peeling', 'Peeling', 'peeling_detalhe'], ['laser', 'Laser', 'laser_detalhe'], ['toxina_botulinica', 'Toxina botulínica', 'toxina_botulinica_data'],
  ['fios_sustentacao', 'Fios de sustentação', 'fios_sustentacao_data'], ['preenchimento_hialuronico', 'Preenchimento com ácido hialurônico', 'preenchimento_hialuronico_data'],
  ['bioestimulador', 'Bioestimulador', 'bioestimulador_data'], ['plastica_facial', 'Plástica facial', 'plastica_facial_detalhe'],
  ['pmma', 'PMMA', 'pmma_regiao'], ['outros_tratamentos', 'Outros tratamentos estéticos', 'outros_tratamentos_detalhe'],
] as const;

function saveStatusLabel(status: AnamnesisSaveStatus, savedAt?: string | null) {
  if (status === 'saving') return 'Salvando…';
  if (status === 'pending') return 'Alterações aguardando autosave';
  if (status === 'offline') return 'Sem conexão — aguardando sincronização';
  if (status === 'error') return 'Erro ao salvar';
  if (status === 'session-expired') return 'Sessão expirada — alterações preservadas na tela';
  if (status === 'conflict') return 'Alterada em outro dispositivo';
  if (status === 'saved' && savedAt) return `Salvo às ${new Date(savedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  return 'Rascunho ainda não salvo';
}

function BinaryField({ id, label, value, onChange, help }: { id: string; label: string; value?: boolean; onChange: (value: boolean) => void; help?: string }) {
  const labelId = `${id}-label`;
  return (
    <div className="anamnesis-question" id={id} tabIndex={-1}>
      <div className="anamnesis-question__copy">
        <span className="anamnesis-question__label" id={labelId}>{label}</span>
        {help && <small>{help}</small>}
      </div>
      <div className="anamnesis-choice-group" role="radiogroup" aria-labelledby={labelId} data-focus-target tabIndex={-1}>
        <button type="button" role="radio" aria-checked={value === true} className={value === true ? 'is-selected' : ''} onClick={() => onChange(true)}>Sim</button>
        <button type="button" role="radio" aria-checked={value === false} className={value === false ? 'is-selected' : ''} onClick={() => onChange(false)}>Não</button>
      </div>
    </div>
  );
}

function DetailQuestion(props: { area: string; flag: string; label: string; value?: boolean; detail?: string; setFlag: (value: boolean) => void; setDetail: (value: string) => void; placeholder: string; help?: string }) {
  return (
    <div className="anamnesis-conditional">
      <BinaryField id={`q-${props.area}-${props.flag}`} label={props.label} value={props.value} onChange={props.setFlag} help={props.help} />
      {props.value === true && (
        <textarea
          id={`detail-${props.area}-${props.flag}`}
          data-focus-target
          className="field-input anamnesis-detail"
          rows={2}
          value={props.detail ?? ''}
          placeholder={props.placeholder}
          onChange={event => props.setDetail(event.target.value)}
          aria-label={`${props.label}: descrição`}
        />
      )}
    </div>
  );
}

function ProcedureQuestion({ flag, label, value, note, onFlag, onNote }: { flag: string; label: string; value?: boolean; note?: string; onFlag: (value: boolean) => void; onNote: (value: string) => void }) {
  return (
    <div className="anamnesis-procedure-card">
      <BinaryField id={`q-aesthetics-${flag}`} label={label} value={value} onChange={onFlag} />
      <div className="field">
        <label className="field-label" htmlFor={`detail-aesthetics-${flag}`}>Observações</label>
        <textarea
          id={`detail-aesthetics-${flag}`}
          data-focus-target
          className="field-input anamnesis-detail"
          rows={2}
          value={note ?? ''}
          onChange={event => onNote(event.target.value)}
          placeholder="Ex.: há 6 meses, 3 sessões, não lembra quando, reação, outra clínica…"
        />
      </div>
    </div>
  );
}

function LargeTextarea({ id, label, value, onChange }: { id: string; label: string; value?: string; onChange: (value: string) => void }) {
  return <div className="field field--full"><label className="field-label" htmlFor={id}>{label}</label><textarea id={id} className="field-input anamnesis-large-text" rows={5} value={value ?? ''} onChange={event => onChange(event.target.value)} /></div>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="anamnesis-section" tabIndex={-1}><h2>{title}</h2>{children}</section>;
}

export function AnamneseEditorPage() {
  const { patientId = '' } = useParams();
  const navigate = useNavigate();
  const [patientName, setPatientName] = useState('Paciente');
  const [validationIssues, setValidationIssues] = useState<ReturnType<typeof validateAnamnesisForCompletion>>([]);
  const [exitWarning, setExitWarning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { draft, current, loading, loadError, saveStatus, saveMessage, finalizing, setDraft, flush, retry, reloadServer, finalize, hasPendingChanges } = useAnamneseDraftV2(patientId);

  useEffect(() => {
    let active = true;
    void supabase.from('patients').select('name').eq('id', patientId).maybeSingle().then(({ data }) => {
      if (active && data) setPatientName(String(data.name));
    });
    return () => { active = false; };
  }, [patientId]);

  const backUrl = `/pacientes?patient_id=${encodeURIComponent(patientId)}&tab=anamnesis`;
  const setMap = (area: 'conditions' | 'surgicalHistory' | 'habits' | 'aesthetics', key: string, value: boolean | string | undefined) => {
    setDraft(previous => ({ ...previous, [area]: { ...(previous[area] as ClinicalAnswerMap), [key]: value } }));
  };
  const statusText = saveStatusLabel(saveStatus, current?.last_saved_at);
  const statusClass = ['offline', 'error', 'session-expired', 'conflict'].includes(saveStatus) ? 'anamnesis-save-status is-alert' : 'anamnesis-save-status';
  const focusIssue = (fieldId: string) => {
    const element = document.getElementById(fieldId);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      const target = (element?.matches('textarea,input,button') ? element : element?.querySelector<HTMLElement>('[data-focus-target],textarea,input,button')) as HTMLElement | null;
      target?.focus();
    }, 250);
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
  const handleFinalize = async () => {
    setActionError(null);
    setExitWarning(false);
    await flush();
    const issues = validateAnamnesisForCompletion(draft);
    setValidationIssues(issues);
    if (issues.length) {
      focusIssue(issues[0].fieldId);
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
    answered: Object.values(draft.conditions).filter(value => typeof value === 'boolean').length,
    medications: draft.medicationsStatus,
  }), [draft]);

  if (!patientId) return <div className="empty-state"><p>Paciente inválida.</p></div>;
  if (loading) return <div className="full-loader">Carregando anamnese...</div>;
  if (loadError) return <div className="empty-state"><ShieldAlert size={36} /><p>{loadError}</p></div>;

  return (
    <div className="anamnesis-editor-page">
      <header className="anamnesis-editor-header">
        <button className="btn btn--ghost btn--sm anamnesis-back" type="button" onClick={() => void tryLeave()}><ArrowLeft size={17} /> Voltar</button>
        <div className="anamnesis-editor-heading"><strong>{patientName}</strong><span>Anamnese · {current?.status === 'completed' ? `Concluída · versão ${current.latest_version_number}` : 'Rascunho'}</span></div>
        <div className={statusClass}>{saveStatus === 'offline' ? <CloudOff size={14} /> : saveStatus === 'saved' ? <CheckCircle2 size={14} /> : <RefreshCw size={14} className={saveStatus === 'saving' ? 'is-spinning' : ''} />}<span>{statusText}</span></div>
        <div className="anamnesis-header-actions">
          <button className="btn btn--secondary btn--sm" type="button" disabled={saveStatus === 'saving'} onClick={() => void flush()}><Save size={14} /> Salvar rascunho</button>
          <button className="btn btn--primary btn--sm anamnesis-finalize" type="button" disabled={finalizing || (current?.status !== 'draft' && !hasPendingChanges())} onClick={() => void handleFinalize()}>{finalizing ? 'Concluindo…' : current?.latest_version_number ? 'Concluir nova versão' : 'Concluir anamnese'}</button>
        </div>
      </header>

      {(saveMessage || actionError || exitWarning) && (
        <div className="anamnesis-editor-banner" role="status">
          <div><strong>{exitWarning ? 'Existem alterações que ainda não foram salvas.' : actionError ? 'Ação não concluída.' : 'Estado do salvamento'}</strong><p>{actionError ?? saveMessage ?? 'Tente sincronizar antes de sair.'}</p></div>
          <div className="anamnesis-editor-banner__actions">
            {saveStatus === 'conflict' ? <button className="btn btn--secondary btn--sm" onClick={() => void reloadServer()}>Recarregar versão atual</button> : <button className="btn btn--secondary btn--sm" onClick={() => void retry()}>Tentar salvar</button>}
            {exitWarning && <button className="btn btn--ghost btn--sm" onClick={() => setExitWarning(false)}>Continuar editando</button>}
          </div>
        </div>
      )}

      <div className="anamnesis-editor-layout">
        <nav className="anamnesis-section-nav" aria-label="Seções da anamnese">
          {SECTIONS.map(([id, label]) => <button key={id} type="button" onClick={() => { void flush(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{label}</button>)}
        </nav>
        <main className="anamnesis-form">
          <Section id="conditions" title="Condições de Saúde">
            <p className="anamnesis-section-help">No rascunho uma pergunta pode ficar em branco. Ao concluir, cada item obrigatório precisa de Sim ou Não.</p>
            <div className="anamnesis-grid">{CONDITIONS.map(([key, label]) => <BinaryField key={key} id={`q-conditions-${key}`} label={label} value={draft.conditions[key] as boolean | undefined} onChange={value => setMap('conditions', key, value)} />)}</div>
          </Section>

          <Section id="medications" title="Medicamentos">
            <div className="anamnesis-text-status" id="q-medications">
              <BinaryField id="q-medications-choice" label="Faz uso contínuo de algum medicamento?" value={draft.medicationsStatus === 'reported' ? true : draft.medicationsStatus === 'none' ? false : undefined} onChange={value => setDraft(previous => ({ ...previous, medicationsStatus: value ? 'reported' : 'none' }))} />
              {draft.medicationsStatus === 'reported' && <div className="field"><label className="field-label" htmlFor="detail-medications">Qual(is)?</label><textarea id="detail-medications" data-focus-target className="field-input" rows={3} value={draft.medications} onChange={event => setDraft(previous => ({ ...previous, medications: event.target.value }))} /></div>}
            </div>
          </Section>

          <Section id="allergies" title="Alergias">
            <p className="anamnesis-section-help">Alergias ficam centralizadas aqui. Respostas antigas continuam apenas no histórico; não são convertidas automaticamente.</p>
            {ALLERGIES.map(([flag, label, detail, placeholder]) => <DetailQuestion key={flag} area="surgicalHistory" flag={flag} label={label} value={draft.surgicalHistory[flag] as boolean | undefined} detail={draft.surgicalHistory[detail] as string | undefined} setFlag={value => setMap('surgicalHistory', flag, value)} setDetail={value => setMap('surgicalHistory', detail, value)} placeholder={placeholder} />)}
          </Section>

          <Section id="history" title="Histórico Médico">
            {HISTORY.map(([flag, label, detail, placeholder]) => <DetailQuestion key={flag} area="surgicalHistory" flag={flag} label={label} value={draft.surgicalHistory[flag] as boolean | undefined} detail={draft.surgicalHistory[detail] as string | undefined} setFlag={value => setMap('surgicalHistory', flag, value)} setDetail={value => setMap('surgicalHistory', detail, value)} placeholder={placeholder} help={flag === 'recebeu_anestesia' ? 'Incluindo anestesia odontológica.' : undefined} />)}
            <div className="anamnesis-grid">{HISTORY_SIMPLE.map(([key, label]) => <BinaryField key={key} id={`q-surgicalHistory-${key}`} label={label} value={draft.surgicalHistory[key] as boolean | undefined} onChange={value => setMap('surgicalHistory', key, value)} />)}</div>
          </Section>

          <Section id="womens-health" title="Saúde Feminina">
            <div className="anamnesis-question anamnesis-question--stack" id="q-surgicalHistory-gestante">
              <span className="anamnesis-question__label" id="gestante-label">Gestante?</span>
              <div className="anamnesis-choice-group" role="radiogroup" aria-labelledby="gestante-label" data-focus-target>
                {[['sim', 'Sim'], ['não', 'Não'], ['tentando', 'Tentando']].map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={draft.surgicalHistory.gestante === value} className={draft.surgicalHistory.gestante === value ? 'is-selected' : ''} onClick={() => setMap('surgicalHistory', 'gestante', value)}>{label}</button>)}
              </div>
            </div>
            {draft.surgicalHistory.gestante === 'sim' && <div className="form-grid"><div className="field"><label className="field-label">Quantas gestações?</label><input className="field-input" value={String(draft.surgicalHistory.quantas_gestacoes ?? '')} onChange={event => setMap('surgicalHistory', 'quantas_gestacoes', event.target.value)} /></div><div className="field"><label className="field-label">Tipo de parto</label><input className="field-input" value={String(draft.surgicalHistory.tipo_parto ?? '')} onChange={event => setMap('surgicalHistory', 'tipo_parto', event.target.value)} /></div></div>}
            <BinaryField id="q-surgicalHistory-menstruacao_regular" label="Menstruação regular" value={draft.surgicalHistory.menstruacao_regular as boolean | undefined} onChange={value => setMap('surgicalHistory', 'menstruacao_regular', value)} />
            <div className="field"><label className="field-label">Método contraceptivo</label><input className="field-input" value={String(draft.surgicalHistory.metodo_contraceptivo ?? '')} onChange={event => setMap('surgicalHistory', 'metodo_contraceptivo', event.target.value)} /></div>
            <DetailQuestion area="surgicalHistory" flag="colica_menstrual" label="Tem cólica menstrual?" value={draft.surgicalHistory.colica_menstrual as boolean | undefined} detail={draft.surgicalHistory.colica_menstrual_detalhe as string | undefined} setFlag={value => setMap('surgicalHistory', 'colica_menstrual', value)} setDetail={value => setMap('surgicalHistory', 'colica_menstrual_detalhe', value)} placeholder="Descreva intensidade/contexto" />
          </Section>

          <Section id="food" title="Alimentação">
            <p className="anamnesis-section-help">Ao marcar Sim, informe a frequência. Em telas largas o campo fica ao lado; no celular quebra para a linha abaixo.</p>
            {FOOD.map(([flag, label, detail]) => <DetailQuestion key={flag} area="habits" flag={flag} label={label} value={draft.habits[flag] as boolean | undefined} detail={draft.habits[detail] as string | undefined} setFlag={value => setMap('habits', flag, value)} setDetail={value => setMap('habits', detail, value)} placeholder="Frequência" />)}
            <BinaryField id="q-habits-cigarros" label="Cigarros" value={draft.habits.cigarros as boolean | undefined} onChange={value => setMap('habits', 'cigarros', value)} />
            <div className="field"><label className="field-label">Quantidade de água por dia</label><input className="field-input" value={String(draft.habits.quantidade_agua ?? '')} placeholder="Ex.: 2 litros" onChange={event => setMap('habits', 'quantidade_agua', event.target.value)} /></div>
          </Section>

          <Section id="routine" title="Hábitos / Rotina">
            {ROUTINE.map(([flag, label, detail, placeholder]) => <DetailQuestion key={flag} area="habits" flag={flag} label={label} value={draft.habits[flag] as boolean | undefined} detail={draft.habits[detail] as string | undefined} setFlag={value => setMap('habits', flag, value)} setDetail={value => setMap('habits', detail, value)} placeholder={placeholder} />)}
          </Section>

          <Section id="procedures" title="Procedimentos anteriores">
            <p className="anamnesis-section-help">Todos os campos ficam abertos. Não há data obrigatória: escreva como a paciente relata, por exemplo “há 6 meses”, “3 sessões” ou “não lembra”.</p>
            <div className="anamnesis-procedure-grid">{PROCEDURES.map(([flag, label, detail]) => <ProcedureQuestion key={flag} flag={flag} label={label} value={draft.aesthetics[flag] as boolean | undefined} note={draft.aesthetics[detail] as string | undefined} onFlag={value => setMap('aesthetics', flag, value)} onNote={value => setMap('aesthetics', detail, value)} />)}</div>
          </Section>

          <Section id="skin-review" title="Pele e recomendações">
            <div className="form-grid">
              <div className="field field--full"><label className="field-label">Cuidados diários em casa</label><textarea className="field-input" rows={3} value={String(draft.aesthetics.cuidados_diarios ?? '')} onChange={event => setMap('aesthetics', 'cuidados_diarios', event.target.value)} /></div>
              <div className="field field--full"><label className="field-label">Produtos em uso no rosto</label><textarea className="field-input" rows={3} value={String(draft.aesthetics.produtos_em_uso ?? '')} onChange={event => setMap('aesthetics', 'produtos_em_uso', event.target.value)} /></div>
            </div>
            <DetailQuestion area="aesthetics" flag="produto_com_acido" label="Usa produto com ácido?" value={draft.aesthetics.produto_com_acido as boolean | undefined} detail={draft.aesthetics.produto_com_acido_detalhe as string | undefined} setFlag={value => setMap('aesthetics', 'produto_com_acido', value)} setDetail={value => setMap('aesthetics', 'produto_com_acido_detalhe', value)} placeholder="Qual ácido / concentração?" />
            <DetailQuestion area="aesthetics" flag="alteracoes_recentes" label="Alterações recentes na pele?" value={draft.aesthetics.alteracoes_recentes as boolean | undefined} detail={draft.aesthetics.alteracoes_recentes_detalhe as string | undefined} setFlag={value => setMap('aesthetics', 'alteracoes_recentes', value)} setDetail={value => setMap('aesthetics', 'alteracoes_recentes_detalhe', value)} placeholder="Descreva" />
            <div className="field"><label className="field-label">Última LP / última limpeza de pele</label><input className="field-input" value={String(draft.aesthetics.ultima_limpeza_pele ?? '')} placeholder="Ex.: há 2 meses, não lembra, janeiro mais ou menos, nunca fez" onChange={event => setMap('aesthetics', 'ultima_limpeza_pele', event.target.value)} /></div>
            <LargeTextarea id="pele-paciente" label="Pele da paciente" value={draft.aesthetics.pele_paciente as string | undefined} onChange={value => setMap('aesthetics', 'pele_paciente', value)} />
            <LargeTextarea id="observacoes-gerais" label="Observações gerais" value={draft.aesthetics.observacoes_gerais as string | undefined} onChange={value => setMap('aesthetics', 'observacoes_gerais', value)} />
            <LargeTextarea id="minhas-recomendacoes" label="Minhas recomendações" value={draft.aesthetics.minhas_recomendacoes as string | undefined} onChange={value => setMap('aesthetics', 'minhas_recomendacoes', value)} />
          </Section>

          <Section id="review" title="Revisão">
            <div className="anamnesis-review-grid"><div><span>Condições respondidas</span><strong>{review.answered} de {CONDITIONS.length}</strong></div><div><span>Medicamentos</span><strong>{review.medications === 'reported' ? 'Sim' : review.medications === 'none' ? 'Não' : 'Pendente'}</strong></div><div><span>Estado</span><strong>{current?.status === 'draft' ? 'Rascunho' : 'Versão concluída'}</strong></div></div>
            {validationIssues.length > 0 ? <div className="anamnesis-validation" role="alert"><strong>Revise estas perguntas antes de concluir:</strong><ul>{validationIssues.map(issue => <li key={`${issue.fieldId}-${issue.message}`}><button type="button" onClick={() => focusIssue(issue.fieldId)}>{issue.message}</button></li>)}</ul></div> : <p className="anamnesis-section-help">O rascunho pode ser salvo parcialmente. A validação completa ocorre ao concluir.</p>}
            <button className="btn btn--primary btn--md" type="button" disabled={finalizing || (current?.status !== 'draft' && !hasPendingChanges())} onClick={() => void handleFinalize()}>{finalizing ? 'Concluindo…' : current?.latest_version_number ? 'Concluir nova versão' : 'Concluir anamnese'}</button>
          </Section>
        </main>
      </div>
    </div>
  );
}

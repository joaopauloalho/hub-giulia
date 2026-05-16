import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { useAnamnese } from '../../../hooks/useAnamnese';
import type {
  AnamnesisConditions,
  AnamnosisSurgicalHistory,
  AnamnesisHabits,
  AnamnesisAesthetics,
} from '../../../types';

interface Props { patientId: string; }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="form-section-title" style={{ marginTop: 20 }}>{children}</div>;
}

function CheckItem({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 20, height: 20, accentColor: 'var(--primary)', flexShrink: 0 }} />
      <span style={{ fontSize: '0.9rem', color: 'var(--text)' }}>{label}</span>
    </label>
  );
}

function CondField({
  label, checked, onCheck, detail, detailLabel, onDetail, detailType = 'text',
}: {
  label: string; checked: boolean; onCheck: (v: boolean) => void;
  detail?: string; detailLabel?: string; onDetail?: (v: string) => void;
  detailType?: string;
}) {
  return (
    <div>
      <CheckItem label={label} checked={checked} onChange={onCheck} />
      {checked && onDetail && (
        <div style={{ marginLeft: 30, marginTop: 4, marginBottom: 8 }}>
          <input className="field-input" type={detailType}
            placeholder={detailLabel ?? 'Detalhar...'}
            value={detail ?? ''}
            onChange={e => onDetail(e.target.value)} />
        </div>
      )}
    </div>
  );
}

function YesNo({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
      <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text)' }}>{label}</span>
      {(['Sim', 'Não'] as const).map(opt => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="radio" name={label} checked={value === (opt === 'Sim')} onChange={() => onChange(opt === 'Sim')}
            style={{ accentColor: 'var(--primary)', width: 18, height: 18 }} />
          <span style={{ fontSize: '0.9rem' }}>{opt}</span>
        </label>
      ))}
    </div>
  );
}

const emptyC = (): AnamnesisConditions => ({});
const emptyS = (): AnamnosisSurgicalHistory => ({});
const emptyH = (): AnamnesisHabits => ({});
const emptyA = (): AnamnesisAesthetics => ({});

export function AnamneseTab({ patientId }: Props) {
  const { anamnese, loading, error, load, save } = useAnamnese(patientId);
  const [conditions, setConditions] = useState<AnamnesisConditions>(emptyC());
  const [surgical, setSurgical] = useState<AnamnosisSurgicalHistory>(emptyS());
  const [habits, setHabits] = useState<AnamnesisHabits>(emptyH());
  const [aesthetics, setAesthetics] = useState<AnamnesisAesthetics>(emptyA());
  const [medications, setMedications] = useState('');
  const [allergies, setAllergies] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!anamnese) return;
    setConditions(anamnese.conditions ?? emptyC());
    setSurgical(anamnese.surgical_history ?? emptyS());
    setHabits(anamnese.habits ?? emptyH());
    setAesthetics(anamnese.aesthetics ?? emptyA());
    setMedications(anamnese.medications ?? '');
    setAllergies(anamnese.allergies ?? '');
  }, [anamnese]);

  const setC = (k: keyof AnamnesisConditions, v: boolean) =>
    setConditions(p => ({ ...p, [k]: v }));
  const setS = (k: keyof AnamnosisSurgicalHistory, v: boolean | string) =>
    setSurgical(p => ({ ...p, [k]: v }));
  const setH = (k: keyof AnamnesisHabits, v: boolean | string) =>
    setHabits(p => ({ ...p, [k]: v }));
  const setA = (k: keyof AnamnesisAesthetics, v: boolean | string) =>
    setAesthetics(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        patient_id: patientId,
        conditions,
        medications: medications || null,
        allergies: allergies || null,
        surgical_history: surgical,
        habits,
        aesthetics,
      });
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="empty-state" style={{ padding: '48px 20px' }}>
        <p>{error}</p>
      </div>
    );
  }

  if (loading) return <div className="loading-state">Carregando...</div>;

  const SaveBtn = () => (
    <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Save size={14} />{saving ? 'Salvando...' : 'Salvar anamnese'}
    </button>
  );

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <SaveBtn />
      </div>

      {/* Condições de Saúde */}
      <SectionTitle>Condições de Saúde</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        {([
          ['hipertensao', 'Hipertensão'],
          ['hipotensao', 'Hipotensão'],
          ['diabetes', 'Diabetes'],
          ['cancer', 'Câncer'],
          ['problemas_cardiacos', 'Problemas cardíacos'],
          ['disfuncao_renal', 'Disfunção renal'],
          ['problemas_vasculares', 'Problemas vasculares'],
          ['epilepsia', 'Epilepsia'],
          ['problemas_respiratorios', 'Prob. respiratórios'],
          ['problemas_tireoide', 'Prob. tireoide'],
          ['problemas_coagulacao', 'Prob. coagulação'],
          ['marcapasso', 'Marcapasso'],
          ['fumante', 'Fumante'],
          ['hiv_aids', 'HIV/AIDS'],
          ['hepatite', 'Hepatite'],
        ] as [keyof AnamnesisConditions, string][]).map(([key, label]) => (
          <CheckItem key={key} label={label}
            checked={!!conditions[key]} onChange={v => setC(key, v)} />
        ))}
      </div>

      {/* Medicamentos e Alergias */}
      <SectionTitle>Medicamentos e Alergias</SectionTitle>
      <div className="form-grid">
        <div className="field field--full">
          <label className="field-label">Medicamentos em uso</label>
          <textarea className="field-input" rows={2} value={medications}
            onChange={e => setMedications(e.target.value)}
            placeholder="Nome, dose, frequência..." />
        </div>
        <div className="field field--full">
          <label className="field-label">Alergias conhecidas</label>
          <textarea className="field-input" rows={2} value={allergies}
            onChange={e => setAllergies(e.target.value)}
            placeholder="Alergias a medicamentos, produtos, alimentos..." />
        </div>
      </div>

      {/* Histórico Médico */}
      <SectionTitle>Histórico Médico</SectionTitle>
      <CondField label="Cirurgias recentes" checked={!!surgical.cirurgias_recentes}
        onCheck={v => setS('cirurgias_recentes', v)}
        detail={surgical.cirurgias_recentes_detalhe} detailLabel="Qual/quando?"
        onDetail={v => setS('cirurgias_recentes_detalhe', v)} />
      <CondField label="Prótese metálica" checked={!!surgical.protese_metalica}
        onCheck={v => setS('protese_metalica', v)}
        detail={surgical.protese_metalica_regiao} detailLabel="Região"
        onDetail={v => setS('protese_metalica_regiao', v)} />
      <CondField label="Desmaios/convulsões" checked={!!surgical.desmaios}
        onCheck={v => setS('desmaios', v)}
        detail={surgical.desmaio_porque} detailLabel="Por quê?"
        onDetail={v => setS('desmaio_porque', v)} />
      <CondField label="Herpes" checked={!!surgical.herpes}
        onCheck={v => setS('herpes', v)}
        detail={surgical.herpes_detalhe} detailLabel="Com que frequência?"
        onDetail={v => setS('herpes_detalhe', v)} />
      <CondField label="Alergia a anestesia" checked={!!surgical.alergia_anestesia}
        onCheck={v => setS('alergia_anestesia', v)}
        detail={surgical.alergia_anestesia_detalhe} detailLabel="Qual?"
        onDetail={v => setS('alergia_anestesia_detalhe', v)} />
      <CondField label="Alergia a abelha/insetos" checked={!!surgical.alergia_abelha}
        onCheck={v => setS('alergia_abelha', v)}
        detail={surgical.alergia_abelha_detalhe} detailLabel="Reação"
        onDetail={v => setS('alergia_abelha_detalhe', v)} />
      <CondField label="Em tratamento médico" checked={!!surgical.tratamento_medico}
        onCheck={v => setS('tratamento_medico', v)}
        detail={surgical.tratamento_medico_detalhe} detailLabel="Qual tratamento?"
        onDetail={v => setS('tratamento_medico_detalhe', v)} />
      <YesNo label="Ansiedade" value={surgical.ansioso} onChange={v => setS('ansioso', v)} />
      <YesNo label="Estresse elevado" value={surgical.estressado} onChange={v => setS('estressado', v)} />
      <YesNo label="Enxaqueca" value={surgical.enxaqueca} onChange={v => setS('enxaqueca', v)} />
      <YesNo label="Intestino regular" value={surgical.intestino_regular} onChange={v => setS('intestino_regular', v)} />

      {/* Saúde Feminina */}
      <SectionTitle>Saúde Feminina</SectionTitle>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-2)', marginBottom: 6 }}>Gestante?</div>
        <div style={{ display: 'flex', gap: 20 }}>
          {(['Sim', 'Não', 'Tentando'] as const).map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minHeight: 44 }}>
              <input type="radio" name="gestante" checked={surgical.gestante === opt.toLowerCase()}
                onChange={() => setS('gestante', opt.toLowerCase())}
                style={{ accentColor: 'var(--primary)', width: 18, height: 18 }} />
              <span style={{ fontSize: '0.9rem' }}>{opt}</span>
            </label>
          ))}
        </div>
      </div>
      {surgical.gestante === 'sim' && (
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="field">
            <label className="field-label">Quantas gestações?</label>
            <input className="field-input" value={surgical.quantas_gestacoes ?? ''}
              onChange={e => setS('quantas_gestacoes', e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Tipo de parto</label>
            <input className="field-input" value={surgical.tipo_parto ?? ''}
              onChange={e => setS('tipo_parto', e.target.value)} placeholder="Normal / Cesárea" />
          </div>
        </div>
      )}
      <YesNo label="Menstruação regular" value={surgical.menstruacao_regular}
        onChange={v => setS('menstruacao_regular', v)} />
      <div className="field" style={{ marginTop: 8 }}>
        <label className="field-label">Método contraceptivo</label>
        <input className="field-input" value={surgical.metodo_contraceptivo ?? ''}
          onChange={e => setS('metodo_contraceptivo', e.target.value)} />
      </div>
      <CondField label="TPM intensa" checked={!!surgical.tpm}
        onCheck={v => setS('tpm', v)}
        detail={surgical.tpm_o_que_faz} detailLabel="O que costuma fazer?"
        onDetail={v => setS('tpm_o_que_faz', v)} />

      {/* Hábitos Alimentares */}
      <SectionTitle>Hábitos Alimentares</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        {([
          ['refrigerante', 'Refrigerante'],
          ['fast_food', 'Fast food'],
          ['doces', 'Doces'],
          ['frituras', 'Frituras'],
          ['cigarros', 'Cigarros'],
          ['bebidas_alcoolicas', 'Bebidas alcoólicas'],
        ] as [keyof AnamnesisHabits, string][]).map(([key, label]) => (
          <CheckItem key={key} label={label} checked={!!habits[key]}
            onChange={v => setH(key, v)} />
        ))}
      </div>
      <CondField label="Alimentação especial / dieta" checked={!!habits.alimentacao_especial}
        onCheck={v => setH('alimentacao_especial', v)}
        detail={habits.alimentacao_especial_qual} detailLabel="Qual dieta?"
        onDetail={v => setH('alimentacao_especial_qual', v)} />
      <CondField label="Suplementação" checked={!!habits.suplemento}
        onCheck={v => setH('suplemento', v)}
        detail={habits.suplemento_quais} detailLabel="Quais suplementos?"
        onDetail={v => setH('suplemento_quais', v)} />
      <CondField label="Atividade física" checked={!!habits.atividade_fisica}
        onCheck={v => setH('atividade_fisica', v)}
        detail={habits.atividade_fisica_detalhe} detailLabel="Tipo / frequência"
        onDetail={v => setH('atividade_fisica_detalhe', v)} />
      <div className="field" style={{ marginTop: 8 }}>
        <label className="field-label">Quantidade de água por dia</label>
        <input className="field-input" value={habits.quantidade_agua ?? ''}
          onChange={e => setH('quantidade_agua', e.target.value)} placeholder="Ex: 2 litros" />
      </div>

      {/* Rotina Estética */}
      <SectionTitle>Rotina Estética</SectionTitle>
      <div className="form-grid">
        <div className="field field--full">
          <label className="field-label">Cuidados diários em casa</label>
          <textarea className="field-input" rows={2} value={aesthetics.cuidados_diarios ?? ''}
            onChange={e => setA('cuidados_diarios', e.target.value)} placeholder="Sabonete, hidratante, protetor..." />
        </div>
        <div className="field field--full">
          <label className="field-label">Produtos em uso no rosto</label>
          <textarea className="field-input" rows={2} value={aesthetics.produtos_em_uso ?? ''}
            onChange={e => setA('produtos_em_uso', e.target.value)} />
        </div>
      </div>
      <CondField label="Usa produto com ácido" checked={!!aesthetics.produto_com_acido}
        onCheck={v => setA('produto_com_acido', v)}
        detail={aesthetics.produto_com_acido_detalhe} detailLabel="Qual ácido / concentração?"
        onDetail={v => setA('produto_com_acido_detalhe', v)} />
      <CondField label="Limpeza de pele recente" checked={!!aesthetics.limpeza_pele}
        onCheck={v => setA('limpeza_pele', v)}
        detail={aesthetics.limpeza_pele_data} detailLabel="Data" detailType="date"
        onDetail={v => setA('limpeza_pele_data', v)} />
      <CondField label="Microagulhamento recente" checked={!!aesthetics.microagulhamento}
        onCheck={v => setA('microagulhamento', v)}
        detail={aesthetics.microagulhamento_data} detailLabel="Data" detailType="date"
        onDetail={v => setA('microagulhamento_data', v)} />
      <CondField label="Peeling recente" checked={!!aesthetics.peeling}
        onCheck={v => setA('peeling', v)}
        detail={aesthetics.peeling_detalhe} detailLabel="Tipo / data"
        onDetail={v => setA('peeling_detalhe', v)} />
      <CondField label="Toxina botulínica" checked={!!aesthetics.toxina_botulinica}
        onCheck={v => setA('toxina_botulinica', v)}
        detail={aesthetics.toxina_botulinica_data} detailLabel="Última aplicação" detailType="date"
        onDetail={v => setA('toxina_botulinica_data', v)} />
      <CondField label="Fios de sustentação" checked={!!aesthetics.fios_sustentacao}
        onCheck={v => setA('fios_sustentacao', v)}
        detail={aesthetics.fios_sustentacao_data} detailLabel="Quando?" detailType="date"
        onDetail={v => setA('fios_sustentacao_data', v)} />
      <CondField label="Preenchimento com ácido hialurônico" checked={!!aesthetics.preenchimento_hialuronico}
        onCheck={v => setA('preenchimento_hialuronico', v)}
        detail={aesthetics.preenchimento_hialuronico_data} detailLabel="Quando?" detailType="date"
        onDetail={v => setA('preenchimento_hialuronico_data', v)} />
      <CondField label="Bioestimulador" checked={!!aesthetics.bioestimulador}
        onCheck={v => setA('bioestimulador', v)}
        detail={aesthetics.bioestimulador_data} detailLabel="Quando?" detailType="date"
        onDetail={v => setA('bioestimulador_data', v)} />
      <CondField label="Plástica facial" checked={!!aesthetics.plastica_facial}
        onCheck={v => setA('plastica_facial', v)}
        detail={aesthetics.plastica_facial_detalhe} detailLabel="Qual / quando?"
        onDetail={v => setA('plastica_facial_detalhe', v)} />
      <CondField label="PMMA" checked={!!aesthetics.pmma}
        onCheck={v => setA('pmma', v)}
        detail={aesthetics.pmma_regiao} detailLabel="Região"
        onDetail={v => setA('pmma_regiao', v)} />
      <CondField label="Outros tratamentos estéticos" checked={!!aesthetics.outros_tratamentos}
        onCheck={v => setA('outros_tratamentos', v)}
        detail={aesthetics.outros_tratamentos_detalhe} detailLabel="Quais?"
        onDetail={v => setA('outros_tratamentos_detalhe', v)} />
      <CondField label="Alterações recentes na pele" checked={!!aesthetics.alteracoes_recentes}
        onCheck={v => setA('alteracoes_recentes', v)}
        detail={aesthetics.alteracoes_recentes_detalhe} detailLabel="Descrever"
        onDetail={v => setA('alteracoes_recentes_detalhe', v)} />

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, marginBottom: 8 }}>
        <SaveBtn />
      </div>
    </div>
  );
}

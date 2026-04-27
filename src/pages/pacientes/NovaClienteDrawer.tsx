import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Check, User, Heart, Apple, Sparkles } from 'lucide-react';
import type { Paciente } from '../../types';

type FormData = Omit<Paciente, 'id' | 'createdAt'>;

const empty: FormData = {
  dataConsulta: new Date().toISOString().slice(0, 10),
  dataNascimento: '', nome: '', idade: '', estadoCivil: '',
  celular: '', profissao: '', email: '', peso: '', altura: '',
  instagram: '', emergenciaNome: '', emergenciaCelular: '',
  convenio: '', motivoConsulta: '',

  hipertensao: false, hipotensao: false, cancer: false, diabetes: false,
  problemasCardiacos: false, disfuncaoRenal: false, fumante: false,
  marcapasso: false, problemasVasculares: false, epilepsia: false,
  problemasRespiratorios: false, problemasTireoide: false,
  problemasCoagulacao: false, hivAids: false, hepatite: false,

  cirurgiasRecentes: false, cirurgiasRecentesDetalhe: '',
  proteseMetalica: false, proteseMetalicaRegiao: '',
  desmaios: false, desmaioPorque: '',
  herpes: false, herpesDetalhe: '',
  alergiaAnestesia: false, alergiaAnestesiaDetalhe: '',
  alergiaAbelha: false, alergiaAbelhaDetalhe: '',
  tratamentoMedico: false, tratamentoMedicoDetalhe: '',
  usaMedicacao: false, medicacaoDetalhe: '',
  alergias: false, alergiasDetalhe: '',

  gestante: 'nao', quantasGestacoes: '', tipoParto: '',
  menstruacaoRegular: false, metodoContraceptivo: '',
  tpm: false, tpmOQueFaz: '',
  enxaqueca: false, intestinoRegular: false, quantidadeAgua: '',
  outrosProblemas: '', ansioso: false, estressado: false,

  habitoRefrigerante: false, habitoFastFood: false, habitoDoces: false,
  habitoFrituras: false, habitoCigarros: false, habitoBebidasAlcoolicas: false,
  alimentacaoEspecial: false, alimentacaoEspecialQual: '',
  suplemento: false, suplementoQuais: '',
  atividadeFisica: false, atividadeFisicaDetalhe: '',

  cuidadosDiarios: '', produtosEmUso: '',
  produtoComAcido: false, produtoComAcidoDetalhe: '',
  limpezaPele: false, limpezaPeleData: '',
  microagulhamento: false, microagulhamentoData: '',
  peeling: false, peelingDetalhe: '',
  toxinaBotulinica: false, toxinaBotulinicaData: '',
  fiosSustentacao: false, fiosSustentacaoData: '',
  preenchimentoHialuronico: false, preenchimentoHialuronicoData: '',
  bioestimulador: false, bioestimuladorData: '',
  plasticaFacial: false, plasticaFacialDetalhe: '',
  pmma: false, pmmaRegiao: '',
  outrosTratamentos: false, outrosTratamentosDetalhe: '',
  alteracoesRecentes: false, alteracoesRecentesDetalhe: '',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: FormData) => void;
  initial?: Paciente | null;
}

const TABS = [
  { id: 0, label: 'Pessoal', icon: User },
  { id: 1, label: 'Saúde', icon: Heart },
  { id: 2, label: 'Hábitos', icon: Apple },
  { id: 3, label: 'Estética', icon: Sparkles },
];

// ── Primitive helpers ──────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="form-section-title">{children}</div>;
}

function FInput({ label, full, ...props }: { label: string; full?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`field${full ? ' field--full' : ''}`}>
      <label className="field-label">{label}</label>
      <input className="field-input" {...props} />
    </div>
  );
}

function FTextarea({ label, full, ...props }: { label: string; full?: boolean } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className={`field${full ? ' field--full' : ''}`}>
      <label className="field-label">{label}</label>
      <textarea className="field-input" rows={2} {...props} />
    </div>
  );
}

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`check-item ${checked ? 'check-item--active' : ''}`}>
      <div className={`check-box ${checked ? 'check-box--checked' : ''}`}>
        {checked && <Check size={11} strokeWidth={3} />}
      </div>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ display: 'none' }} />
      <span>{label}</span>
    </label>
  );
}

// ── Closed question — Não/Sim + reveal ────────────────────────────────────

function CondField({
  label, sub, checked, onChange, detail, onDetailChange, detailLabel, detailType = 'textarea',
}: {
  label: string; sub?: string;
  checked: boolean; onChange: (v: boolean) => void;
  detail: string; onDetailChange: (v: string) => void;
  detailLabel?: string; detailType?: 'textarea' | 'text';
}) {
  return (
    <div className="cond-field">
      <div className="cond-field-header">
        <div className="cond-field-label-wrap">
          <span className="cond-field-label">{label}</span>
          {sub && <span className="cond-field-sub">{sub}</span>}
        </div>
        <div className="cond-radio-group">
          <button type="button" className={`cond-radio ${!checked ? 'cond-radio--nao' : ''}`} onClick={() => onChange(false)}>
            Não
          </button>
          <button type="button" className={`cond-radio ${checked ? 'cond-radio--sim' : ''}`} onClick={() => onChange(true)}>
            Sim
          </button>
        </div>
      </div>
      {checked && (
        <div className="cond-field-reveal">
          {detailLabel && <label className="field-label" style={{ marginBottom: 6, display: 'block' }}>{detailLabel}</label>}
          {detailType === 'textarea'
            ? <textarea className="field-input" rows={2} placeholder="Especifique..." value={detail} onChange={e => onDetailChange(e.target.value)} />
            : <input type="text" className="field-input" placeholder="Especifique..." value={detail} onChange={e => onDetailChange(e.target.value)} />
          }
        </div>
      )}
    </div>
  );
}

// ── Inline Não/Sim (no reveal) ─────────────────────────────────────────────

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="cond-field">
      <div className="cond-field-header">
        <span className="cond-field-label">{label}</span>
        <div className="cond-radio-group">
          <button type="button" className={`cond-radio ${!value ? 'cond-radio--nao' : ''}`} onClick={() => onChange(false)}>Não</button>
          <button type="button" className={`cond-radio ${value ? 'cond-radio--sim' : ''}`} onClick={() => onChange(true)}>Sim</button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function NovaClienteDrawer({ open, onClose, onSave, initial }: Props) {
  const [tab, setTab] = useState(0);
  const [form, setForm] = useState<FormData>(empty);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(0);
      if (initial) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, createdAt, ...rest } = initial;
        setForm({ ...empty, ...rest });
      } else {
        setForm({ ...empty, dataConsulta: new Date().toISOString().slice(0, 10) });
      }
    }
  }, [open, initial]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm(p => ({ ...p, [key]: value }));

  const handleSave = () => {
    if (!form.nome.trim()) { setTab(0); return; }
    setSaving(true);
    onSave(form);
    setSaving(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="drawer-header">
          <div>
            <h2 className="drawer-title">{initial ? 'Editar Ficha' : 'Nova Cliente'}</h2>
            <p className="drawer-sub">Formulário de anamnese</p>
          </div>
          <button onClick={onClose} className="modal-close"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="drawer-tabs">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} className={`drawer-tab ${tab === t.id ? 'drawer-tab--active' : ''}`} onClick={() => setTab(t.id)}>
                <Icon size={15} strokeWidth={1.75} /><span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="drawer-body">

          {/* ── Tab 0: Pessoal ── */}
          {tab === 0 && (
            <div className="form-sections">
              <SectionTitle>Informações Pessoais</SectionTitle>
              <div className="form-grid">
                <FInput label="Data da consulta" type="date" value={form.dataConsulta} onChange={e => set('dataConsulta', e.target.value)} />
                <FInput label="Data de nascimento" type="date" value={form.dataNascimento} onChange={e => set('dataNascimento', e.target.value)} />
                <FInput label="Nome *" full value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="Nome completo" />
                <FInput label="Idade" value={form.idade} onChange={e => set('idade', e.target.value)} placeholder="Ex: 32" />
                <FInput label="Estado Civil" value={form.estadoCivil} onChange={e => set('estadoCivil', e.target.value)} placeholder="Solteira, Casada..." />
                <FInput label="Celular" type="tel" value={form.celular} onChange={e => set('celular', e.target.value)} placeholder="(00) 00000-0000" />
                <FInput label="Profissão" value={form.profissao} onChange={e => set('profissao', e.target.value)} />
                <FInput label="Email" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                <FInput label="Peso" value={form.peso} onChange={e => set('peso', e.target.value)} placeholder="Ex: 65 kg" />
                <FInput label="Altura" value={form.altura} onChange={e => set('altura', e.target.value)} placeholder="Ex: 1,68 m" />
                <FInput label="Instagram" value={form.instagram} onChange={e => set('instagram', e.target.value)} placeholder="@usuario" />
                <FInput label="Convênio" value={form.convenio} onChange={e => set('convenio', e.target.value)} />
              </div>

              <SectionTitle>Contato de Emergência</SectionTitle>
              <div className="form-grid">
                <FInput label="Nome" value={form.emergenciaNome} onChange={e => set('emergenciaNome', e.target.value)} />
                <FInput label="Celular" type="tel" value={form.emergenciaCelular} onChange={e => set('emergenciaCelular', e.target.value)} />
              </div>

              <SectionTitle>Motivo da Consulta</SectionTitle>
              <FTextarea label="" full value={form.motivoConsulta} onChange={e => set('motivoConsulta', e.target.value)} placeholder="Descreva o motivo da consulta..." />
            </div>
          )}

          {/* ── Tab 1: Saúde ── */}
          {tab === 1 && (
            <div className="form-sections">
              <SectionTitle>Condições de Saúde</SectionTitle>
              <div className="check-grid">
                {([
                  ['hipertensao', 'Hipertensão'], ['hipotensao', 'Hipotensão'],
                  ['cancer', 'Câncer'], ['diabetes', 'Diabetes'],
                  ['problemasCardiacos', 'Problemas cardíacos'], ['disfuncaoRenal', 'Disfunção renal'],
                  ['fumante', 'Fumante'], ['marcapasso', 'Marcapasso'],
                  ['problemasVasculares', 'Prob. vasculares'], ['epilepsia', 'Epilepsia'],
                  ['problemasRespiratorios', 'Prob. respiratórios'], ['problemasTireoide', 'Tireoide'],
                  ['problemasCoagulacao', 'Coagulação'], ['hivAids', 'HIV / AIDS'],
                  ['hepatite', 'Hepatite'],
                ] as [keyof FormData, string][]).map(([key, label]) => (
                  <CheckItem key={key} label={label} checked={form[key] as boolean} onChange={v => set(key, v as FormData[typeof key])} />
                ))}
              </div>

              <SectionTitle>Histórico Médico</SectionTitle>
              <div className="cond-list">
                <CondField label="Cirurgias recentes?" checked={form.cirurgiasRecentes} onChange={v => set('cirurgiasRecentes', v)}
                  detail={form.cirurgiasRecentesDetalhe} onDetailChange={v => set('cirurgiasRecentesDetalhe', v)} detailLabel="Quais cirurgias?" />
                <CondField label="Portadora de próteses metálicas?" checked={form.proteseMetalica} onChange={v => set('proteseMetalica', v)}
                  detail={form.proteseMetalicaRegiao} onDetailChange={v => set('proteseMetalicaRegiao', v)} detailLabel="Qual região?" detailType="text" />
                <CondField label="Já teve episódios de desmaio?" checked={form.desmaios} onChange={v => set('desmaios', v)}
                  detail={form.desmaioPorque} onDetailChange={v => set('desmaioPorque', v)} detailLabel="Por quê?" detailType="text" />
                <CondField label="Já teve Herpes?" checked={form.herpes} onChange={v => set('herpes', v)}
                  detail={form.herpesDetalhe} onDetailChange={v => set('herpesDetalhe', v)} detailLabel="Quando foi e como tratou?" />
                <CondField label="Alergia a anestesia odontológica?" checked={form.alergiaAnestesia} onChange={v => set('alergiaAnestesia', v)}
                  detail={form.alergiaAnestesiaDetalhe} onDetailChange={v => set('alergiaAnestesiaDetalhe', v)} detailLabel="Qual reação?" detailType="text" />
                <CondField label="Alergia a picada de abelha?" checked={form.alergiaAbelha} onChange={v => set('alergiaAbelha', v)}
                  detail={form.alergiaAbelhaDetalhe} onDetailChange={v => set('alergiaAbelhaDetalhe', v)} detailLabel="Qual reação?" detailType="text" />
                <CondField label="Realiza ou realizou tratamento médico?" checked={form.tratamentoMedico} onChange={v => set('tratamentoMedico', v)}
                  detail={form.tratamentoMedicoDetalhe} onDetailChange={v => set('tratamentoMedicoDetalhe', v)} detailLabel="Qual tratamento?" />
                <CondField label="Faz uso de medicação?" checked={form.usaMedicacao} onChange={v => set('usaMedicacao', v)}
                  detail={form.medicacaoDetalhe} onDetailChange={v => set('medicacaoDetalhe', v)} detailLabel="Quais medicamentos?" />
                <CondField label="Possui alergia ou sensibilidade?" sub="(lidocaína, frutos do mar, latex, sulfato, hidroquinona, babosa...)"
                  checked={form.alergias} onChange={v => set('alergias', v)}
                  detail={form.alergiasDetalhe} onDetailChange={v => set('alergiasDetalhe', v)} detailLabel="Quais alergias?" />
              </div>

              <SectionTitle>Saúde Feminina</SectionTitle>
              <div className="cond-list">
                <div className="cond-field">
                  <div className="cond-field-header">
                    <span className="cond-field-label">Gestante?</span>
                    <div className="cond-radio-group">
                      {[{ v: 'nao', l: 'Não' }, { v: 'sim', l: 'Sim' }, { v: 'filhos', l: 'Tem filhos' }].map(opt => (
                        <button key={opt.v} type="button"
                          className={`cond-radio ${form.gestante === opt.v ? (opt.v === 'nao' ? 'cond-radio--nao' : 'cond-radio--sim') : ''}`}
                          onClick={() => set('gestante', opt.v)}>
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(form.gestante === 'sim' || form.gestante === 'filhos') && (
                    <div className="cond-field-reveal">
                      <div className="form-grid" style={{ marginTop: 0 }}>
                        <FInput label="Quantas gestações?" value={form.quantasGestacoes} onChange={e => set('quantasGestacoes', e.target.value)} />
                        <div className="field">
                          <label className="field-label">Tipo de parto</label>
                          <div className="cond-radio-group" style={{ marginTop: 4 }}>
                            {[{ v: 'cesaria', l: 'Cesárea' }, { v: 'normal', l: 'Normal' }].map(opt => (
                              <button key={opt.v} type="button"
                                className={`cond-radio ${form.tipoParto === opt.v ? 'cond-radio--sim' : ''}`}
                                onClick={() => set('tipoParto', opt.v)}>
                                {opt.l}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <YesNo label="Ciclo de menstruação regular?" value={form.menstruacaoRegular} onChange={v => set('menstruacaoRegular', v)} />
                <div className="cond-field">
                  <div className="cond-field-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                    <span className="cond-field-label">Usa algum método contraceptivo?</span>
                    <input className="field-input" placeholder="Pílula, DIU, implante..." value={form.metodoContraceptivo} onChange={e => set('metodoContraceptivo', e.target.value)} style={{ width: '100%' }} />
                  </div>
                </div>
                <CondField label="Sofre com TPM?" checked={form.tpm} onChange={v => set('tpm', v)}
                  detail={form.tpmOQueFaz} onDetailChange={v => set('tpmOQueFaz', v)} detailLabel="O que costuma fazer?" detailType="text" />
              </div>

              <SectionTitle>Bem-estar</SectionTitle>
              <div className="cond-list">
                <YesNo label="Enxaqueca?" value={form.enxaqueca} onChange={v => set('enxaqueca', v)} />
                <YesNo label="Funcionamento intestinal regular?" value={form.intestinoRegular} onChange={v => set('intestinoRegular', v)} />
                <div className="cond-field">
                  <div className="cond-field-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                    <span className="cond-field-label">Quantidade de água por dia</span>
                    <input className="field-input" placeholder="Ex: 2 litros" value={form.quantidadeAgua} onChange={e => set('quantidadeAgua', e.target.value)} style={{ width: '100%' }} />
                  </div>
                </div>
                <YesNo label="Sente-se ansiosa ou nervosa?" value={form.ansioso} onChange={v => set('ansioso', v)} />
                <YesNo label="Sente-se estressada?" value={form.estressado} onChange={v => set('estressado', v)} />
                <CondField label="Outros problemas não citados?" checked={!!form.outrosProblemas} onChange={v => { if (!v) set('outrosProblemas', ''); }}
                  detail={form.outrosProblemas} onDetailChange={v => set('outrosProblemas', v)} detailLabel="Quais?" />
              </div>
            </div>
          )}

          {/* ── Tab 2: Hábitos ── */}
          {tab === 2 && (
            <div className="form-sections">
              <SectionTitle>Hábitos Alimentares</SectionTitle>
              <div className="check-grid">
                {([
                  ['habitoRefrigerante', 'Refrigerante'], ['habitoFastFood', 'Fast food'],
                  ['habitoDoces', 'Doces'], ['habitoFrituras', 'Frituras'],
                  ['habitoCigarros', 'Cigarros'], ['habitoBebidasAlcoolicas', 'Bebidas alcoólicas'],
                ] as [keyof FormData, string][]).map(([key, label]) => (
                  <CheckItem key={key} label={label} checked={form[key] as boolean} onChange={v => set(key, v as FormData[typeof key])} />
                ))}
              </div>

              <SectionTitle>Dieta e Suplementação</SectionTitle>
              <div className="cond-list">
                <CondField label="Faz alimentação especial ou segue alguma dieta?" checked={form.alimentacaoEspecial} onChange={v => set('alimentacaoEspecial', v)}
                  detail={form.alimentacaoEspecialQual} onDetailChange={v => set('alimentacaoEspecialQual', v)} detailLabel="Qual dieta?" detailType="text" />
                <CondField label="Faz uso de suplementos?" checked={form.suplemento} onChange={v => set('suplemento', v)}
                  detail={form.suplementoQuais} onDetailChange={v => set('suplementoQuais', v)} detailLabel="Quais suplementos?" />
                <CondField label="Pratica atividade física?" checked={form.atividadeFisica} onChange={v => set('atividadeFisica', v)}
                  detail={form.atividadeFisicaDetalhe} onDetailChange={v => set('atividadeFisicaDetalhe', v)} detailLabel="Qual atividade e frequência?" />
              </div>
            </div>
          )}

          {/* ── Tab 3: Estética ── */}
          {tab === 3 && (
            <div className="form-sections">
              <SectionTitle>Rotina Diária de Pele</SectionTitle>
              <div className="form-grid">
                <FTextarea label="Cuidados diários com a pele" full value={form.cuidadosDiarios} onChange={e => set('cuidadosDiarios', e.target.value)} placeholder="Limpeza, hidratação, protetor solar..." />
                <FTextarea label="Produtos em uso no momento" full value={form.produtosEmUso} onChange={e => set('produtosEmUso', e.target.value)} placeholder="Liste os produtos..." />
              </div>

              <SectionTitle>Tratamentos de Pele</SectionTitle>
              <div className="cond-list">
                <CondField label="Utiliza produto com ácido?" checked={form.produtoComAcido} onChange={v => set('produtoComAcido', v)}
                  detail={form.produtoComAcidoDetalhe} onDetailChange={v => set('produtoComAcidoDetalhe', v)} detailLabel="Qual produto e desde quando?" />
                <CondField label="Já realizou limpeza de pele?" checked={form.limpezaPele} onChange={v => set('limpezaPele', v)}
                  detail={form.limpezaPeleData} onDetailChange={v => set('limpezaPeleData', v)} detailLabel="Quando foi a última vez?" detailType="text" />
                <CondField label="Já realizou microagulhamento?" checked={form.microagulhamento} onChange={v => set('microagulhamento', v)}
                  detail={form.microagulhamentoData} onDetailChange={v => set('microagulhamentoData', v)} detailLabel="Quando foi a última vez?" detailType="text" />
                <CondField label="Já realizou algum tipo de peeling?" checked={form.peeling} onChange={v => set('peeling', v)}
                  detail={form.peelingDetalhe} onDetailChange={v => set('peelingDetalhe', v)} detailLabel="Qual peeling e quando?" />
              </div>

              <SectionTitle>Procedimentos Estéticos</SectionTitle>
              <div className="cond-list">
                <CondField label="Já fez aplicação de toxina botulínica?" checked={form.toxinaBotulinica} onChange={v => set('toxinaBotulinica', v)}
                  detail={form.toxinaBotulinicaData} onDetailChange={v => set('toxinaBotulinicaData', v)} detailLabel="Última aplicação (mês/ano)" detailType="text" />
                <CondField label="Tem ou já colocou fios de sustentação?" checked={form.fiosSustentacao} onChange={v => set('fiosSustentacao', v)}
                  detail={form.fiosSustentacaoData} onDetailChange={v => set('fiosSustentacaoData', v)} detailLabel="Última vez (mês/ano)" detailType="text" />
                <CondField label="Já fez preenchimento com ácido hialurônico?" checked={form.preenchimentoHialuronico} onChange={v => set('preenchimentoHialuronico', v)}
                  detail={form.preenchimentoHialuronicoData} onDetailChange={v => set('preenchimentoHialuronicoData', v)} detailLabel="Última vez (mês/ano)" detailType="text" />
                <CondField label="Já fez bioestimulador de colágeno?" checked={form.bioestimulador} onChange={v => set('bioestimulador', v)}
                  detail={form.bioestimuladorData} onDetailChange={v => set('bioestimuladorData', v)} detailLabel="Última vez (mês/ano)" detailType="text" />
                <CondField label="Já fez plástica facial?" checked={form.plasticaFacial} onChange={v => set('plasticaFacial', v)}
                  detail={form.plasticaFacialDetalhe} onDetailChange={v => set('plasticaFacialDetalhe', v)} detailLabel="Qual procedimento?" detailType="text" />
                <CondField label="Tem PMMA?" checked={form.pmma} onChange={v => set('pmma', v)}
                  detail={form.pmmaRegiao} onDetailChange={v => set('pmmaRegiao', v)} detailLabel="Em qual região?" detailType="text" />
                <CondField label="Outros tratamentos estéticos realizados?" checked={form.outrosTratamentos} onChange={v => set('outrosTratamentos', v)}
                  detail={form.outrosTratamentosDetalhe} onDetailChange={v => set('outrosTratamentosDetalhe', v)} detailLabel="Quais tratamentos?" />
                <CondField label="Houve alterações recentes na pele?" checked={form.alteracoesRecentes} onChange={v => set('alteracoesRecentes', v)}
                  detail={form.alteracoesRecentesDetalhe} onDetailChange={v => set('alteracoesRecentesDetalhe', v)} detailLabel="Quais alterações?" />
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="drawer-footer">
          <button className="btn btn--ghost btn--md" disabled={tab === 0} onClick={() => setTab(t => t - 1)}>
            <ChevronLeft size={16} /> Anterior
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost btn--md" onClick={onClose}>Cancelar</button>
            {tab < 3
              ? <button className="btn btn--primary btn--md" onClick={() => setTab(t => t + 1)}>Próximo <ChevronRight size={16} /></button>
              : <button className="btn btn--primary btn--md" onClick={handleSave} disabled={saving || !form.nome.trim()}>
                  <Check size={16} /> {saving ? 'Salvando...' : 'Salvar Ficha'}
                </button>
            }
          </div>
        </div>

      </aside>
    </div>
  );
}

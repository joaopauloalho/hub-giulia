import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Check, User, Heart, Apple, Sparkles } from 'lucide-react';
import type { Paciente } from '../../types';

type FormData = Omit<Paciente, 'id' | 'createdAt'>;

const empty: FormData = {
  dataConsulta: new Date().toISOString().slice(0, 10),
  dataNascimento: '',
  nome: '',
  idade: '',
  estadoCivil: '',
  celular: '',
  profissao: '',
  email: '',
  peso: '',
  altura: '',
  instagram: '',
  emergenciaNome: '',
  emergenciaCelular: '',
  convenio: '',
  motivoConsulta: '',

  hipertensao: false,
  hipotensao: false,
  cancer: false,
  diabetes: false,
  problemasCardiacos: false,
  disfuncaoRenal: false,
  fumante: false,
  marcapasso: false,
  problemasVasculares: false,
  epilepsia: false,
  problemasRespiratorios: false,
  problemasTireoide: false,
  problemasCoagulacao: false,
  hivAids: false,
  hepatite: false,

  cirurgiasRecentes: false,
  cirurgiasRecentesDetalhe: '',
  proteseMetalica: false,
  proteseMetalicaRegiao: '',
  desmaios: false,
  desmaioPorque: '',
  herpes: '',
  alergiaAnestesia: '',
  alergiaAbelha: '',
  tratamentoMedico: '',
  usaMedicacao: false,
  medicacaoDetalhe: '',
  gestante: 'nao',
  quantasGestacoes: '',
  tipoParto: '',
  menstruacaoRegular: false,
  metodoContraceptivo: '',
  tpm: false,
  tpmOQueFaz: '',
  alergias: '',
  enxaqueca: false,
  intestinoRegular: false,
  quantidadeAgua: '',
  outrosProblemas: '',
  ansioso: false,
  estressado: false,

  habitoRefrigerante: false,
  habitoFastFood: false,
  habitoDoces: false,
  habitoFrituras: false,
  habitoCigarros: false,
  habitoBebidasAlcoolicas: false,
  alimentacaoEspecial: false,
  alimentacaoEspecialQual: '',
  suplemento: false,
  suplementoQuais: '',
  atividadeFisica: '',

  cuidadosDiarios: '',
  produtosEmUso: '',
  produtoComAcido: '',
  limpezaPele: '',
  microagulhamento: '',
  peeling: '',
  toxinaBotulinica: '',
  fiosSustentacao: '',
  preenchimentoHialuronico: '',
  bioestimulador: '',
  plasticaFacial: '',
  pmma: '',
  outrosTratamentos: '',
  alteracoesRecentes: '',
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

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`field${full ? ' field--full' : ''}`}>
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function FInput({ label, full, ...props }: { label: string; full?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} full={full}>
      <input className="field-input" {...props} />
    </Field>
  );
}

function FTextarea({ label, full, ...props }: { label: string; full?: boolean } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} full={full}>
      <textarea className="field-input" rows={2} {...props} />
    </Field>
  );
}

function RadioGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="radio-group">
        {options.map(opt => (
          <label key={opt.value} className={`radio-option ${value === opt.value ? 'radio-option--active' : ''}`}>
            <input type="radio" value={opt.value} checked={value === opt.value} onChange={() => onChange(opt.value)} />
            {opt.label}
          </label>
        ))}
      </div>
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
        setForm(rest);
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
              <button
                key={t.id}
                className={`drawer-tab ${tab === t.id ? 'drawer-tab--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={15} strokeWidth={1.75} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="drawer-body">

          {/* ── Tab 0: Pessoal ── */}
          {tab === 0 && (
            <div className="form-sections">
              <div className="form-section-title">Informações Pessoais</div>
              <div className="form-grid">
                <FInput label="Data da consulta" type="date" value={form.dataConsulta} onChange={e => set('dataConsulta', e.target.value)} />
                <FInput label="Data de nascimento" type="date" value={form.dataNascimento} onChange={e => set('dataNascimento', e.target.value)} />
                <FInput label="Nome *" value={form.nome} onChange={e => set('nome', e.target.value)} full placeholder="Nome completo" />
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

              <div className="form-section-title" style={{ marginTop: 24 }}>Contato de Emergência</div>
              <div className="form-grid">
                <FInput label="Nome" value={form.emergenciaNome} onChange={e => set('emergenciaNome', e.target.value)} />
                <FInput label="Celular" type="tel" value={form.emergenciaCelular} onChange={e => set('emergenciaCelular', e.target.value)} />
              </div>

              <div className="form-grid" style={{ marginTop: 0 }}>
                <FTextarea label="Motivo da consulta" full value={form.motivoConsulta} onChange={e => set('motivoConsulta', e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Tab 1: Saúde ── */}
          {tab === 1 && (
            <div className="form-sections">
              <div className="form-section-title">Condições de Saúde</div>
              <div className="check-grid">
                {([
                  ['hipertensao', 'Hipertensão'],
                  ['hipotensao', 'Hipotensão'],
                  ['cancer', 'Câncer'],
                  ['diabetes', 'Diabetes'],
                  ['problemasCardiacos', 'Problemas cardíacos'],
                  ['disfuncaoRenal', 'Disfunção renal'],
                  ['fumante', 'Fumante'],
                  ['marcapasso', 'Marcapasso'],
                  ['problemasVasculares', 'Problemas vasculares'],
                  ['epilepsia', 'Epilepsia / convulsão'],
                  ['problemasRespiratorios', 'Problemas respiratórios'],
                  ['problemasTireoide', 'Tireoide'],
                  ['problemasCoagulacao', 'Coagulação sanguínea'],
                  ['hivAids', 'HIV / AIDS'],
                  ['hepatite', 'Hepatite'],
                ] as [keyof FormData, string][]).map(([key, label]) => (
                  <CheckItem
                    key={key}
                    label={label}
                    checked={form[key] as boolean}
                    onChange={v => set(key, v as FormData[typeof key])}
                  />
                ))}
              </div>

              <div className="form-section-title" style={{ marginTop: 24 }}>Histórico Médico</div>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label">Cirurgias recentes?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.cirurgiasRecentes ? 'sim' : 'nao'} onChange={v => set('cirurgiasRecentes', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.cirurgiasRecentes && <input className="field-input" placeholder="Especifique" value={form.cirurgiasRecentesDetalhe} onChange={e => set('cirurgiasRecentesDetalhe', e.target.value)} />}
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Próteses metálicas?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.proteseMetalica ? 'sim' : 'nao'} onChange={v => set('proteseMetalica', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.proteseMetalica && <input className="field-input" placeholder="Qual região?" value={form.proteseMetalicaRegiao} onChange={e => set('proteseMetalicaRegiao', e.target.value)} />}
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Episódios de desmaio?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.desmaios ? 'sim' : 'nao'} onChange={v => set('desmaios', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.desmaios && <input className="field-input" placeholder="Por quê?" value={form.desmaioPorque} onChange={e => set('desmaioPorque', e.target.value)} />}
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Uso de medicação?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.usaMedicacao ? 'sim' : 'nao'} onChange={v => set('usaMedicacao', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.usaMedicacao && <input className="field-input" placeholder="Especifique" value={form.medicacaoDetalhe} onChange={e => set('medicacaoDetalhe', e.target.value)} />}
                  </div>
                </div>

                <FTextarea label="Já teve Herpes? Quando e como tratou?" value={form.herpes} onChange={e => set('herpes', e.target.value)} />
                <FTextarea label="Alergia a anestesia odontológica?" value={form.alergiaAnestesia} onChange={e => set('alergiaAnestesia', e.target.value)} />
                <FTextarea label="Alergia a picada de abelha?" value={form.alergiaAbelha} onChange={e => set('alergiaAbelha', e.target.value)} />
                <FTextarea label="Realiza/realizou algum tratamento médico?" value={form.tratamentoMedico} onChange={e => set('tratamentoMedico', e.target.value)} />
                <FTextarea label="Alergias ou sensibilidades (lidocaína, frutos do mar, latex, sulfato, hidroquinona, babosa...)" full value={form.alergias} onChange={e => set('alergias', e.target.value)} />
              </div>

              <div className="form-section-title" style={{ marginTop: 24 }}>Saúde Feminina</div>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label">Gestante?</label>
                  <div className="radio-group">
                    {[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }, { value: 'filhos', label: 'Tem filhos' }].map(opt => (
                      <label key={opt.value} className={`radio-option ${form.gestante === opt.value ? 'radio-option--active' : ''}`}>
                        <input type="radio" checked={form.gestante === opt.value} onChange={() => set('gestante', opt.value)} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {(form.gestante === 'sim' || form.gestante === 'filhos') && <>
                  <FInput label="Quantas gestações?" value={form.quantasGestacoes} onChange={e => set('quantasGestacoes', e.target.value)} />
                  <div className="field">
                    <label className="field-label">Tipo de parto</label>
                    <div className="radio-group">
                      {[{ value: 'cesaria', label: 'Cesárea' }, { value: 'normal', label: 'Normal' }].map(opt => (
                        <label key={opt.value} className={`radio-option ${form.tipoParto === opt.value ? 'radio-option--active' : ''}`}>
                          <input type="radio" checked={form.tipoParto === opt.value} onChange={() => set('tipoParto', opt.value)} />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </>}

                <RadioGroup label="Menstruação regular?" value={form.menstruacaoRegular ? 'sim' : 'nao'} onChange={v => set('menstruacaoRegular', v === 'sim')}
                  options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                <FInput label="Método contraceptivo" value={form.metodoContraceptivo} onChange={e => set('metodoContraceptivo', e.target.value)} placeholder="Pílula, DIU..." />

                <div className="field">
                  <label className="field-label">Sofre com TPM?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.tpm ? 'sim' : 'nao'} onChange={v => set('tpm', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.tpm && <input className="field-input" placeholder="O que faz?" value={form.tpmOQueFaz} onChange={e => set('tpmOQueFaz', e.target.value)} />}
                  </div>
                </div>
              </div>

              <div className="form-section-title" style={{ marginTop: 24 }}>Bem-estar</div>
              <div className="form-grid">
                <RadioGroup label="Enxaqueca?" value={form.enxaqueca ? 'sim' : 'nao'} onChange={v => set('enxaqueca', v === 'sim')}
                  options={[{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }]} />
                <RadioGroup label="Funcionamento intestinal regular?" value={form.intestinoRegular ? 'sim' : 'nao'} onChange={v => set('intestinoRegular', v === 'sim')}
                  options={[{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }]} />
                <FInput label="Quantidade de água por dia" value={form.quantidadeAgua} onChange={e => set('quantidadeAgua', e.target.value)} placeholder="Ex: 2 litros" />
                <RadioGroup label="Sente-se ansiosa/nervosa?" value={form.ansioso ? 'sim' : 'nao'} onChange={v => set('ansioso', v === 'sim')}
                  options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                <RadioGroup label="Sente-se estressada?" value={form.estressado ? 'sim' : 'nao'} onChange={v => set('estressado', v === 'sim')}
                  options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                <FTextarea label="Outros problemas não citados" full value={form.outrosProblemas} onChange={e => set('outrosProblemas', e.target.value)} />
              </div>
            </div>
          )}

          {/* ── Tab 2: Hábitos ── */}
          {tab === 2 && (
            <div className="form-sections">
              <div className="form-section-title">Hábitos Alimentares</div>
              <div className="check-grid">
                {([
                  ['habitoRefrigerante', 'Refrigerante'],
                  ['habitoFastFood', 'Fast food'],
                  ['habitoDoces', 'Doces'],
                  ['habitoFrituras', 'Frituras'],
                  ['habitoCigarros', 'Cigarros'],
                  ['habitoBebidasAlcoolicas', 'Bebidas alcoólicas'],
                ] as [keyof FormData, string][]).map(([key, label]) => (
                  <CheckItem key={key} label={label} checked={form[key] as boolean} onChange={v => set(key, v as FormData[typeof key])} />
                ))}
              </div>

              <div className="form-grid" style={{ marginTop: 20 }}>
                <div className="field">
                  <label className="field-label">Alimentação especial / dieta?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.alimentacaoEspecial ? 'sim' : 'nao'} onChange={v => set('alimentacaoEspecial', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.alimentacaoEspecial && <input className="field-input" placeholder="Qual dieta?" value={form.alimentacaoEspecialQual} onChange={e => set('alimentacaoEspecialQual', e.target.value)} />}
                  </div>
                </div>

                <div className="field">
                  <label className="field-label">Uso de suplementos?</label>
                  <div className="inline-radio-row">
                    <RadioGroup label="" value={form.suplemento ? 'sim' : 'nao'} onChange={v => set('suplemento', v === 'sim')}
                      options={[{ value: 'nao', label: 'Não' }, { value: 'sim', label: 'Sim' }]} />
                    {form.suplemento && <input className="field-input" placeholder="Quais?" value={form.suplementoQuais} onChange={e => set('suplementoQuais', e.target.value)} />}
                  </div>
                </div>

                <FTextarea label="Atividade física" full value={form.atividadeFisica} onChange={e => set('atividadeFisica', e.target.value)} placeholder="Tipo, frequência..." />
              </div>
            </div>
          )}

          {/* ── Tab 3: Estética ── */}
          {tab === 3 && (
            <div className="form-sections">
              <div className="form-section-title">Rotina Diária de Pele</div>
              <div className="form-grid">
                <FTextarea label="Cuidados diários com a pele" full value={form.cuidadosDiarios} onChange={e => set('cuidadosDiarios', e.target.value)} placeholder="Limpeza, hidratação, protetor..." />
                <FTextarea label="Produtos em uso" full value={form.produtosEmUso} onChange={e => set('produtosEmUso', e.target.value)} />
                <FInput label="Utiliza produto com ácido?" value={form.produtoComAcido} onChange={e => set('produtoComAcido', e.target.value)} placeholder="Qual? Desde quando?" />
                <FInput label="Realizou Limpeza de pele? Última vez?" value={form.limpezaPele} onChange={e => set('limpezaPele', e.target.value)} placeholder="Sim / Não — data..." />
                <FInput label="Realizou microagulhamento?" value={form.microagulhamento} onChange={e => set('microagulhamento', e.target.value)} placeholder="Sim / Não — data..." />
                <FInput label="Realizou peeling? Qual?" value={form.peeling} onChange={e => set('peeling', e.target.value)} placeholder="Tipo e data..." />
              </div>

              <div className="form-section-title" style={{ marginTop: 24 }}>Procedimentos Estéticos</div>
              <div className="form-grid">
                <FInput label="Toxina botulínica — última aplicação" value={form.toxinaBotulinica} onChange={e => set('toxinaBotulinica', e.target.value)} placeholder="Nunca / Data..." />
                <FInput label="Fios de sustentação — última vez" value={form.fiosSustentacao} onChange={e => set('fiosSustentacao', e.target.value)} placeholder="Nunca / Data..." />
                <FInput label="Preenchimento com ácido hialurônico — última vez" value={form.preenchimentoHialuronico} onChange={e => set('preenchimentoHialuronico', e.target.value)} placeholder="Nunca / Data..." />
                <FInput label="Bioestimulador de colágeno — última vez" value={form.bioestimulador} onChange={e => set('bioestimulador', e.target.value)} placeholder="Nunca / Data..." />
                <FInput label="Já fez plástica facial?" value={form.plasticaFacial} onChange={e => set('plasticaFacial', e.target.value)} placeholder="Sim / Não — qual..." />
                <FInput label="Tem PMMA?" value={form.pmma} onChange={e => set('pmma', e.target.value)} placeholder="Sim / Não — região..." />
                <FTextarea label="Outros tratamentos estéticos realizados" full value={form.outrosTratamentos} onChange={e => set('outrosTratamentos', e.target.value)} />
                <FTextarea label="Alterações recentes na pele?" full value={form.alteracoesRecentes} onChange={e => set('alteracoesRecentes', e.target.value)} />
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
            {tab < 3 ? (
              <button className="btn btn--primary btn--md" onClick={() => setTab(t => t + 1)}>
                Próximo <ChevronRight size={16} />
              </button>
            ) : (
              <button className="btn btn--primary btn--md" onClick={handleSave} disabled={saving || !form.nome.trim()}>
                <Check size={16} /> {saving ? 'Salvando...' : 'Salvar Ficha'}
              </button>
            )}
          </div>
        </div>

      </aside>
    </div>
  );
}

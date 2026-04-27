import { X, Phone, Mail, Instagram, Calendar, Heart, Apple, Sparkles, User, type LucideIcon } from 'lucide-react';
import type { Paciente } from '../../types';

interface Props {
  paciente: Paciente | null;
  onClose: () => void;
  onEdit: () => void;
}

function fmt(v: string | undefined | null) {
  return v && v.trim() ? v : '—';
}

function Row({ label, value }: { label: string; value: string | boolean | undefined | null }) {
  const display = typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : fmt(value as string);
  if (display === '—') return null;
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <span className="view-value">{display}</span>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="view-section">
      <div className="view-section-header">
        <Icon size={15} strokeWidth={1.75} />
        <span>{title}</span>
      </div>
      <div className="view-rows">{children}</div>
    </div>
  );
}

function Tags({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="view-tags">
      {items.map(item => <span key={item} className="badge badge--gold">{item}</span>)}
    </div>
  );
}

export function PacienteView({ paciente, onClose, onEdit }: Props) {
  if (!paciente) return null;

  const condicoes = [
    paciente.hipertensao && 'Hipertensão',
    paciente.hipotensao && 'Hipotensão',
    paciente.cancer && 'Câncer',
    paciente.diabetes && 'Diabetes',
    paciente.problemasCardiacos && 'Problemas cardíacos',
    paciente.disfuncaoRenal && 'Disfunção renal',
    paciente.fumante && 'Fumante',
    paciente.marcapasso && 'Marcapasso',
    paciente.problemasVasculares && 'Problemas vasculares',
    paciente.epilepsia && 'Epilepsia',
    paciente.problemasRespiratorios && 'Prob. respiratórios',
    paciente.problemasTireoide && 'Tireoide',
    paciente.problemasCoagulacao && 'Coagulação',
    paciente.hivAids && 'HIV/AIDS',
    paciente.hepatite && 'Hepatite',
  ].filter(Boolean) as string[];

  const habitos = [
    paciente.habitoRefrigerante && 'Refrigerante',
    paciente.habitoFastFood && 'Fast food',
    paciente.habitoDoces && 'Doces',
    paciente.habitoFrituras && 'Frituras',
    paciente.habitoCigarros && 'Cigarros',
    paciente.habitoBebidasAlcoolicas && 'Bebidas alcoólicas',
  ].filter(Boolean) as string[];

  const dataConsulta = paciente.dataConsulta
    ? new Date(paciente.dataConsulta + 'T12:00:00').toLocaleDateString('pt-BR')
    : '—';
  const dataNasc = paciente.dataNascimento
    ? new Date(paciente.dataNascimento + 'T12:00:00').toLocaleDateString('pt-BR')
    : '—';

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="avatar" style={{ width: 44, height: 44, fontSize: '1.1rem' }}>
              {paciente.nome[0]?.toUpperCase()}
            </div>
            <div>
              <h2 className="drawer-title">{paciente.nome}</h2>
              <p className="drawer-sub" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {paciente.celular && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} />{paciente.celular}</span>}
                {paciente.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} />{paciente.email}</span>}
                {paciente.instagram && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Instagram size={12} />{paciente.instagram}</span>}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost btn--sm" onClick={onEdit}>Editar</button>
            <button onClick={onClose} className="modal-close"><X size={18} /></button>
          </div>
        </div>

        {/* Chips */}
        <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {paciente.dataConsulta && (
            <span className="badge badge--blue" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Calendar size={12} /> Consulta: {dataConsulta}
            </span>
          )}
          {paciente.idade && <span className="badge badge--gray">{paciente.idade} anos</span>}
          {paciente.convenio && <span className="badge badge--amber">Convênio: {paciente.convenio}</span>}
        </div>

        {/* Body */}
        <div className="drawer-body">

          {paciente.motivoConsulta && (
            <div className="view-motivo">
              <span className="field-label">Motivo da consulta</span>
              <p>{paciente.motivoConsulta}</p>
            </div>
          )}

          <Section title="Informações Pessoais" icon={User}>
            <Row label="Data de nascimento" value={dataNasc} />
            <Row label="Estado civil" value={paciente.estadoCivil} />
            <Row label="Profissão" value={paciente.profissao} />
            <Row label="Peso" value={paciente.peso} />
            <Row label="Altura" value={paciente.altura} />
            <Row label="Convênio" value={paciente.convenio} />
            {(paciente.emergenciaNome || paciente.emergenciaCelular) && (
              <Row label="Emergência" value={`${paciente.emergenciaNome} — ${paciente.emergenciaCelular}`} />
            )}
          </Section>

          <Section title="Saúde" icon={Heart}>
            {condicoes.length > 0 && (
              <div className="view-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <span className="view-label">Condições</span>
                <Tags items={condicoes} />
              </div>
            )}
            <Row label="Cirurgias recentes" value={paciente.cirurgiasRecentes ? `Sim — ${paciente.cirurgiasRecentesDetalhe || ''}` : 'Não'} />
            <Row label="Próteses metálicas" value={paciente.proteseMetalica ? `Sim — ${paciente.proteseMetalicaRegiao || ''}` : 'Não'} />
            <Row label="Desmaios" value={paciente.desmaios ? `Sim — ${paciente.desmaioPorque || ''}` : 'Não'} />
            <Row label="Herpes" value={paciente.herpes} />
            <Row label="Alergia anestesia" value={paciente.alergiaAnestesia} />
            <Row label="Alergia abelha" value={paciente.alergiaAbelha} />
            <Row label="Tratamento médico" value={paciente.tratamentoMedico} />
            <Row label="Medicação" value={paciente.usaMedicacao ? `Sim — ${paciente.medicacaoDetalhe || ''}` : 'Não'} />
            <Row label="Alergias / sensibilidades" value={paciente.alergias} />
            <Row label="Enxaqueca" value={paciente.enxaqueca} />
            <Row label="Intestino regular" value={paciente.intestinoRegular} />
            <Row label="Água por dia" value={paciente.quantidadeAgua} />
            <Row label="Ansiosa / nervosa" value={paciente.ansioso} />
            <Row label="Estressada" value={paciente.estressado} />
            <Row label="Outros problemas" value={paciente.outrosProblemas} />
            <Row label="Gestante / filhos" value={paciente.gestante === 'nao' ? 'Não' : paciente.gestante === 'sim' ? 'Sim' : 'Tem filhos'} />
            {(paciente.gestante === 'sim' || paciente.gestante === 'filhos') && (
              <>
                <Row label="Gestações" value={paciente.quantasGestacoes} />
                <Row label="Tipo de parto" value={paciente.tipoParto === 'cesaria' ? 'Cesárea' : paciente.tipoParto === 'normal' ? 'Normal' : ''} />
              </>
            )}
            <Row label="Menstruação regular" value={paciente.menstruacaoRegular} />
            <Row label="Método contraceptivo" value={paciente.metodoContraceptivo} />
            <Row label="TPM" value={paciente.tpm ? `Sim — ${paciente.tpmOQueFaz || ''}` : 'Não'} />
          </Section>

          <Section title="Hábitos Alimentares" icon={Apple}>
            {habitos.length > 0 && (
              <div className="view-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <span className="view-label">Consumo habitual</span>
                <Tags items={habitos} />
              </div>
            )}
            <Row label="Dieta especial" value={paciente.alimentacaoEspecial ? `Sim — ${paciente.alimentacaoEspecialQual || ''}` : 'Não'} />
            <Row label="Suplementos" value={paciente.suplemento ? `Sim — ${paciente.suplementoQuais || ''}` : 'Não'} />
            <Row label="Atividade física" value={paciente.atividadeFisica} />
          </Section>

          <Section title="Rotina Estética" icon={Sparkles}>
            <Row label="Cuidados diários" value={paciente.cuidadosDiarios} />
            <Row label="Produtos em uso" value={paciente.produtosEmUso} />
            <Row label="Produto com ácido" value={paciente.produtoComAcido} />
            <Row label="Limpeza de pele" value={paciente.limpezaPele} />
            <Row label="Microagulhamento" value={paciente.microagulhamento} />
            <Row label="Peeling" value={paciente.peeling} />
            <Row label="Toxina botulínica" value={paciente.toxinaBotulinica} />
            <Row label="Fios de sustentação" value={paciente.fiosSustentacao} />
            <Row label="Preenchimento hialurônico" value={paciente.preenchimentoHialuronico} />
            <Row label="Bioestimulador colágeno" value={paciente.bioestimulador} />
            <Row label="Plástica facial" value={paciente.plasticaFacial} />
            <Row label="PMMA" value={paciente.pmma} />
            <Row label="Outros tratamentos" value={paciente.outrosTratamentos} />
            <Row label="Alterações recentes" value={paciente.alteracoesRecentes} />
          </Section>

        </div>

        <div className="drawer-footer">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
            Cadastrado em {new Date(paciente.createdAt).toLocaleDateString('pt-BR')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--ghost btn--md" onClick={onEdit}>Editar ficha</button>
            <button className="btn btn--ghost btn--md" onClick={onClose}>Fechar</button>
          </div>
        </div>

      </aside>
    </div>
  );
}

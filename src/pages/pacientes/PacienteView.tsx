import { X, Phone, Mail, Instagram, Calendar, Heart, Apple, Sparkles, User, type LucideIcon } from 'lucide-react';
import type { Paciente } from '../../types';

interface Props {
  paciente: Paciente | null;
  onClose: () => void;
  onEdit: () => void;
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="view-section">
      <div className="view-section-header"><Icon size={14} strokeWidth={1.75} /><span>{title}</span></div>
      <div className="view-rows">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | boolean | null }) {
  if (value === undefined || value === null || value === '' || value === false) return null;
  const display = value === true ? 'Sim' : String(value);
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <span className="view-value">{display}</span>
    </div>
  );
}

function CondRow({ label, yes, detail }: { label: string; yes: boolean; detail?: string }) {
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <span className="view-value" style={{ color: yes ? 'var(--text)' : 'var(--text-3)' }}>
        {yes ? `Sim${detail ? ` — ${detail}` : ''}` : 'Não'}
      </span>
    </div>
  );
}

function Tags({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <div className="view-tags">{items.map(i => <span key={i} className="badge badge--gold">{i}</span>)}</div>;
}

export function PacienteView({ paciente, onClose, onEdit }: Props) {
  if (!paciente) return null;

  const p = paciente;

  const condicoes = [
    p.hipertensao && 'Hipertensão', p.hipotensao && 'Hipotensão',
    p.cancer && 'Câncer', p.diabetes && 'Diabetes',
    p.problemasCardiacos && 'Problemas cardíacos', p.disfuncaoRenal && 'Disfunção renal',
    p.fumante && 'Fumante', p.marcapasso && 'Marcapasso',
    p.problemasVasculares && 'Prob. vasculares', p.epilepsia && 'Epilepsia',
    p.problemasRespiratorios && 'Prob. respiratórios', p.problemasTireoide && 'Tireoide',
    p.problemasCoagulacao && 'Coagulação', p.hivAids && 'HIV/AIDS',
    p.hepatite && 'Hepatite',
  ].filter(Boolean) as string[];

  const habitos = [
    p.habitoRefrigerante && 'Refrigerante', p.habitoFastFood && 'Fast food',
    p.habitoDoces && 'Doces', p.habitoFrituras && 'Frituras',
    p.habitoCigarros && 'Cigarros', p.habitoBebidasAlcoolicas && 'Bebidas alcoólicas',
  ].filter(Boolean) as string[];

  const fmtDate = (iso?: string) =>
    iso ? new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR') : '';

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="avatar" style={{ width: 44, height: 44, fontSize: '1.1rem', flexShrink: 0 }}>
              {p.nome[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <h2 className="drawer-title">{p.nome}</h2>
              <p className="drawer-sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 3 }}>
                {p.celular && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} />{p.celular}</span>}
                {p.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={12} />{p.email}</span>}
                {p.instagram && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Instagram size={12} />{p.instagram}</span>}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn btn--ghost btn--sm" onClick={onEdit}>Editar</button>
            <button onClick={onClose} className="modal-close"><X size={18} /></button>
          </div>
        </div>

        {/* Badges */}
        <div style={{ padding: '10px 24px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {p.dataConsulta && <span className="badge badge--blue" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={12} />{fmtDate(p.dataConsulta)}</span>}
          {p.idade && <span className="badge badge--gray">{p.idade} anos</span>}
          {p.convenio && <span className="badge badge--amber">Convênio: {p.convenio}</span>}
          {condicoes.length > 0 && <span className="badge badge--red">{condicoes.length} condição{condicoes.length > 1 ? 'ões' : ''}</span>}
        </div>

        {/* Body */}
        <div className="drawer-body">

          {p.motivoConsulta && (
            <div className="view-motivo">
              <span className="field-label">Motivo da consulta</span>
              <p style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{p.motivoConsulta}</p>
            </div>
          )}

          <Section title="Informações Pessoais" icon={User}>
            <Row label="Data de nascimento" value={fmtDate(p.dataNascimento)} />
            <Row label="Estado civil" value={p.estadoCivil} />
            <Row label="Profissão" value={p.profissao} />
            <Row label="Peso / Altura" value={[p.peso, p.altura].filter(Boolean).join(' — ')} />
            {(p.emergenciaNome || p.emergenciaCelular) && (
              <Row label="Emergência" value={[p.emergenciaNome, p.emergenciaCelular].filter(Boolean).join(' — ')} />
            )}
          </Section>

          <Section title="Saúde" icon={Heart}>
            {condicoes.length > 0 && (
              <div className="view-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <span className="view-label">Condições</span>
                <Tags items={condicoes} />
              </div>
            )}
            <CondRow label="Cirurgias recentes" yes={p.cirurgiasRecentes} detail={p.cirurgiasRecentesDetalhe} />
            <CondRow label="Próteses metálicas" yes={p.proteseMetalica} detail={p.proteseMetalicaRegiao} />
            <CondRow label="Desmaios" yes={p.desmaios} detail={p.desmaioPorque} />
            <CondRow label="Herpes" yes={p.herpes} detail={p.herpesDetalhe} />
            <CondRow label="Alergia anestesia" yes={p.alergiaAnestesia} detail={p.alergiaAnestesiaDetalhe} />
            <CondRow label="Alergia abelha" yes={p.alergiaAbelha} detail={p.alergiaAbelhaDetalhe} />
            <CondRow label="Tratamento médico" yes={p.tratamentoMedico} detail={p.tratamentoMedicoDetalhe} />
            <CondRow label="Medicação" yes={p.usaMedicacao} detail={p.medicacaoDetalhe} />
            <CondRow label="Alergias / sensibilidades" yes={p.alergias} detail={p.alergiasDetalhe} />
            <Row label="Enxaqueca" value={p.enxaqueca ? 'Sim' : undefined} />
            <Row label="Intestino irregular" value={!p.intestinoRegular ? 'Irregular' : undefined} />
            <Row label="Água por dia" value={p.quantidadeAgua} />
            <Row label="Ansiosa" value={p.ansioso ? 'Sim' : undefined} />
            <Row label="Estressada" value={p.estressado ? 'Sim' : undefined} />
            <CondRow label="Outros problemas" yes={!!p.outrosProblemas} detail={p.outrosProblemas} />
            <Row label="Gestante / filhos" value={p.gestante === 'nao' ? undefined : p.gestante === 'sim' ? 'Grávida' : 'Tem filhos'} />
            {(p.gestante === 'sim' || p.gestante === 'filhos') && (
              <>
                <Row label="Gestações" value={p.quantasGestacoes} />
                <Row label="Tipo de parto" value={p.tipoParto === 'cesaria' ? 'Cesárea' : p.tipoParto === 'normal' ? 'Normal' : ''} />
              </>
            )}
            <Row label="Menstruação irregular" value={!p.menstruacaoRegular ? 'Irregular' : undefined} />
            <Row label="Método contraceptivo" value={p.metodoContraceptivo} />
            <CondRow label="TPM" yes={p.tpm} detail={p.tpmOQueFaz} />
          </Section>

          <Section title="Hábitos Alimentares" icon={Apple}>
            {habitos.length > 0 && (
              <div className="view-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <span className="view-label">Consumo habitual</span>
                <Tags items={habitos} />
              </div>
            )}
            <CondRow label="Dieta especial" yes={p.alimentacaoEspecial} detail={p.alimentacaoEspecialQual} />
            <CondRow label="Suplementos" yes={p.suplemento} detail={p.suplementoQuais} />
            <CondRow label="Atividade física" yes={p.atividadeFisica} detail={p.atividadeFisicaDetalhe} />
          </Section>

          <Section title="Rotina Estética" icon={Sparkles}>
            <Row label="Cuidados diários" value={p.cuidadosDiarios} />
            <Row label="Produtos em uso" value={p.produtosEmUso} />
            <CondRow label="Produto com ácido" yes={p.produtoComAcido} detail={p.produtoComAcidoDetalhe} />
            <CondRow label="Limpeza de pele" yes={p.limpezaPele} detail={p.limpezaPeleData} />
            <CondRow label="Microagulhamento" yes={p.microagulhamento} detail={p.microagulhamentoData} />
            <CondRow label="Peeling" yes={p.peeling} detail={p.peelingDetalhe} />
            <CondRow label="Toxina botulínica" yes={p.toxinaBotulinica} detail={p.toxinaBotulinicaData} />
            <CondRow label="Fios de sustentação" yes={p.fiosSustentacao} detail={p.fiosSustentacaoData} />
            <CondRow label="Preenchimento hialurônico" yes={p.preenchimentoHialuronico} detail={p.preenchimentoHialuronicoData} />
            <CondRow label="Bioestimulador colágeno" yes={p.bioestimulador} detail={p.bioestimuladorData} />
            <CondRow label="Plástica facial" yes={p.plasticaFacial} detail={p.plasticaFacialDetalhe} />
            <CondRow label="PMMA" yes={p.pmma} detail={p.pmmaRegiao} />
            <CondRow label="Outros tratamentos" yes={p.outrosTratamentos} detail={p.outrosTratamentosDetalhe} />
            <CondRow label="Alterações recentes" yes={p.alteracoesRecentes} detail={p.alteracoesRecentesDetalhe} />
          </Section>

        </div>

        <div className="drawer-footer">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
            Cadastrada em {new Date(p.createdAt).toLocaleDateString('pt-BR')}
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

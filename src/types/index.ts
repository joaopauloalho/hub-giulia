export interface Contact {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
}

export interface Deal {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string;
  value: number | null;
  stage: 'lead' | 'qualified' | 'proposal' | 'won' | 'lost';
  expected_close: string | null;
  created_at: string;
  contact?: Pick<Contact, 'id' | 'name' | 'company'>;
}

export interface Activity {
  id: string;
  user_id: string;
  contact_id: string | null;
  deal_id: string | null;
  type: 'call' | 'email' | 'meeting' | 'note';
  description: string | null;
  scheduled_at: string | null;
  completed: boolean;
  created_at: string;
}

export type DealStage = Deal['stage'];
export type ActivityType = Activity['type'];

export interface Paciente {
  id: string;
  createdAt: string;

  // Informações Pessoais
  dataConsulta: string;
  dataNascimento: string;
  nome: string;
  idade: string;
  estadoCivil: string;
  celular: string;
  profissao: string;
  email: string;
  peso: string;
  altura: string;
  instagram: string;
  emergenciaNome: string;
  emergenciaCelular: string;
  convenio: string;
  motivoConsulta: string;

  // Condições médicas (checkboxes)
  hipertensao: boolean;
  hipotensao: boolean;
  cancer: boolean;
  diabetes: boolean;
  problemasCardiacos: boolean;
  disfuncaoRenal: boolean;
  fumante: boolean;
  marcapasso: boolean;
  problemasVasculares: boolean;
  epilepsia: boolean;
  problemasRespiratorios: boolean;
  problemasTireoide: boolean;
  problemasCoagulacao: boolean;
  hivAids: boolean;
  hepatite: boolean;

  // Histórico médico — closed questions (boolean + detail)
  cirurgiasRecentes: boolean;
  cirurgiasRecentesDetalhe: string;
  proteseMetalica: boolean;
  proteseMetalicaRegiao: string;
  desmaios: boolean;
  desmaioPorque: string;
  herpes: boolean;
  herpesDetalhe: string;
  alergiaAnestesia: boolean;
  alergiaAnestesiaDetalhe: string;
  alergiaAbelha: boolean;
  alergiaAbelhaDetalhe: string;
  tratamentoMedico: boolean;
  tratamentoMedicoDetalhe: string;
  usaMedicacao: boolean;
  medicacaoDetalhe: string;
  alergias: boolean;
  alergiasDetalhe: string;

  // Saúde feminina
  gestante: string;
  quantasGestacoes: string;
  tipoParto: string;
  menstruacaoRegular: boolean;
  metodoContraceptivo: string;
  tpm: boolean;
  tpmOQueFaz: string;

  // Bem-estar
  enxaqueca: boolean;
  intestinoRegular: boolean;
  quantidadeAgua: string;
  outrosProblemas: string;
  ansioso: boolean;
  estressado: boolean;

  // Hábitos Alimentares
  habitoRefrigerante: boolean;
  habitoFastFood: boolean;
  habitoDoces: boolean;
  habitoFrituras: boolean;
  habitoCigarros: boolean;
  habitoBebidasAlcoolicas: boolean;
  alimentacaoEspecial: boolean;
  alimentacaoEspecialQual: string;
  suplemento: boolean;
  suplementoQuais: string;
  atividadeFisica: boolean;
  atividadeFisicaDetalhe: string;

  // Rotina de Cuidado Pessoal — closed questions
  cuidadosDiarios: string;
  produtosEmUso: string;
  produtoComAcido: boolean;
  produtoComAcidoDetalhe: string;
  limpezaPele: boolean;
  limpezaPeleData: string;
  microagulhamento: boolean;
  microagulhamentoData: string;
  peeling: boolean;
  peelingDetalhe: string;
  toxinaBotulinica: boolean;
  toxinaBotulinicaData: string;
  fiosSustentacao: boolean;
  fiosSustentacaoData: string;
  preenchimentoHialuronico: boolean;
  preenchimentoHialuronicoData: string;
  bioestimulador: boolean;
  bioestimuladorData: string;
  plasticaFacial: boolean;
  plasticaFacialDetalhe: string;
  pmma: boolean;
  pmmaRegiao: string;
  outrosTratamentos: boolean;
  outrosTratamentosDetalhe: string;
  alteracoesRecentes: boolean;
  alteracoesRecentesDetalhe: string;
}

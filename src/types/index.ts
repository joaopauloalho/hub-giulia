export interface Patient {
  id: string;
  user_id: string;
  name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  profession: string | null;
  civil_status: string | null;
  weight: string | null;
  height: string | null;
  instagram: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  convenio: string | null;
  notes: string | null;
  photo_url: string | null;
  start_date: string | null;
  created_at: string;
}

export interface AnamnesisConditions {
  hipertensao?: boolean;
  hipotensao?: boolean;
  cancer?: boolean;
  diabetes?: boolean;
  problemas_cardiacos?: boolean;
  disfuncao_renal?: boolean;
  fumante?: boolean;
  marcapasso?: boolean;
  problemas_vasculares?: boolean;
  epilepsia?: boolean;
  problemas_respiratorios?: boolean;
  problemas_tireoide?: boolean;
  problemas_coagulacao?: boolean;
  hiv_aids?: boolean;
  hepatite?: boolean;
}

export interface AnamnesisHabits {
  refrigerante?: boolean;
  fast_food?: boolean;
  doces?: boolean;
  frituras?: boolean;
  cigarros?: boolean;
  bebidas_alcoolicas?: boolean;
  alimentacao_especial?: boolean;
  alimentacao_especial_qual?: string;
  suplemento?: boolean;
  suplemento_quais?: string;
  atividade_fisica?: boolean;
  atividade_fisica_detalhe?: string;
  quantidade_agua?: string;
}

export interface AnamnesisAesthetics {
  cuidados_diarios?: string;
  produtos_em_uso?: string;
  produto_com_acido?: boolean;
  produto_com_acido_detalhe?: string;
  limpeza_pele?: boolean;
  limpeza_pele_data?: string;
  microagulhamento?: boolean;
  microagulhamento_data?: string;
  peeling?: boolean;
  peeling_detalhe?: string;
  toxina_botulinica?: boolean;
  toxina_botulinica_data?: string;
  fios_sustentacao?: boolean;
  fios_sustentacao_data?: string;
  preenchimento_hialuronico?: boolean;
  preenchimento_hialuronico_data?: string;
  bioestimulador?: boolean;
  bioestimulador_data?: string;
  plastica_facial?: boolean;
  plastica_facial_detalhe?: string;
  pmma?: boolean;
  pmma_regiao?: string;
  outros_tratamentos?: boolean;
  outros_tratamentos_detalhe?: string;
  alteracoes_recentes?: boolean;
  alteracoes_recentes_detalhe?: string;
}

export interface AnamnosisSurgicalHistory {
  cirurgias_recentes?: boolean;
  cirurgias_recentes_detalhe?: string;
  protese_metalica?: boolean;
  protese_metalica_regiao?: string;
  desmaios?: boolean;
  desmaio_porque?: string;
  herpes?: boolean;
  herpes_detalhe?: string;
  alergia_anestesia?: boolean;
  alergia_anestesia_detalhe?: string;
  alergia_abelha?: boolean;
  alergia_abelha_detalhe?: string;
  tratamento_medico?: boolean;
  tratamento_medico_detalhe?: string;
  usa_medicacao?: boolean;
  medicacao_detalhe?: string;
  alergias?: boolean;
  alergias_detalhe?: string;
  gestante?: string;
  quantas_gestacoes?: string;
  tipo_parto?: string;
  menstruacao_regular?: boolean;
  metodo_contraceptivo?: string;
  tpm?: boolean;
  tpm_o_que_faz?: string;
  enxaqueca?: boolean;
  intestino_regular?: boolean;
  outros_problemas?: string;
  ansioso?: boolean;
  estressado?: boolean;
}

export interface Anamnesis {
  id: string;
  patient_id: string;
  user_id: string;
  conditions: AnamnesisConditions;
  medications: string | null;
  allergies: string | null;
  surgical_history: AnamnosisSurgicalHistory;
  habits: AnamnesisHabits;
  aesthetics: AnamnesisAesthetics;
  updated_at: string;
}

export interface PatientPhoto {
  id: string;
  patient_id: string;
  user_id: string;
  photo_url: string;
  label: string | null;
  taken_at: string;
}

export interface ContractTemplate {
  id: string;
  user_id: string;
  name: string;
  body: string;
  created_at: string;
}

export interface Contract {
  id: string;
  patient_id: string;
  user_id: string;
  template_id: string | null;
  signed_at: string;
  signature_data: string | null;
  pdf_url: string | null;
  template?: Pick<ContractTemplate, 'name'>;
}

export type ServiceType = 'servico' | 'combo' | 'plano' | 'produto';

export interface Service {
  id: string;
  user_id: string;
  name: string;
  type: ServiceType;
  price: number;
  cost_per_unit: number;
  duration_minutes: number | null;
  return_min_days: number | null;
  return_max_days: number | null;
  technical_sheet: string | null;
  active: boolean;
  created_at: string;
}

export type AppointmentStatus = 'pendente' | 'confirmado' | 'realizado' | 'cancelado';

export interface Appointment {
  id: string;
  user_id: string;
  patient_id: string;
  service_id: string | null;
  scheduled_at: string;
  status: AppointmentStatus;
  notes: string | null;
  created_at: string;
  patient?: Pick<Patient, 'id' | 'name' | 'phone'>;
  service?: Pick<Service, 'id' | 'name' | 'duration_minutes'>;
}

export interface MaquininhaConfig {
  credito_pct: number;
  debito_pct: number;
}

export type PaymentMethod = 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'pix' | 'pix_parcelado';

export interface Procedure {
  id: string;
  user_id: string;
  patient_id: string;
  appointment_id: string | null;
  performed_at: string;
  services_ids: string[];
  total_value: number;
  total_cost: number;
  payment_method: PaymentMethod;
  card_fee_pct: number | null;
  card_fee_value: number | null;
  net_value: number;
  notes: string | null;
  created_at: string;
  patient?: Pick<Patient, 'id' | 'name'>;
  services?: Pick<Service, 'id' | 'name' | 'price'>[];
}

export interface PixInstallment {
  id: string;
  user_id: string;
  procedure_id: string;
  installment_num: number;
  total_installments: number;
  amount: number;
  due_date: string;
  paid_at: string | null;
  reminded_at: string | null;
  created_at: string;
  procedure?: Pick<Procedure, 'id' | 'patient_id' | 'total_value'> & {
    patient?: Pick<Patient, 'id' | 'name'>;
  };
}

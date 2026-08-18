import type { AcquisitionSource } from '../lib/acquisition';

export interface Patient {
  id: string;
  user_id: string;
  name: string;
  birth_date: string | null;
  phone: string | null;
  email: string | null;
  cpf: string | null;
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
  acquisition_source: AcquisitionSource | null;
  acquisition_source_detail: string | null;
  referred_by_patient_id: string | null;
  referrer_name: string | null;
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
  procedure_id: string | null;
  photo_type: 'before' | 'after' | 'general';
  photo_url: string;
  label: string | null;
  taken_at: string;
  procedure?: Pick<Procedure, 'id' | 'performed_at' | 'services_ids'> | null;
}

export interface PatientNote {
  id: string;
  patient_id: string;
  user_id: string;
  content: string;
  remind_at: string | null;
  resolved: boolean;
  created_at: string;
  patient?: Pick<Patient, 'id' | 'name'>;
}

export interface ContractTemplate {
  id: string;
  user_id: string;
  name: string;
  body: string;
  active: boolean;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractTemplateVersion {
  id: string;
  template_id: string;
  user_id: string;
  version_number: number;
  name_snapshot: string;
  body: string;
  variables: string[];
  created_by: string;
  created_at: string;
}

export interface ProfessionalProfile {
  user_id: string;
  display_name: string;
  profession: string | null;
  professional_registration: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractStatus = 'draft' | 'ready' | 'signed' | 'voided';

export interface PreparedContract {
  id: string;
  status: ContractStatus;
  template_id: string;
  template_version_id: string;
  document_name: string;
  rendered_content: string;
  patient_snapshot: { name: string; cpf: string | null };
  professional_snapshot: {
    display_name: string;
    profession: string;
    professional_registration: string;
  };
  services_snapshot: Array<{
    procedure_item_id?: string;
    service_id?: string;
    name: string;
    quantity: number;
    list_price?: number;
    final_price?: number;
    discount?: number;
  }>;
  financial_snapshot: { currency: 'BRL'; total_value: number } | null;
  context_snapshot: Record<string, unknown>;
  content_sha256: string;
  ready_at: string;
}

export interface Contract {
  id: string;
  patient_id: string;
  user_id: string;
  template_id: string | null;
  template_version_id: string | null;
  appointment_id: string | null;
  procedure_id: string | null;
  status: ContractStatus;
  source_type: 'legacy' | 'v2';
  document_schema_version: number;
  document_name_snapshot: string | null;
  patient_snapshot: PreparedContract['patient_snapshot'] | null;
  professional_snapshot: PreparedContract['professional_snapshot'] | null;
  services_snapshot: PreparedContract['services_snapshot'] | null;
  financial_snapshot: PreparedContract['financial_snapshot'];
  context_snapshot: Record<string, unknown> | null;
  variables_snapshot: Record<string, string> | null;
  rendered_content_snapshot: string | null;
  content_sha256: string | null;
  signed_at: string | null;
  ready_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  signature_data: string | null;
  signature_path: string | null;
  signature_sha256: string | null;
  pdf_url: string | null;
  pdf_path: string | null;
  pdf_sha256: string | null;
  created_at: string | null;
  template?: Pick<ContractTemplate, 'name'> | null;
  pdf_download_url?: string | null;
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
  is_injectable: boolean;
  created_at: string;
}

// ─── Injetáveis ───────────────────────────────────────────────────────────────

export interface InjectablePoint {
  id: string;
  x: number;
  y: number;
  service_id: string;
  service_name: string;
  color: string;
  quantity: number;
  unit: string;
}

export interface InjectableMap {
  id: string;
  procedure_id: string | null;
  patient_id: string;
  user_id: string;
  created_at: string;
  points: InjectablePoint[];
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
  google_event_id: string | null;
  created_at: string;
  patient?: Pick<Patient, 'id' | 'name' | 'phone'>;
  service?: Pick<Service, 'id' | 'name' | 'duration_minutes'>;
}

// ─── Maquininha / Rates ───────────────────────────────────────────────────────

export type CardBrand = 'master_visa' | 'elo';

export interface BrandRates {
  debito: number;
  [installments: string]: number;
}

export interface MaquininhaRates {
  pix: number;
  master_visa: BrandRates;
  elo: BrandRates;
}

export interface MaquininhaConfig {
  rates: MaquininhaRates;
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export type SimplePaymentMethod = 'dinheiro' | 'pix' | 'cartao_credito' | 'cartao_debito';
export type PaymentMethod = SimplePaymentMethod | 'pix_parcelado' | 'split';

export interface PaymentEntryUI {
  tempId: string;
  method: SimplePaymentMethod;
  baseValue: number;
  cardBrand: CardBrand;
  installments: number;
  absorveTaxa: boolean;
  scheduledDate: string;
}

export interface ProcedurePayment {
  id: string;
  procedure_id: string;
  user_id: string;
  method: string;
  amount: number;
  card_brand: string | null;
  installments: number;
  fee_pct: number | null;
  fee_value: number | null;
  net_amount: number;
  absorve_taxa: boolean;
  scheduled_date: string | null;
  paid_at: string | null;
  created_at: string;
  procedure?: {
    id: string;
    patient_id: string;
    total_value: number;
    patient?: Pick<Patient, 'id' | 'name'>;
  };
}

// ─── Procedure ────────────────────────────────────────────────────────────────

export interface ProcedureItem {
  id: string;
  procedure_id: string;
  user_id: string;
  service_id: string;
  name: string;
  qty: number;
  list_price: number;
  final_price: number;
  discount: number;
  cost_snapshot: number;
  created_at: string;
}

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
  items?: ProcedureItem[];
  payments?: ProcedurePayment[];
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

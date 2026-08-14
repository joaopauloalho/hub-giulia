export const CONTRACT_PLACEHOLDERS = [
  { key: 'patient_name', label: 'Paciente — nome', sample: 'Maria da Silva' },
  { key: 'patient_cpf', label: 'Paciente — CPF', sample: '000.000.000-00' },
  { key: 'professional_name', label: 'Profissional — nome', sample: 'Dra. Profissional' },
  { key: 'professional_registration', label: 'Profissional — registro', sample: 'CRBM 00000' },
  { key: 'professional_profession', label: 'Profissional — profissão', sample: 'Biomédica' },
  { key: 'service_name', label: 'Procedimento — serviço', sample: 'Toxina Botulínica' },
  { key: 'services', label: 'Procedimento — serviços', sample: 'Toxina Botulínica + Preenchimento' },
  { key: 'total_value', label: 'Valores — total', sample: 'R$ 1.500,00' },
  { key: 'procedure_date', label: 'Datas — procedimento/contexto', sample: '14/08/2026' },
  { key: 'current_date', label: 'Datas — documento', sample: '14/08/2026' },
] as const;

export type ContractPlaceholderKey = typeof CONTRACT_PLACEHOLDERS[number]['key'];

const LEGACY_SAMPLES: Record<string, string> = {
  nome: 'Maria da Silva',
  cpf: '000.000.000-00',
  profissional: 'Dra. Profissional',
  servico: 'Toxina Botulínica',
  valor: 'R$ 1.500,00',
  data: '14/08/2026',
};

export const CONTRACT_PREVIEW_VARS: Record<string, string> = Object.fromEntries([
  ...CONTRACT_PLACEHOLDERS.map(item => [item.key, item.sample] as const),
  ...Object.entries(LEGACY_SAMPLES),
]);

export function interpolateContract(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => (
    vars[key.toLowerCase()] ?? match
  ));
}

export function extractContractPlaceholders(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    found.add(match[1].toLowerCase());
  }
  return [...found].sort();
}

export function unresolvedContractPlaceholders(body: string, vars: Record<string, string>): string[] {
  return extractContractPlaceholders(body).filter(key => !vars[key]?.trim());
}

const VARIABLE_LABELS: Record<string, string> = {
  patient_name: 'nome da paciente',
  patient_cpf: 'CPF da paciente',
  professional_name: 'nome profissional',
  professional_registration: 'registro profissional',
  professional_profession: 'profissão',
  service_name: 'serviço/procedimento',
  services: 'serviços/procedimentos',
  total_value: 'valor',
  procedure_date: 'data do procedimento/contexto',
  current_date: 'data do documento',
  nome: 'nome da paciente',
  cpf: 'CPF da paciente',
  profissional: 'nome profissional',
  servico: 'serviço/procedimento',
  valor: 'valor',
  data: 'data',
};

export function contractErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : String((error as { message?: string } | null)?.message ?? '');

  const missing = raw.match(/CONTRACT_MISSING_VARIABLES:([^\n]+)/)?.[1];
  if (missing) {
    const labels = missing.split(',').map(key => VARIABLE_LABELS[key.trim()] ?? key.trim());
    return `Não foi possível preparar o contrato porque faltam: ${labels.join(', ')}.`;
  }
  const unknown = raw.match(/CONTRACT_TEMPLATE_UNKNOWN_PLACEHOLDER:([^\s]+)/)?.[1];
  if (unknown) return `O modelo contém uma variável não permitida: {{${unknown}}}.`;
  if (/PROFESSIONAL_NAME_REQUIRED/.test(raw)) return 'Informe o nome profissional antes de continuar.';
  if (/CONTRACT_TEMPLATE_REQUIRED|TEMPLATE_NOT_FOUND|TEMPLATE_VERSION_NOT_FOUND/.test(raw)) return 'Selecione um modelo de documento válido.';
  if (/PROCEDURE_NOT_FOUND|APPOINTMENT_NOT_FOUND|PATIENT_NOT_FOUND/.test(raw)) return 'O contexto selecionado não está mais disponível.';
  if (/IDEMPOTENCY_MISMATCH/.test(raw)) return 'A preparação mudou durante a operação. Tente novamente.';
  if (/ALREADY_FINALIZED/.test(raw)) return 'Este documento já foi finalizado.';
  if (/SESSION_REQUIRED|JWT|session/i.test(raw)) return 'Sua sessão expirou. Entre novamente.';
  return 'Não foi possível concluir a operação do contrato.';
}

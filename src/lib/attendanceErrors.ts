export class AttendanceSessionError extends Error {
  readonly code = 'ATTENDANCE_SESSION_REQUIRED';

  constructor() {
    super('ATTENDANCE_SESSION_REQUIRED');
    this.name = 'AttendanceSessionError';
  }
}

type ErrorLike = { code?: string; message?: string };

export function getAttendanceErrorMessage(error: unknown): string {
  const parsed: ErrorLike = error && typeof error === 'object'
    ? error as ErrorLike
    : { message: typeof error === 'string' ? error : '' };
  const code = parsed.code ?? '';
  const message = parsed.message ?? '';
  const value = `${code} ${message}`;

  if (value.includes('ATTENDANCE_SESSION_REQUIRED') || code === 'PGRST301' || /jwt|session|unauthorized/i.test(message)) {
    return 'Sua sessão expirou. Entre novamente e tente confirmar o atendimento.';
  }
  if (value.includes('ATTENDANCE_IDEMPOTENCY_CONFLICT')) {
    return 'Este atendimento já foi enviado com dados diferentes. Recarregue a tela antes de tentar novamente.';
  }
  if (value.includes('ATTENDANCE_APPOINTMENT_ALREADY_COMPLETED') || code === '23505') {
    return 'Este agendamento já possui um atendimento registrado. Atualize a tela antes de tentar novamente.';
  }
  if (value.includes('ATTENDANCE_APPOINTMENT_CANCELLED')) {
    return 'Este agendamento está cancelado e não pode ser concluído como atendimento.';
  }
  if (value.includes('ATTENDANCE_PATIENT_FORBIDDEN') || value.includes('ATTENDANCE_APPOINTMENT_FORBIDDEN') || value.includes('ATTENDANCE_APPOINTMENT_PATIENT_MISMATCH') || value.includes('ATTENDANCE_SERVICE_FORBIDDEN')) {
    return 'A paciente, o agendamento ou um serviço não está disponível para esta sessão. Atualize a tela e tente novamente.';
  }
  if (code === '22023' || code === '22P02' || code === '23514' || value.includes('ATTENDANCE_ITEM_') || value.includes('ATTENDANCE_PAYMENT_') || value.includes('ATTENDANCE_INJECTABLE_') || value.includes('ATTENDANCE_DUPLICATE_SERVICE_ITEM')) {
    return 'Revise os serviços, pagamentos e dados do atendimento antes de confirmar.';
  }
  if (code === 'PGRST202' || code === '42883' || /create_procedure_v2/i.test(message)) {
    return 'A atualização necessária para confirmar atendimentos não está disponível. Nenhum dado foi salvo.';
  }
  return 'Não foi possível concluir o atendimento. Nenhum dado parcial foi salvo; tente novamente.';
}

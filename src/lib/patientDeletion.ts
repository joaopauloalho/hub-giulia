import { isPostgrestError, SESSION_EXPIRED_MESSAGE } from './patientInput';

export const PATIENT_HAS_HISTORY_MESSAGE =
  'Esta paciente possui atendimento, movimentação financeira ou outro vínculo que precisa ser preservado. Utilize Arquivar.';
export const PATIENT_HAS_SIGNED_ANAMNESIS_MESSAGE =
  'Esta paciente possui anamnese assinada, que não pode ser apagada por esta opção. Utilize Arquivar.';

export function patientDeletionFriendlyError(error: unknown): string {
  if (isPostgrestError(error)) {
    if (error.code === 'P0001' && error.message.includes('PATIENT_HAS_SIGNED_ANAMNESIS')) {
      return PATIENT_HAS_SIGNED_ANAMNESIS_MESSAGE;
    }
    if (error.code === '23503' ||
      (error.code === 'P0001' && error.message.includes('PATIENT_HAS_RELATED_RECORDS'))) {
      return PATIENT_HAS_HISTORY_MESSAGE;
    }
    if (error.code === 'P0002') return 'Esta paciente não foi encontrada. Atualize a lista.';
    if (error.code === '42501' || error.code.startsWith('PGRST3')) return SESSION_EXPIRED_MESSAGE;
    if (error.code === 'PGRST202' || error.code === '42883') {
      return 'A exclusão ainda não está disponível no servidor. Atualize o Hub e tente novamente.';
    }
  }
  if (error instanceof Error && /failed to fetch|network|fetch failed/i.test(error.message)) {
    return 'Não foi possível conectar ao servidor. Confira sua internet e tente novamente.';
  }
  return 'Não foi possível excluir a paciente. Tente novamente ou utilize Arquivar.';
}

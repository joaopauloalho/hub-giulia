import type { AgendaStatus } from '../../hooks/useAgenda';

export const AGENDA_STATUS_LABEL: Record<AgendaStatus, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
  cancelado: 'Cancelado',
  nao_compareceu: 'Não compareceu',
};

export const AGENDA_STATUS_BAR: Record<AgendaStatus, string> = {
  pendente: '#d97706',
  confirmado: '#3b82f6',
  realizado: '#16a34a',
  cancelado: '#9ca3af',
  nao_compareceu: '#dc2626',
};

export const agendaStatusStyle: Record<AgendaStatus, React.CSSProperties> = {
  pendente: { background: '#fef3c7', color: '#92400e' },
  confirmado: { background: '#dbeafe', color: '#1d4ed8' },
  realizado: { background: '#dcfce7', color: '#15803d' },
  cancelado: { background: '#f3f4f6', color: '#6b7280' },
  nao_compareceu: { background: '#fee2e2', color: '#b91c1c' },
};

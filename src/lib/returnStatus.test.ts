import { describe, expect, it } from 'vitest';
import {
  classifyReturnOperation,
  classifyReturnWindow,
  returnNeedsAttention,
} from './returnStatus';

describe('returnStatus', () => {
  it('classifica data antes da janela como aguardando', () => {
    expect(classifyReturnWindow('2026-08-15', '2026-08-22', '2026-08-13')).toBe('waiting');
  });

  it('classifica data dentro da janela como disponível', () => {
    expect(classifyReturnWindow('2026-08-15', '2026-08-22', '2026-08-16')).toBe('available');
  });

  it('destaca os últimos três dias da janela', () => {
    expect(classifyReturnWindow('2026-08-15', '2026-08-22', '2026-08-20')).toBe('due_soon');
  });

  it('classifica data após a janela como atrasada', () => {
    expect(classifyReturnWindow('2026-08-15', '2026-08-22', '2026-08-23')).toBe('overdue');
  });

  it('considera appointment ativo como agendado', () => {
    expect(classifyReturnOperation({
      windowStart: '2026-08-15',
      windowEnd: '2026-08-22',
      appointmentId: 'appointment-1',
      appointmentStatus: 'confirmado',
    })).toBe('scheduled');
  });

  it('appointment cancelado volta para a fila temporal', () => {
    const input = {
      windowStart: '2026-08-15',
      windowEnd: '2026-08-22',
      appointmentId: 'appointment-1',
      appointmentStatus: 'cancelado',
    };
    expect(classifyReturnOperation(input)).toBe('open');
    expect(returnNeedsAttention(input, '2026-08-16')).toBe(true);
  });

  it('contato não remove retorno da fila que precisa de atenção', () => {
    const input = {
      windowStart: '2026-08-15',
      windowEnd: '2026-08-22',
      contactedAt: '2026-08-16T12:00:00Z',
    };
    expect(classifyReturnOperation(input)).toBe('contacted');
    expect(returnNeedsAttention(input, '2026-08-16')).toBe(true);
  });

  it('concluído e dispensado saem da fila ativa', () => {
    expect(returnNeedsAttention({
      windowStart: '2026-08-15',
      windowEnd: '2026-08-22',
      completedAt: '2026-08-16T12:00:00Z',
    }, '2026-08-16')).toBe(false);
    expect(returnNeedsAttention({
      windowStart: '2026-08-15',
      windowEnd: '2026-08-22',
      dismissedAt: '2026-08-16T12:00:00Z',
    }, '2026-08-16')).toBe(false);
  });
});

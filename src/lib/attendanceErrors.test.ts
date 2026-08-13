import { describe, expect, it } from 'vitest';
import { AttendanceSessionError, getAttendanceErrorMessage } from './attendanceErrors';

describe('getAttendanceErrorMessage', () => {
  it('maps expired sessions without leaking technical details', () => {
    expect(getAttendanceErrorMessage(new AttendanceSessionError()))
      .toContain('sessão expirou');
  });

  it('maps idempotency conflicts', () => {
    expect(getAttendanceErrorMessage({ code: 'P0001', message: 'ATTENDANCE_IDEMPOTENCY_CONFLICT' }))
      .toContain('dados diferentes');
  });

  it('maps validation errors', () => {
    expect(getAttendanceErrorMessage({ code: '22023', message: 'ATTENDANCE_PAYMENT_INVALID' }))
      .toContain('Revise os serviços');
  });

  it('maps missing RPCs clearly instead of suggesting a retry fallback', () => {
    expect(getAttendanceErrorMessage({ code: 'PGRST202', message: 'Could not find create_procedure_v2' }))
      .toContain('atualização necessária');
  });

  it('uses a safe generic message for unknown database errors', () => {
    expect(getAttendanceErrorMessage({ code: 'XX000', message: 'internal technical detail' }))
      .toBe('Não foi possível concluir o atendimento. Nenhum dado parcial foi salvo; tente novamente.');
  });
});

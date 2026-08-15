import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeLogError } from './safeLogger';

describe('safeLogError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never emits an error message or payload-like sensitive details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'cpf=12345678900 token=super-secret patient=Jane';
    const event = safeLogError('ui.error_boundary', new Error(secret));

    expect(event.code).toBe('ui.error_boundary');
    expect(event.errorName).toBe('Error');
    expect(event.requestId).toBeTruthy();

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('12345678900');
    expect(logged).not.toContain('super-secret');
    expect(logged).not.toContain('Jane');
  });
});

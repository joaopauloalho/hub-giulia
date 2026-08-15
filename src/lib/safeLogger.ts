export interface SafeErrorEvent {
  code: string;
  requestId: string;
  errorName: string;
}

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `hub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeLogError(code: string, error: unknown): SafeErrorEvent {
  const event: SafeErrorEvent = {
    code,
    requestId: createRequestId(),
    errorName: error instanceof Error ? error.name : 'UnknownError',
  };

  // Intentionally do not log error.message, stacks, URLs, request bodies or arbitrary context.
  // Those may contain PHI, CPF, signed Storage URLs, OAuth tokens or other credentials.
  console.error('[hub-error]', event);
  return event;
}

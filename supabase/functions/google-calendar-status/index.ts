import {
  HttpError,
  assertMethod,
  authenticate,
  createAdminClient,
  json,
  logSafe,
  preflight,
} from '../_shared/google-calendar-security.ts';

Deno.serve(async (req: Request) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    assertMethod(req, 'POST');
    const { user } = await authenticate(req);
    const admin = createAdminClient();

    const [{ data: connection, error: connectionError }, { data: tokenRow, error: tokenError }] = await Promise.all([
      admin
        .from('google_calendar_connections')
        .select('connected, needs_reauth, last_sync_at')
        .eq('user_id', user.id)
        .maybeSingle(),
      admin
        .from('google_calendar_tokens')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    if (connectionError || tokenError) {
      throw new HttpError(500, 'calendar_status_failed', 'Nao foi possivel verificar o Google Calendar.');
    }

    const tokenPresent = !!tokenRow;
    const connected = !!connection?.connected && tokenPresent;
    const needsReauth = !!connection?.needs_reauth || (!!connection?.connected && !tokenPresent);

    return json(req, {
      connected,
      needs_reauth: needsReauth,
      last_sync_at: connection?.last_sync_at ?? null,
    });
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'calendar_status_failed', 'Nao foi possivel verificar o Google Calendar.');
    logSafe('google-calendar-status', httpError.code, httpError.status);
    return json(req, { error: httpError.code, message: httpError.message }, httpError.status);
  }
});

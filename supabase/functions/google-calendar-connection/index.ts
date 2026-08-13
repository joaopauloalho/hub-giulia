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
    const body = await req.json().catch(() => ({})) as { action?: string };
    if (body.action !== 'unlink') {
      throw new HttpError(400, 'invalid_action', 'Operacao invalida.');
    }

    const admin = createAdminClient();
    const { error } = await admin.rpc('set_google_calendar_connection_enabled', {
      p_user_id: user.id,
      p_enabled: false,
    });
    if (error) {
      throw new HttpError(500, 'connection_update_failed', 'Nao foi possivel atualizar a conexao com o Google Calendar.');
    }

    return json(req, { connected: false, needs_reauth: false });
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'connection_update_failed', 'Nao foi possivel atualizar a conexao com o Google Calendar.');
    logSafe('google-calendar-connection', httpError.code, httpError.status);
    return json(req, { error: httpError.code, message: httpError.message }, httpError.status);
  }
});

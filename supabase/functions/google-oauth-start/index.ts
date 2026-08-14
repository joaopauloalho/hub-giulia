import {
  GOOGLE_REDIRECT_URI,
  HttpError,
  assertMethod,
  authenticate,
  createAdminClient,
  json,
  logSafe,
  preflight,
  randomOpaqueState,
  sha256Hex,
} from '../_shared/google-calendar-security.ts';

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const STATE_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    assertMethod(req, 'POST');
    const { user } = await authenticate(req);
    const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
    if (!clientId || !GOOGLE_REDIRECT_URI) {
      throw new HttpError(500, 'server_config', 'Configuracao do Google Calendar indisponivel.');
    }

    const admin = createAdminClient();
    const state = randomOpaqueState();
    const stateHash = await sha256Hex(state);
    const now = Date.now();
    const expiresAt = new Date(now + STATE_TTL_MS).toISOString();

    // A new flow invalidates older unconsumed states for this user/provider.
    await admin
      .from('oauth_states')
      .delete()
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .is('consumed_at', null);

    // Opportunistic cleanup keeps the table bounded without a cron dependency.
    await admin
      .from('oauth_states')
      .delete()
      .lt('expires_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    const { error: insertError } = await admin.from('oauth_states').insert({
      state_hash: stateHash,
      user_id: user.id,
      provider: 'google',
      expires_at: expiresAt,
    });
    if (insertError) throw new HttpError(500, 'state_store_failed', 'Nao foi possivel iniciar a conexao com o Google.');

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();

    return json(req, { url: authUrl.toString(), expires_in: STATE_TTL_MS / 1000 });
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'oauth_start_failed', 'Nao foi possivel iniciar a conexao com o Google.');
    logSafe('google-oauth-start', httpError.code, httpError.status);
    return json(req, { error: httpError.code, message: httpError.message }, httpError.status);
  }
});

import {
  GOOGLE_REDIRECT_URI,
  appRedirect,
  createAdminClient,
  isOpaqueState,
  logSafe,
  sha256Hex,
} from '../_shared/google-calendar-security.ts';

async function markFailure(stateHash: string, code: string) {
  try {
    const admin = createAdminClient();
    await admin
      .from('oauth_states')
      .update({ failure_code: code })
      .eq('state_hash', stateHash)
      .is('completed_at', null);
  } catch {
    logSafe('google-oauth-callback', 'failure_marker_failed');
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');

  if (!isOpaqueState(state)) {
    return Response.redirect(appRedirect('error'), 302);
  }

  const stateHash = await sha256Hex(state);
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Claim is the single-use/replay barrier. Only one request can transition
  // the state from unconsumed to consumed while it is still valid.
  const { data: claimedState, error: claimError } = await admin
    .from('oauth_states')
    .update({ consumed_at: now })
    .eq('state_hash', stateHash)
    .eq('provider', 'google')
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('user_id')
    .maybeSingle();

  if (claimError || !claimedState) {
    logSafe('google-oauth-callback', 'state_rejected');
    return Response.redirect(appRedirect('error'), 302);
  }

  if (providerError || !code) {
    await markFailure(stateHash, providerError ? 'provider_cancelled' : 'missing_code');
    return Response.redirect(appRedirect(providerError ? 'cancelled' : 'error'), 302);
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret || !GOOGLE_REDIRECT_URI) {
    await markFailure(stateHash, 'server_config');
    logSafe('google-oauth-callback', 'server_config');
    return Response.redirect(appRedirect('error'), 302);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      await markFailure(stateHash, `exchange_${tokenRes.status}`);
      logSafe('google-oauth-callback', 'token_exchange_failed', tokenRes.status);
      return Response.redirect(appRedirect('error'), 302);
    }

    const tokens = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || Number(tokens.expires_in) <= 0) {
      await markFailure(stateHash, 'token_response_invalid');
      logSafe('google-oauth-callback', 'token_response_invalid');
      return Response.redirect(appRedirect('error'), 302);
    }

    const expiresAt = new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString();
    const { error: finalizeError } = await admin.rpc('finalize_google_oauth_callback', {
      p_state_hash: stateHash,
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token ?? '',
      p_expires_at: expiresAt,
    });

    if (finalizeError) {
      await markFailure(stateHash, 'finalize_failed');
      logSafe('google-oauth-callback', 'finalize_failed');
      return Response.redirect(appRedirect('error'), 302);
    }

    return Response.redirect(appRedirect('connected'), 302);
  } catch {
    await markFailure(stateHash, 'callback_failed');
    logSafe('google-oauth-callback', 'callback_failed');
    return Response.redirect(appRedirect('error'), 302);
  }
});

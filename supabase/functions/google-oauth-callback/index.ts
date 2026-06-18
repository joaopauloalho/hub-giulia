import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI')!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const userId = url.searchParams.get('state');

  const appUrl = Deno.env.get('APP_URL') ?? 'https://hub-giulia.vercel.app';

  if (!code || !userId) {
    return Response.redirect(`${appUrl}/?google_error=missing_params`);
  }

  // TODO(security): replace direct user_id state with a persisted one-time nonce.
  if (!UUID_RE.test(userId)) {
    return Response.redirect(`${appUrl}/?google_error=invalid_state`);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase.from('google_calendar_tokens').upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    });

    if (error) throw error;

    return Response.redirect(`${appUrl}/?google_connected=true`);
  } catch (err) {
    console.error('google-oauth-callback error:', err);
    return Response.redirect(`${appUrl}/?google_error=callback_failed`);
  }
});

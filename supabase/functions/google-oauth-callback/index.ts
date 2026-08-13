import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://hub-giulia.vercel.app').replace(/\/$/, '');
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

function redirect(result: 'connected' | 'error' | 'cancelled') {
  const target = new URL('/agenda', `${APP_URL}/`);
  target.searchParams.set('google_calendar', result);
  return Response.redirect(target.toString(), 302);
}

async function hashState(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  if (!state || !STATE_RE.test(state)) return redirect('error');

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const stateHash = await hashState(state);
  const now = new Date().toISOString();

  const { data: claimed } = await admin
    .from('oauth_states')
    .update({ consumed_at: now })
    .eq('state_hash', stateHash)
    .eq('provider', 'google')
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('user_id')
    .maybeSingle();

  if (!claimed) return redirect('error');
  if (url.searchParams.get('error')) return redirect('cancelled');

  const code = url.searchParams.get('code');
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI');
  if (!code || !clientId || !clientSecret || !redirectUri) return redirect('error');

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) return redirect('error');

    const token = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!token.access_token || !Number.isFinite(token.expires_in) || Number(token.expires_in) <= 0) return redirect('error');

    const { error } = await admin.rpc('finalize_google_oauth_callback', {
      p_state_hash: stateHash,
      p_access_token: token.access_token,
      p_refresh_token: token.refresh_token ?? '',
      p_expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString(),
    });
    if (error) return redirect('error');

    return redirect('connected');
  } catch {
    return redirect('error');
  }
});

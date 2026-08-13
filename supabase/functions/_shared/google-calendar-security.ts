import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

const DEFAULT_APP_URL = 'https://hub-giulia.vercel.app';
const PREVIEW_TEAM_SUFFIX = '-joao-paulos-projects-0a85e668.vercel.app';

export const APP_URL = (Deno.env.get('APP_URL') ?? DEFAULT_APP_URL).replace(/\/$/, '');
export const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI') ?? '';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function parseOrigin(origin: string) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin: string | null) {
  if (!origin) return true;
  const parsed = parseOrigin(origin);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return false;

  if (origin === APP_URL) return true;
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
  if (parsed.protocol === 'https:' && parsed.hostname === 'hub-giulia.vercel.app') return true;
  return parsed.protocol === 'https:'
    && parsed.hostname.startsWith('hub-giulia-')
    && parsed.hostname.endsWith(PREVIEW_TEAM_SUFFIX);
}

export function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin');
  const allowedOrigin = origin && isAllowedOrigin(origin) ? origin : APP_URL;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}

export function preflight(req: Request) {
  const origin = req.headers.get('Origin');
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
      status: 403,
      headers: corsHeaders(req),
    });
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }
  return null;
}

export function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

export function assertMethod(req: Request, method: 'GET' | 'POST') {
  if (req.method !== method) throw new HttpError(405, 'method_not_allowed', 'Metodo nao permitido.');
}

export function createAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRole) throw new HttpError(500, 'server_config', 'Configuracao indisponivel.');
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function authenticate(req: Request): Promise<{ user: User; client: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, 'session_expired', 'Sua sessao expirou. Entre novamente.');
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new HttpError(500, 'server_config', 'Configuracao indisponivel.');

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.slice('Bearer '.length);
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) throw new HttpError(401, 'session_expired', 'Sua sessao expirou. Entre novamente.');
  return { user, client };
}

export function randomOpaqueState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function isOpaqueState(value: string | null): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function appRedirect(result: 'connected' | 'error' | 'cancelled') {
  const url = new URL('/agenda', `${APP_URL}/`);
  url.searchParams.set('google_calendar', result);
  return url.toString();
}

export function safeFailureCode(prefix: string, status?: number) {
  return status ? `${prefix}_${status}` : prefix;
}

export function logSafe(scope: string, code: string, status?: number) {
  console.error(`[${scope}]`, { code, ...(status ? { status } : {}) });
}

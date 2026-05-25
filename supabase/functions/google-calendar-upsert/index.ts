import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_REDIRECT_URI')!;

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_at: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS, status: 204 });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let appointmentId: string;
  try {
    const body = await req.json();
    appointmentId = body.appointment_id;
    if (!appointmentId) throw new Error('missing appointment_id');
  } catch {
    return json({ synced: false, error: 'Invalid body' }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: apt, error: aptErr } = await supabase
      .from('appointments')
      .select('*, patient:patients(id,name), service:services(id,name,duration_minutes)')
      .eq('id', appointmentId)
      .single();

    if (aptErr || !apt) throw new Error(aptErr?.message ?? 'appointment not found');

    const { data: tokenRow, error: tokenErr } = await supabase
      .from('google_calendar_tokens')
      .select('*')
      .eq('user_id', apt.user_id)
      .single();

    if (tokenErr || !tokenRow) {
      return json({ synced: false, error: 'not_connected' });
    }

    let accessToken = tokenRow.access_token;
    const expiresAt = new Date(tokenRow.expires_at).getTime();
    if (Date.now() + 60_000 >= expiresAt) {
      const refreshed = await refreshAccessToken(tokenRow.refresh_token);
      accessToken = refreshed.access_token;
      await supabase.from('google_calendar_tokens').update({
        access_token: refreshed.access_token,
        expires_at: refreshed.expires_at,
      }).eq('user_id', apt.user_id);
    }

    if (apt.status === 'cancelado') {
      if (apt.google_event_id) {
        const deleteRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${apt.google_event_id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
          throw new Error(`DELETE event failed: ${deleteRes.status}`);
        }
        await supabase
          .from('appointments')
          .update({ google_event_id: null })
          .eq('id', appointmentId);
      }
      return json({ synced: true, cancelled: true });
    }

    const startDt = new Date(apt.scheduled_at);
    const endDt = new Date(startDt.getTime() + (apt.service?.duration_minutes ?? 60) * 60_000);

    const eventBody = {
      summary: `💆 ${apt.patient?.name ?? 'Paciente'} — ${apt.service?.name ?? 'Consulta'}`,
      start: { dateTime: startDt.toISOString() },
      end: { dateTime: endDt.toISOString() },
      description: apt.notes ? `Observações: ${apt.notes}` : undefined,
    };

    let calEventId: string;

    if (apt.google_event_id) {
      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${apt.google_event_id}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        }
      );
      if (!patchRes.ok) throw new Error(`PATCH event failed: ${patchRes.status}`);
      calEventId = (await patchRes.json()).id;
    } else {
      const createRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        }
      );
      if (!createRes.ok) throw new Error(`POST event failed: ${createRes.status}`);
      calEventId = (await createRes.json()).id;
    }

    await supabase
      .from('appointments')
      .update({ google_event_id: calEventId })
      .eq('id', appointmentId);

    return json({ synced: true, google_event_id: calEventId });
  } catch (err) {
    console.error('google-calendar-upsert error:', err);
    return json({ synced: false, error: err instanceof Error ? err.message : String(err) });
  }
});

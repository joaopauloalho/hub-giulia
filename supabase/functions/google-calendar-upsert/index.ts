import {
  GOOGLE_REDIRECT_URI,
  HttpError,
  assertMethod,
  authenticate,
  createAdminClient,
  json,
  logSafe,
  preflight,
} from '../_shared/google-calendar-security.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFRESH_MARGIN_MS = 60_000;

async function markNeedsReauth(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { error } = await admin.rpc('mark_google_calendar_needs_reauth', { p_user_id: userId });
  if (error) logSafe('google-calendar-upsert', 'reauth_marker_failed');
}

async function refreshAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  refreshToken: string,
) {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new HttpError(500, 'server_config', 'Configuracao do Google Calendar indisponivel.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      ...(GOOGLE_REDIRECT_URI ? { redirect_uri: GOOGLE_REDIRECT_URI } : {}),
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || data.error === 'invalid_grant') {
    if (data.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
      await markNeedsReauth(admin, userId);
      throw new HttpError(409, 'google_reauth_required', 'Reconecte seu Google Calendar para continuar sincronizando.');
    }
    throw new HttpError(502, 'google_refresh_failed', 'Nao foi possivel sincronizar com o Google Calendar agora.');
  }

  if (!data.access_token || !Number.isFinite(data.expires_in) || Number(data.expires_in) <= 0) {
    throw new HttpError(502, 'google_refresh_invalid', 'Nao foi possivel sincronizar com o Google Calendar agora.');
  }

  const expiresAt = new Date(Date.now() + Number(data.expires_in) * 1000).toISOString();
  const update: Record<string, string> = {
    access_token: data.access_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  if (data.refresh_token) update.refresh_token = data.refresh_token;

  const { error: updateError } = await admin
    .from('google_calendar_tokens')
    .update(update)
    .eq('user_id', userId);
  if (updateError) {
    throw new HttpError(500, 'token_store_failed', 'Nao foi possivel sincronizar com o Google Calendar agora.');
  }

  return data.access_token;
}

async function handleGoogleAuthFailure(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  status: number,
) {
  if (status === 401) {
    await markNeedsReauth(admin, userId);
    throw new HttpError(409, 'google_reauth_required', 'Reconecte seu Google Calendar para continuar sincronizando.');
  }
  throw new HttpError(502, 'google_calendar_failed', 'Nao foi possivel sincronizar com o Google Calendar agora.');
}

Deno.serve(async (req: Request) => {
  const cors = preflight(req);
  if (cors) return cors;

  try {
    assertMethod(req, 'POST');
    const { user, client } = await authenticate(req);

    let appointmentId = '';
    try {
      const body = await req.json() as { appointment_id?: string };
      appointmentId = body.appointment_id ?? '';
    } catch {
      throw new HttpError(400, 'invalid_body', 'Agendamento invalido.');
    }
    if (!UUID_RE.test(appointmentId)) {
      throw new HttpError(400, 'invalid_appointment', 'Agendamento invalido.');
    }

    // This read runs in the caller's RLS context. The event id is obtained only
    // from an appointment the authenticated user owns; it is never accepted from the client.
    const { data: apt, error: aptError } = await client
      .from('appointments')
      .select('id,user_id,patient_id,service_id,scheduled_at,duration_minutes,end_at,status,google_event_id,patient:patients(id,name),service:services(id,name)')
      .eq('id', appointmentId)
      .maybeSingle();

    if (aptError || !apt || apt.user_id !== user.id) {
      throw new HttpError(403, 'appointment_forbidden', 'Agendamento indisponivel.');
    }

    const admin = createAdminClient();
    const { data: tokenRow, error: tokenError } = await admin
      .from('google_calendar_tokens')
      .select('access_token,refresh_token,expires_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (tokenError) {
      throw new HttpError(500, 'token_lookup_failed', 'Nao foi possivel verificar o Google Calendar.');
    }
    if (!tokenRow) {
      return json(req, {
        synced: false,
        error: 'google_not_connected',
        message: 'Conecte seu Google Calendar para sincronizar este agendamento.',
      }, 409);
    }

    let accessToken = tokenRow.access_token;
    if (Date.now() + REFRESH_MARGIN_MS >= new Date(tokenRow.expires_at).getTime()) {
      accessToken = await refreshAccessToken(admin, user.id, tokenRow.refresh_token);
    }

    const encodedEventId = apt.google_event_id ? encodeURIComponent(apt.google_event_id) : null;

    if (apt.status === 'cancelado') {
      if (encodedEventId) {
        const deleteRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedEventId}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
          await handleGoogleAuthFailure(admin, user.id, deleteRes.status);
        }

        const { error: clearError } = await client
          .from('appointments')
          .update({ google_event_id: null })
          .eq('id', appointmentId);
        if (clearError) throw new HttpError(500, 'appointment_sync_store_failed', 'O agendamento local foi mantido, mas a sincronizacao nao foi concluida.');
      }

      await admin
        .from('google_calendar_connections')
        .update({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
      return json(req, { synced: true, cancelled: true });
    }

    const patient = apt.patient as unknown as { id: string; name: string } | null;
    const service = apt.service as unknown as { id: string; name: string } | null;
    const start = new Date(apt.scheduled_at);
    const end = new Date(apt.end_at);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || !apt.duration_minutes) {
      throw new HttpError(500, 'appointment_time_invalid', 'O horario do agendamento local esta inconsistente.');
    }
    const eventBody = {
      summary: `${patient?.name ?? 'Paciente'} — ${service?.name ?? 'Consulta'}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      description: 'Agendamento sincronizado pelo Hub Giulia.',
    };

    let eventId: string | null = null;

    if (encodedEventId) {
      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodedEventId}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        },
      );

      if (patchRes.ok) {
        const patched = await patchRes.json() as { id?: string };
        eventId = patched.id ?? apt.google_event_id;
      } else if (patchRes.status !== 404 && patchRes.status !== 410) {
        await handleGoogleAuthFailure(admin, user.id, patchRes.status);
      }
    }

    if (!eventId) {
      const createRes = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        },
      );
      if (!createRes.ok) await handleGoogleAuthFailure(admin, user.id, createRes.status);
      const created = await createRes.json() as { id?: string };
      if (!created.id) throw new HttpError(502, 'google_event_invalid', 'Nao foi possivel sincronizar com o Google Calendar agora.');
      eventId = created.id;
    }

    const { error: appointmentUpdateError } = await client
      .from('appointments')
      .update({ google_event_id: eventId })
      .eq('id', appointmentId);
    if (appointmentUpdateError) {
      throw new HttpError(500, 'appointment_sync_store_failed', 'O agendamento local foi mantido, mas a sincronizacao nao foi concluida.');
    }

    await admin
      .from('google_calendar_connections')
      .update({ connected: true, needs_reauth: false, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('user_id', user.id);

    return json(req, { synced: true });
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'google_sync_failed', 'O agendamento local foi mantido, mas a sincronizacao com o Google nao foi concluida.');
    logSafe('google-calendar-upsert', httpError.code, httpError.status);
    return json(req, { synced: false, error: httpError.code, message: httpError.message }, httpError.status);
  }
});

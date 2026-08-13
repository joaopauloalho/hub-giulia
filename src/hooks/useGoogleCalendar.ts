import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type CalendarStatus = {
  connected?: boolean;
  needs_reauth?: boolean;
  last_sync_at?: string | null;
  message?: string;
  url?: string;
};

function calendarErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '');
    if (/401|jwt|session|unauthorized/i.test(message)) {
      return 'Sua sessão expirou. Entre novamente.';
    }
  }
  return fallback;
}

export function useGoogleCalendar() {
  const [connected, setConnected] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        setConnected(false);
        setNeedsReauth(false);
        setMessage('Sua sessão expirou. Entre novamente.');
        return;
      }

      const { data, error } = await supabase.functions.invoke<CalendarStatus>('google-calendar-status', {
        body: {},
      });
      if (error) throw error;

      setConnected(Boolean(data?.connected));
      setNeedsReauth(Boolean(data?.needs_reauth));
      setLastSyncAt(data?.last_sync_at ?? null);
      if (data?.needs_reauth) {
        setMessage('É necessário reconectar seu Google Calendar.');
      }
    } catch (error) {
      setMessage(calendarErrorMessage(error, 'Não foi possível verificar o Google Calendar.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get('google_calendar');
    if (oauthResult === 'connected') {
      setMessage('Google Calendar conectado com sucesso.');
    } else if (oauthResult === 'cancelled') {
      setMessage('Conexão com o Google Calendar cancelada.');
    } else if (oauthResult === 'error') {
      setMessage('Não foi possível concluir a conexão com o Google. Tente novamente.');
    }

    if (oauthResult) {
      params.delete('google_calendar');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }

    void refreshStatus();
  }, [refreshStatus]);

  const connect = async () => {
    setMessage(null);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Sua sessão expirou. Entre novamente.');
    }

    const { data, error } = await supabase.functions.invoke<CalendarStatus>('google-oauth-start', {
      body: {},
    });
    if (error || !data?.url) {
      throw new Error(calendarErrorMessage(error, 'Não foi possível iniciar a conexão com o Google.'));
    }

    window.location.assign(data.url);
  };

  const disconnect = async () => {
    setMessage(null);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Sua sessão expirou. Entre novamente.');
    }

    const { error } = await supabase.functions.invoke('google-calendar-connection', {
      body: { action: 'disconnect' },
    });
    if (error) {
      throw new Error(calendarErrorMessage(error, 'Não foi possível desconectar o Google Calendar.'));
    }

    setConnected(false);
    setNeedsReauth(false);
    setLastSyncAt(null);
    setMessage('Google Calendar desconectado. Sua agenda local foi mantida.');
  };

  return {
    connected,
    needsReauth,
    lastSyncAt,
    message,
    loading,
    connect,
    disconnect,
    refreshStatus,
  };
}

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const GOOGLE_REDIRECT_URI = `${SUPABASE_FUNCTIONS_URL}/google-oauth-callback`;

export function useGoogleCalendar() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from('google_calendar_tokens')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!cancelled) {
        setConnected(!!data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const connect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
      state: user.id,
    });

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  };

  const disconnect = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('google_calendar_tokens').delete().eq('user_id', user.id);
    setConnected(false);
  };

  return { connected, loading, connect, disconnect };
}

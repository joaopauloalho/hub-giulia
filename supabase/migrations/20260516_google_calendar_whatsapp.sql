-- Google Calendar integration tables

CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_calendar_tokens_own" ON public.google_calendar_tokens;
CREATE POLICY "google_calendar_tokens_own"
ON public.google_calendar_tokens
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Add google_event_id to appointments
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS google_event_id TEXT;

CREATE TABLE IF NOT EXISTS public.patient_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  remind_at DATE,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.patient_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patient_notes_own" ON public.patient_notes;
CREATE POLICY "patient_notes_own" ON public.patient_notes
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients
      WHERE patients.id = patient_notes.patient_id
        AND patients.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.patients
      WHERE patients.id = patient_notes.patient_id
        AND patients.user_id = auth.uid()
    )
  );

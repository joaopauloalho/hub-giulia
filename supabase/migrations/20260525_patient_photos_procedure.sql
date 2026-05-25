ALTER TABLE public.patient_photos
  ADD COLUMN IF NOT EXISTS procedure_id UUID REFERENCES public.procedures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS photo_type TEXT NOT NULL DEFAULT 'general'
    CHECK (photo_type IN ('before', 'after', 'general'));

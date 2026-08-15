-- Hub Giulia 4.0: trigger-only helpers are not public RPCs.
-- Applied to production as Supabase migration 20260815144004.

REVOKE EXECUTE ON FUNCTION public.photos_v2_validate_photo_context() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.photos_v2_validate_session_context() FROM PUBLIC, anon, authenticated;

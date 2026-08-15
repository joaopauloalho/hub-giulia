-- Hub Giulia 3.9 — allow authenticated callers to reuse the canonical pure phone normalizer.
revoke all on function public.communication_whatsapp_digits_v1(text) from public, anon;
grant execute on function public.communication_whatsapp_digits_v1(text) to authenticated;

-- Hub Giulia 1.7 — Retornos 2.0
-- RLS is enabled in 20260813195500_returns_v2_schema.sql with no direct table policies.
-- This deny-by-default boundary is intentional: authenticated client access is exposed only
-- through the auth-scoped RPCs versioned in the API/scheduling migrations.
comment on table public.procedure_returns is 'Hub Giulia Retornos 2.0: RLS deny-by-default; authenticated client access is exposed only through auth-scoped RPCs.';

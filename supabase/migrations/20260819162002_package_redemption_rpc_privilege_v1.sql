-- Hub Giulia 4.4 — package redemption privilege repair.
-- create_procedure_v3 already validates auth.uid() ownership for patient, appointment,
-- services, packages and package items, uses a fixed search_path, and performs the
-- package credit ledger + redemption atomically. Package redemption needs row locks
-- and inserts into tables intentionally exposed as SELECT-only to authenticated users.
-- SECURITY INVOKER therefore cannot safely execute the canonical transaction without
-- granting direct DML on sensitive credit tables. Keep those tables least-privileged
-- and elevate only the already-owner-scoped canonical RPC.

alter function public.create_procedure_v3(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text
) security definer;

revoke all on function public.create_procedure_v3(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text
) from public, anon;

grant execute on function public.create_procedure_v3(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text
) to authenticated;

comment on function public.create_procedure_v3(
  uuid, uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text
) is 'Canonical atomic attendance v3. SECURITY DEFINER is required only to keep package credit/redemption tables SELECT-only to authenticated; auth.uid ownership checks and fixed search_path remain mandatory.';

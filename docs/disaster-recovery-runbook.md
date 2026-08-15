# Hub Giulia 4.0 — Disaster Recovery Runbook

Never reset or restore over production during diagnosis. Preserve evidence before destructive action. Do not edit already-applied migrations; use reviewed forward fixes.

## A. Catastrophic database / Storage loss

**Recovery source:** dedicated project `coimstexbntzxzrwlrws`, private bucket `recovery-backups`, daily verified snapshots at 03:00 America/Sao_Paulo with latest 14 retained.

1. Stop non-idempotent mutation retries and identify incident start.
2. Inspect the latest successful `hub-giulia-daily-recovery-backup` run and archive timestamp.
3. Keep production untouched while validating the recovery copy.
4. If the existing recovery project is healthy, validate its restored state; if a cold target is required, rebuild schema from the green Git migration chain first.
5. Restore the selected verified `.hub-giulia.json.gz` package only into the isolated target.
6. Require zero table fingerprint and Storage SHA-256 mismatches.
7. Validate 50/50 public RLS, 12/12 `security_invoker` views, private buckets and cross-tenant denial.
8. Confirm users/identities exist. Prior login sessions are intentionally not recovered; users must sign in again.
9. Deploy/reconfigure versioned Edge Functions and provider-side secret/config values without exposing them.
10. Point application traffic only after authenticated smoke checks pass.
11. Record actual incident RPO/RTO, recovered archive timestamp and validation result without PHI/secrets.

**Current drill evidence:** hosted restore on 2026-08-15 restored 50 public tables, 2 Auth tables and 5 private objects with 0 mismatches. Warm snapshot+restore+verification measured 6.564 seconds for the current dataset. Scheduled RPO target is <=24h; this is logical snapshot recovery, not PITR.

## B. Bad frontend deployment

Verify Vercel deployment state, Git SHA and runtime errors. Identify the last known-good Production deployment and promote/redeploy it through normal Vercel controls. Do not change database state to compensate for a frontend regression. Validate login, Today, Agenda, Patient360, key read routes and PWA reload.

## C. Bad migration

Identify the exact migration and affected objects. Stop further rollout and create a new backward-compatible forward-fix migration. Never delete migration-history rows, reset production, disable RLS or rewrite clinical/financial history merely to satisfy current UI. Validate catalog assertions, RLS, RPC contracts, advisors and affected flows.

## D. White screen / application crash

Check Vercel build/runtime logs and redacted ErrorBoundary events. Confirm backend health before blaming service worker state. Use the documented PWA update/purge path or rollback a proven code regression. Do not force a reload with unsaved clinical forms.

## E. Database unavailable but data not lost

Check Supabase health/Postgres logs and whether the outage is platform-wide or query-specific. Avoid blind mutation retries. After service returns, run auth/read smoke, Data Quality and financial/clinical invariant checks. Do not invoke disaster restore merely for a transient outage.

## F. Storage unavailable but objects not lost

Check Storage health, bucket privacy/policies, object-path existence and signed-URL failures. Preserve DB metadata and stop destructive cleanup. Never make buckets public. If loss is proven, use the verified recovery snapshot rather than rewriting paths.

## G. Google Calendar / OAuth failure

Inspect Edge Function logs, connection state, provider health and redirect configuration. Reconnect through the normal OAuth flow. Never log provider credentials/tokens, weaken state validation or patch clinical records to mirror Google.

## H. Service worker stuck

Confirm current deployment and `sw.js`, then use the app update/purge path. Avoid applying a waiting worker while forms are dirty and never cache authenticated Supabase responses.

## I. Suspicious financial data

Freeze automatic correction. Run versioned read-only invariants, preserve ledger history and identify source operation/idempotency key. Any ambiguous historical correction requires human review and a versioned corrective script. Never fabricate a payment or rewrite history to make totals match.

## J. Photos/contracts appear missing

Distinguish authorization, signed-URL expiry, missing DB row and missing object. Preserve both sides. Use checksums/object paths and recover missing bytes from the verified snapshot when actual loss is proven. Never replace an original with a thumbnail.

## K. Suspected credential leak

Identify scope without reproducing the value. Rotate only the affected secret through the control plane, update dependent server-side services and review logs. Never paste real secret values into issues/chat/source.

## L. Production slow

Use Vercel runtime evidence, Supabase advisors/logs and measured SQL plans. Fix only measured bottlenecks. Do not drop ownership/FK indexes merely because a small database reports them unused.

## Recovery operating evidence

- production cron must remain active: `hub-giulia-daily-recovery-backup`;
- production function: `recovery-backup-v4`;
- recovery-only function: `recovery-backup-ingest`;
- recovery archive bucket must remain private;
- monitor `cron.job_run_details` and both projects' Edge logs;
- after material schema/Auth/Storage changes, rerun an isolated restore drill and remeasure RPO/RTO.

The recovery project is a security/recovery surface, not a development sandbox. Do not use restored clinical data for ordinary development or testing.

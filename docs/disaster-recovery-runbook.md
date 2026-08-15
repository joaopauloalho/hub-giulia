# Hub Giulia 4.0 — Disaster Recovery Runbook

Never reset or restore over production. Preserve evidence before destructive action. For database incidents, prefer backward-compatible forward-fix migrations; do not edit already-applied migration files.

## A. Bad frontend deployment

**Symptom:** new UI errors, blank/incorrect route, regression immediately after deploy.

**First diagnosis:** verify Vercel deployment state, production SHA, runtime errors and browser console category without copying PHI.

**Safe actions:** identify last known-good Production deployment/SHA; compare deployment/build logs; revert code or promote/redeploy the known-good SHA using normal Vercel controls.

**Do not:** force redeploy repeatedly; change database to compensate for a frontend regression; expose secrets in logs.

**Validate:** login, Today, Agenda, Patient360, key read routes, PWA reload and runtime errors.

## B. Bad migration

**Symptom:** PostgREST errors, constraint/RPC failure, unavailable column/function after a migration.

**First diagnosis:** identify exact migration version and affected objects; inspect DB logs and migration history.

**Safe actions:** stop further schema rollout; create a new backward-compatible forward-fix migration; preserve historical migration files unchanged.

**Do not:** reset production, manually delete migration-history rows, drop clinical/financial history, disable RLS to make the UI work.

**Validate:** schema/catalog assertions, RLS, RPC contract tests, affected UI flow, advisors and invariant queries.

## C. White screen / application crash

**Symptom:** UI cannot render.

**First diagnosis:** check Vercel deployment/build/runtime logs and redacted ErrorBoundary events; inspect service-worker version only after checking deployment health.

**Safe actions:** reload without deleting user data; if isolated to the service worker, unregister/purge through the documented PWA recovery path; if code regression, rollback frontend.

**Do not:** tell users to clear unrelated browser data before preserving diagnostic information; leave a broken deployment live when a known-good candidate exists.

**Validate:** cold load, authenticated deep link, standalone PWA and next normal navigation.

## D. Database unavailable

**Symptom:** broad Supabase requests time out/fail.

**First diagnosis:** Supabase project health, Postgres logs, connection/load indicators, whether outage is platform-wide or query-specific.

**Safe actions:** avoid mutation retries that are not idempotent; communicate read/write impact; recover service or escalate to Supabase; after service returns, run integrity/read-only checks.

**Do not:** reset, restore over production or replay writes blindly.

**Validate:** auth/session, representative reads, one safe controlled mutation only when appropriate, Data Quality and financial/clinical invariants.

## E. Storage unavailable

**Symptom:** photo/PDF access or upload fails while DB is healthy.

**First diagnosis:** Storage service health, bucket privacy/policies, object-path existence and signed-URL failures.

**Safe actions:** preserve DB metadata; stop destructive cleanup; retry only idempotent upload workflows; distinguish object missing from authorization failure.

**Do not:** make bucket public, delete orphan candidates automatically or rewrite DB paths to temporary signed URLs.

**Validate:** private list policy, sampled signed URL, upload/cleanup in test data/environment and object-to-row consistency.

## F. Google Calendar stopped

**Symptom:** status disconnected/errors or appointment sync unavailable.

**First diagnosis:** Edge Function logs, connection status metadata, OAuth provider status, token refresh outcome, redirect configuration.

**Safe actions:** reconnect through the normal OAuth flow; keep Hub appointment data canonical; validate token storage remains server-side.

**Do not:** print refresh/access tokens, copy client secret to browser or manually patch clinical records to mirror Google.

**Validate:** connection status + a safe test synchronization when test data is available.

## G. OAuth invalidated

**Symptom:** callback fails, invalid_grant/state error, repeated reconnect.

**First diagnosis:** OAuth state lifecycle, redirect URI, Google credentials/config, callback logs with redaction.

**Safe actions:** start a new OAuth flow; rotate a credential only if compromise/invalidity is proven and coordinate external console update.

**Do not:** reuse consumed state, log authorization code/tokens, weaken state validation or accept arbitrary redirects.

**Validate:** start → callback → status → reconnect/disconnect behavior.

## H. Bad service worker stuck on clients

**Symptom:** old assets persist after a healthy deploy, reload loop or offline shell inconsistent.

**First diagnosis:** current `sw.js`, browser service-worker state and cache names; confirm backend is not the root cause.

**Safe actions:** use the app's update/purge path; avoid applying a waiting worker while forms are dirty; if needed ship a minimal SW recovery release.

**Do not:** cache Supabase authenticated responses or force reload with unsaved clinical forms.

**Validate:** install, standalone launch, deep route, controlled update, offline shell, login/logout cache purge.

## I. Suspicious financial data

**Symptom:** unexpected balance/payment/ledger mismatch.

**First diagnosis:** freeze automatic correction; run versioned read-only invariant queries; identify source operation/idempotency key and affected tenant/record IDs without exporting patient details.

**Safe actions:** preserve audit trail; establish cause and intended value; prepare a reviewed, versioned corrective script/migration only after human approval when ambiguity exists.

**Do not:** delete/overwrite ledger history, fabricate a payment, recalculate history just to satisfy current UI.

**Validate:** before/after invariant counts, source records, rollups, idempotency and UI totals.

## J. Photos/contracts appear missing

**Symptom:** DB timeline exists but media/PDF unavailable, or Storage object exists without expected row.

**First diagnosis:** distinguish authorization, signed URL expiry, DB-row missing and object missing; run orphan report only.

**Safe actions:** preserve both sides; use checksums/object paths; recover from object backup when available.

**Do not:** delete orphan candidate automatically, make bucket public or replace an original with a thumbnail/preview.

**Validate:** private access, checksum/path metadata and sampled artifact open through signed URL.

## K. Suspected credential leak

**Symptom:** secret appears in repository/log, unexpected API usage or provider alert.

**First diagnosis:** identify category/location/scope without reproducing the value; determine whether public/publishable key or true secret; preserve incident evidence.

**Safe actions:** revoke/rotate only affected real secret promptly; update dependent server-side control planes; invalidate sessions/tokens when relevant; review logs for misuse.

**Do not:** paste the secret into issues/chat/logs, rotate unrelated credentials merely for testing or move service_role to browser code.

**Validate:** old credential rejected, new credential only server-side, application flows healthy, source/log scan clean.

## L. Production slow

**Symptom:** routes materially slower or timeouts.

**First diagnosis:** Vercel runtime, network request count, Supabase advisors/logs, measured SQL `EXPLAIN (ANALYZE, BUFFERS)` on safe representative queries.

**Safe actions:** fix only measured bottlenecks; add compatible indexes/bounds; rollback a proven regression.

**Do not:** drop indexes because the Advisor labels them unused on a small/new database; run invasive load tests on production.

**Validate:** same baseline query/routes before and after, errors, advisors and user-visible flow.

## Escalation and evidence

Escalate to the relevant provider when platform health or restore capability is the blocker. Record: incident start, affected surface, deployment/migration SHA/version, safe actions taken, recovery validation, actual data-loss window and elapsed recovery time. Never include PHI, authorization headers, signed photo URLs, OAuth tokens or secret values in the incident record.

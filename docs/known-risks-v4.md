# Hub Giulia 4.0 — Known Risks

Audit date: 2026-08-15. Risk is separated from ordinary technical debt. No finding is hidden to create a zero-warning report.

## BLOCKER

### B1 — No verified recoverable production backup / restore

**State:** production Supabase remains on the Free plan. No auditable managed production recovery point/PITR has been verified, no independent Storage-object backup has been verified, and no real production-data restore has been executed into an isolated recovery target.

**Impact:** catastrophic database or Storage loss still lacks a proven data recovery path and measured RPO/RTO. The Hub cannot truthfully be tagged Stable under the v4 acceptance criteria while this remains unresolved.

**Required action:** enable an auditable database backup/recovery mechanism, establish separate private recovery for Storage object bytes, execute an isolated restore drill without overwriting production, validate sampled clinical/financial integrity, and record measured RPO/RTO.

## RESOLVED DURING V4

### R1 — Clean migration/schema reconstruction

**Original finding:** older repository migration markers omitted DDL that already existed in live production, so a clean rebuild failed first on composite owner keys and later on finance ledger rollup schema.

**Resolution:** additive rebuild bridges were created without editing applied historical migrations:

- `20260813233950_rebuild_bridge_owner_keys_defaults.sql`;
- `20260813185425_rebuild_bridge_finance_ledger_rollup.sql` (no production-history backfill).

Hosted table-grant parity is versioned in `20260815163948_production_hardening_v4_grants_rebuild.sql`. A fresh local Supabase instance now applies the complete Git migration chain successfully and immediately runs the isolated E2E suite. Historical remote migration names/versions are still not a byte-for-byte filename mirror of every old Git marker, so blind history repair remains prohibited; current schema/grants reconstruction is nevertheless proven green.

### R2 — Critical isolated authenticated E2E / Storage negative suite

**Original finding:** no Playwright/Cypress suite or safe writable isolated environment existed.

**Resolution:** Playwright 1.62.x and a disposable local Supabase/Auth/Storage environment are now part of CI. Final result: **12/12 E2E passed**. Coverage includes Auth/logout/PWA cache purge, patient double-submit/Patient360, Global Search isolation, anamnesis, Photos canonical lifecycle, cross-tenant DB + Storage API negatives, attendance/finance/returns/aftercare, injectables, CRM/proposal/package/credit/Relationship, concurrency/idempotency and responsive viewport smoke.

The E2E campaign also exposed and led to a real fix for a Patient360 close race that could reopen the drawer during navigation and block logout.

### R3 — HIGH table privilege exposure

Before v4, `authenticated` had `TRUNCATE`/`TRIGGER`/`REFERENCES` on 12 public tables. v4 revoked those privileges and post-validated 0 dangerous grants while preserving required application CRUD. Clean rebuild now reproduces the audited grants.

## HIGH

None currently proven outside the remaining recovery BLOCKER.

## MEDIUM

### M1 — Supabase leaked-password protection disabled

Security Advisor still reports compromised-password protection disabled. Enable through Auth configuration after confirming plan/capability and login regression behavior.

### M2 — `main` has no GitHub branch protection

Direct main writes are operationally prohibited but not platform-enforced. Configure deliberate protection/required checks when repository workflow allows it.

### M3 — Dependabot alerts disabled

CI provides dependency audit gates, but this is not identical to continuous Dependabot alerting.

### M4 — No enforced CSP / Permissions-Policy

Production already has HSTS, nosniff, DENY framing and strict-origin referrer policy. A rigid CSP was not introduced blindly because Google/Supabase/PWA behavior should remain covered before enforcement.

### M5 — Two HIGH advisories remain in development tooling

After a non-forced lockfile refresh, the production dependency graph is **0 HIGH / 0 CRITICAL**. The full dependency graph still reports **2 HIGH / 0 CRITICAL** in development/build tooling; one npm-proposed Vite fix is semver-major. CI keeps these visible while blocking HIGH/CRITICAL in the production graph and CRITICAL in the full graph. No force-upgrade is bundled into the stable hardening release.

## LOW / ACCEPTED

### L1 — Security Advisor warnings for intentional SECURITY DEFINER RPCs

37 authenticated SECURITY DEFINER RPCs remain by architecture. The audited set has fixed `search_path`, tenant/auth validation and no dynamic SQL pattern. Advisor warnings stay visible and must be re-audited when functions change.

### L2 — Performance Advisor unused-index INFO

Many indexes have no observed scan yet because production tables are small/new. Ownership/FK support indexes are intentionally retained; do not remove them solely to eliminate INFO warnings.

### L3 — Historical migration-history naming drift

Some older Supabase migration history versions/names do not exactly mirror repository marker filenames. This is now understood and documented. The release-relevant schema/grant reconstruction test is green, but remote history must not be manually renamed/repaired without a deliberate supported procedure.

## Data Quality

Latest production read-only Data Quality summary: **0 critical / 0 warning / 0 info / 0 possible duplicates / 0 incomplete profiles / 0 orphan-or-inconsistency candidates**. The earlier INFO-level Storage orphan candidate was never auto-deleted or auto-fixed; it simply no longer appears in the factual current read model.

## Technical debt — not release risk by itself

- `package.json` application version remains `0.0.0`; release identity can remain Git SHA/tag until a user-facing version need appears.
- no third-party client observability platform was added; current evidence uses Vercel/Supabase logs plus redacted client boundary events.
- some provider control-plane configuration and secret values are intentionally not Infrastructure-as-Code and require approved external custody.
- current production data volume is small, so capacity/performance conclusions require re-baselining as usage grows.

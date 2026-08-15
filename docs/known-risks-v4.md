# Hub Giulia 4.0 — Known Risks

Audit date: 2026-08-15. Risks are kept separate from ordinary technical debt; no warning is hidden to create a zero-warning report.

## RELEASE BLOCKERS

**None currently open.** Migration reconstruction, critical isolated E2E and production data/Storage recovery are all backed by executable evidence. Stable still requires final branch CI, merge, Vercel Production READY, post-deploy smoke and final production revalidation.

## RESOLVED DURING V4

### R1 — Clean migration/schema reconstruction

Additive rebuild bridges restored DDL that live production already had but older repository markers did not reproduce. Hosted grant parity is versioned. A fresh Supabase instance now applies the complete Git chain and immediately runs isolated E2E successfully. Historical hosted migration names remain documented drift; never repair old history blindly.

### R2 — Critical authenticated E2E / Storage negative suite

Playwright plus a disposable local Supabase/Auth/Storage stack is a permanent CI gate. Final suite: **12/12 passed**. Coverage includes Auth/logout/session cleanup, patient double-submit/Patient360, Global Search isolation, anamnesis, Photos, DB/Storage cross-tenant negatives, attendance/finance/returns/aftercare, injectables, CRM/proposal/package/credit/Relationship, concurrency/idempotency, PWA safety and responsive viewports.

The suite exposed a real Patient360 close race that could reopen the drawer during navigation and block logout; the Hub was fixed and the regression is covered.

### R3 — HIGH table privilege exposure

Before v4, `authenticated` had `TRUNCATE`/`TRIGGER`/`REFERENCES` on 12 public tables. v4 revoked those privileges, preserved required application CRUD and versioned the grant reconstruction.

### R4 — Production data + Storage recovery

A dedicated recovery project (`coimstexbntzxzrwlrws`) receives a daily self-contained private snapshot from production. The package contains all 50 public tables, required Auth identity records and the actual private bytes from clinical/commercial Storage, with SHA-256 fingerprints.

A real hosted restore drill stored the archive first, restored the recovery target from that archive and verified **0 table/object mismatches**. Evidence: 50 public tables, 2 Auth tables, 5 Storage objects, 2,819,358-byte gzip archive and 6.564-second measured warm snapshot+restore+verification. Recovery retained 50/50 RLS, 12/12 `security_invoker` views, a private backup bucket and 0/0 cross-tenant visibility.

Daily job: `hub-giulia-daily-recovery-backup`, 06:00 UTC / 03:00 America/Sao_Paulo. The latest 14 verified snapshots are retained. Target RPO is <=24h when the job is healthy; full application failover time is not asserted as an SLA.

## HIGH

None currently proven.

## MEDIUM

### M1 — Supabase leaked-password protection disabled

Security Advisor reports compromised-password protection disabled. Enable after confirming plan/capability and login regression behavior.

### M2 — `main` has no GitHub branch protection

Direct main writes are operationally prohibited but not platform-enforced. Configure required checks/protection deliberately when repository workflow allows it.

### M3 — Dependabot alerts disabled

CI provides dependency-audit gates, but this is not identical to continuous Dependabot alerting.

### M4 — No enforced CSP / Permissions-Policy

Production has HSTS, nosniff, DENY framing and strict-origin referrer policy. A rigid CSP was not introduced blindly because Google/Supabase/PWA behavior should remain covered before enforcement.

### M5 — Two HIGH advisories remain in development tooling

The production dependency graph is **0 HIGH / 0 CRITICAL**. The full dependency graph still reports **2 HIGH / 0 CRITICAL** in development/build tooling; one proposed Vite fix is semver-major. CI keeps them visible without force-upgrading this release.

### M6 — Recovery remains on the same provider

The recovery vault is a separate Supabase project and protects against production-project corruption/deletion, but it is not a cross-provider archive. A separately encrypted off-provider copy is recommended defense in depth, not a v4 release blocker.

## LOW / ACCEPTED

- 37 intentional authenticated `SECURITY DEFINER` RPCs remain visible in Security Advisor; audited set has fixed `search_path`, tenant/auth validation and no dynamic-SQL pattern.
- Performance Advisor `unused_index` INFO remains accepted on the small/new dataset; ownership/FK support indexes are retained.
- Some old hosted migration names do not exactly mirror repository marker filenames; current reconstruction is green and old history must not be casually rewritten.
- Recovery preserves identities but deliberately does not reactivate prior login sessions; users sign in again after disaster cutover.

## Data Quality

Latest production read-only state before final release revalidation: **0 critical / 0 warning / 0 info / 0 possible duplicates / 0 incomplete profiles / 0 orphan-or-inconsistency candidates**. No ambiguous clinical/financial row was auto-fixed.

## Technical debt — not release risk by itself

- `package.json` remains `0.0.0`; Git SHA + release tag identify the release.
- no third-party client observability platform was added; evidence uses Vercel/Supabase logs plus redacted client boundary events.
- some provider control-plane configuration and secret values intentionally remain outside Git.
- performance/capacity conclusions must be re-baselined as data volume grows.

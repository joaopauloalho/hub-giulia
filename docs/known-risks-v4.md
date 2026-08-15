# Hub Giulia 4.0 — Known Risks

Audit date: 2026-08-15. Risk is separated from ordinary technical debt. No finding is hidden to create a zero-warning report.

## BLOCKER

### B1 — No verified recoverable production backup / restore

**State:** production Supabase is on the Free plan; no managed database recovery point/PITR or isolated real restore was verified. Storage object backup is also not independently verified.

**Impact:** catastrophic database or Storage loss does not have a proven recovery path/RPO/RTO. The Hub cannot truthfully be marked fully Stable under the v4 acceptance criteria.

**Required action:** enable an auditable database backup/recovery mechanism and separate Storage object recovery, then perform an isolated restore drill and record measured RPO/RTO. Never restore over production.

### B2 — Historical migration history drift

**State:** a set of older migration versions/names in `supabase_migrations.schema_migrations` does not exactly match repository filenames/versions. The 3.9 tail and new v4 migrations are aligned, but remote migration history cannot yet be treated as an exact mirror of Git history.

**Impact:** remote `db push`/reconstruction/deployment source-of-truth confidence is incomplete even if the repository migration chain can rebuild locally.

**Required action:** produce a deliberate remote↔repository migration mapping/checksum audit and use the supported Supabase migration-history repair/baseline process if necessary. Do not rename/edit already-applied SQL or mutate production history blindly.

### B3 — Full critical authenticated E2E / Storage API negative suite not executed

**State:** no Playwright/Cypress existed at audit start and no isolated test identity/environment with safe writable test data was available. Database-level cross-tenant negative tests were executed and passed, but authenticated browser flows and Storage signed-url/upload/delete cross-tenant tests were not executed end-to-end.

**Impact:** UI/session/integration regressions across all requested critical flows are not covered by a release-grade E2E layer, so the v4 E2E acceptance criterion is not met.

**Required action:** provision an isolated test environment/credentials and add a small robust Playwright suite for critical flows; never run destructive E2E against real patients.

## HIGH

None currently proven outside the BLOCKER items above. The v4 least-privilege HIGH finding (authenticated TRUNCATE/TRIGGER/REFERENCES grants) was corrected and post-validated.

## MEDIUM

### M1 — Supabase leaked-password protection disabled

Security Advisor reports compromised-password protection disabled. Enable through Auth configuration after confirming plan/capability and login regression behavior.

### M2 — `main` has no GitHub branch protection

Direct main writes are operationally prohibited but not platform-enforced. Configure deliberate protection/required checks when repository workflow allows it.

### M3 — Dependabot alerts disabled

GitHub cannot currently provide repository Dependabot alert coverage. v4 CI adds `npm audit --audit-level=high`, but this is not identical to continuous Dependabot alerting.

### M4 — No enforced CSP / Permissions-Policy

Existing production has HSTS, nosniff, DENY framing and strict-origin referrer policy. A CSP was not introduced blindly because Supabase, Google OAuth, fonts/assets and PWA behavior need integrated regression testing first.

## LOW / ACCEPTED

### L1 — Security Advisor warnings for intentional SECURITY DEFINER RPCs

37 authenticated SECURITY DEFINER RPCs remain by architecture. Audit found fixed `search_path`, tenant/auth checks and no dynamic SQL pattern in the audited set. Advisor warnings remain visible by design and must be re-audited when functions change.

### L2 — Performance Advisor unused-index INFO

Many indexes have no observed scan yet because tables are small/new. Ownership/FK indexes are intentionally retained. Do not remove indexes solely to eliminate INFO warnings.

### L3 — One Data Quality Storage orphan candidate

Current Data Quality reports one INFO-level Storage orphan candidate. It is report-only; no object/row was deleted automatically.

## Technical debt — not release risk by itself

- `package.json` application version remains `0.0.0`; release identity can remain Git SHA/tag until a user-facing version need appears.
- no third-party client observability platform was added; current evidence relies on Vercel/Supabase logs plus a redacted ErrorBoundary event.
- some provider control-plane configuration (secret values, OAuth console settings, Vercel environment values) is intentionally not Infrastructure-as-Code and requires documented external custody.
- current production data volume is small, so capacity/performance conclusions require re-baselining as usage grows.

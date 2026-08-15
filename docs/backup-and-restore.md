# Hub Giulia 4.0 — Backup and Restore

Audit date: 2026-08-15.

## Executive status

**Database schema reconstruction: PASSED.** A clean local Supabase instance now rebuilds the current Git migration chain, including RLS/functions/triggers/application grants, and then passes the isolated E2E suite.

**Production database managed recovery: NOT yet verified under the current Free-plan setup.**

**PITR: not enabled/verified.**

**Real isolated production-data restore drill: NOT executed.** Production was never used as a restore target.

**Storage object backup: NOT independently verified.** Database recovery and Storage object recovery are separate; restoring Postgres metadata does not recreate missing clinical photo/PDF bytes.

Therefore the remaining v4 Stable blocker is **data recoverability**, not code/schema reproducibility.

## Recovery inventory

| Asset | Current durable source | Recovery confidence | Notes |
|---|---|---|---|
| Frontend source | GitHub | High | Build/versioned source; Vercel can deploy a reviewed SHA |
| Database schema/RLS/functions/grants | GitHub migrations | High | Clean Supabase rebuild + isolated E2E passed in CI |
| Database production data | Supabase production | Low pending backup | No auditable accessible recovery point/PITR verified in current Free setup |
| Storage metadata | Postgres + migrations | High for schema; data follows DB backup | Object bytes remain separate |
| Clinical photo bytes | Supabase Storage | Low pending independent backup | Private and integrity-tracked; no independent object backup verified |
| Contract/proposal bytes | Supabase Storage | Low pending independent backup | Private; hashes/snapshots do not recreate missing bytes |
| Edge Function source | GitHub | High | `supabase/functions/` versioned |
| Edge Function secret values | Supabase control plane / approved external custody | Medium | Values intentionally not versioned |
| Vercel build config | GitHub + Vercel project | High/Medium | `vercel.json` versioned; env values remain control-plane secrets |
| Google OAuth configuration | Google/Supabase control planes + code | Medium | Redirect/state logic versioned; secret values/external console config require custody |

## Schema reconstruction drill — PASSED

CI uses Supabase CLI 2.114.0 to create a disposable local stack and apply repository migrations from zero. Historical gaps were repaired with additive rebuild bridges rather than editing already-applied migrations:

- `20260813233950_rebuild_bridge_owner_keys_defaults.sql` restores owner composite UNIQUE keys and `auth.uid()` defaults that production already had;
- `20260813185425_rebuild_bridge_finance_ledger_rollup.sql` restores procedure ledger columns/function/trigger with deliberately no historical data rewrite;
- `20260815163948_production_hardening_v4_grants_rebuild.sql` reproduces the audited hosted application grant matrix.

The resulting clean database successfully seeds synthetic tenants, Auth and Storage and passes the full isolated Playwright suite. This proves **schema/configuration reconstruction represented by migrations**; it does not prove recovery of production clinical/financial rows or object bytes.

## Production data backup facts

The current Hub production project is Free. Under the audited current setup, no accessible managed backup/PITR recovery point has been verified for operational reliance. A logical/off-site database backup or a paid managed recovery mechanism must exist before Stable can claim bounded data loss.

Never treat Git history, migrations or test fixtures as a backup of clinical/financial production data.

## RPO

**Current verified production-data RPO: unbounded by an audited accessible backup mechanism.**

Do not publish a 24-hour or other RPO until a retained recovery mechanism is enabled and verified. Once enabled, record:

- backup/recovery type;
- schedule/continuous recovery behavior;
- retention;
- oldest/newest recoverable point;
- separate Storage object backup schedule/retention;
- date/result of last restore drill.

## RTO

**Current verified RTO for database/Storage loss: not established.**

Frontend rollback can use a known-good Vercel deployment, but full clinical-data RTO must be measured by a real isolated restore drill rather than guessed.

## Restore drill result — v4

Real production-data restore: **NO, not yet.**

Reason: no already-provisioned isolated recovery target with a verified accessible production backup exists under the current setup, and the release explicitly forbids restoring over production or copying PHI into a normal development environment.

The next drill must restore into a dedicated, access-restricted recovery target. If provider cost is involved, cost must be explicitly confirmed before provisioning.

## Required real recovery drill

1. Enable/verify the chosen production database backup mechanism.
2. Establish a separate private backup/copy mechanism for Storage object bytes.
3. Create an isolated recovery target; never overwrite production.
4. Restrict access; never use restored PHI as ordinary development data.
5. Restore a selected database recovery point.
6. Validate migration/schema version, extensions, constraints, RLS, grants, functions and triggers.
7. Validate safe aggregate row-count ranges/invariants for patients, procedures, payments, photo metadata, contracts, returns, packages and aftercare without exporting PHI.
8. Restore/attach Storage object backup separately and validate sampled object-path/checksum existence without public exposure.
9. Reconfigure/deploy Edge Functions and required secret names using approved secret custody.
10. Run authenticated read/smoke validation with dedicated test identities; record elapsed recovery time and the actual data-loss window.
11. Expire/destroy the recovery target when retention/security policy allows.

## Storage recovery

### Patient photos

Canonical DB records hold private object paths, checksums and metadata. Original bytes are the clinical source asset; preview/thumbnail variants are derived. A recovery mechanism must preserve original object bytes and owner-prefixed paths. A thumbnail cannot be treated as a substitute for a lost original.

### Contracts / proposals

PDF/signature artifacts are private Storage objects linked from immutable/snapshot DB records. Hashes detect mismatch but do not recreate missing bytes. Object-level backup/copy is required.

### Current limitation

No independent versioned/exported Storage backup has yet been verified. A database-only backup is insufficient for full Hub recovery.

## Reconstruction checklist

If Vercel disappears:

- recreate/link the project;
- use `vercel.json` + GitHub source;
- restore approved environment secret values from external/control-plane custody;
- deploy a known reviewed SHA;
- validate aliases/domains/security headers/PWA.

If Supabase configuration disappears:

- recreate Postgres from the now-green migration chain;
- recreate private buckets/policies from migrations/configuration;
- deploy versioned Edge Functions;
- restore secret values from approved custody, never Git;
- restore production database data and Storage bytes from verified backup sources;
- restore external OAuth configuration/redirects;
- run recovery validation before traffic cutover.

## Backup operating checklist

Monthly, and after material infrastructure changes:

- verify the database recovery mechanism is enabled and accessible;
- inspect latest recovery point and retention;
- verify Storage object backup separately;
- verify GitHub migrations + Edge Functions remain reconstructible;
- verify approved custody of required secret/configuration values without printing them;
- perform periodic isolated restore drills;
- update measured RPO/RTO evidence after each drill.

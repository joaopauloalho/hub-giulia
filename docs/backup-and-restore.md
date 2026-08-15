# Hub Giulia 4.0 — Backup and Restore

Audit date: 2026-08-15.

## Executive status

**Database managed backup: NOT verified / not available under the current Supabase Free plan.**

**PITR: NOT available/verified.**

**Real isolated restore drill: NOT executed.** The current infrastructure does not provide a safe, already-provisioned recovery target that can be restored without creating/upgrading paid infrastructure. Production was never used as a restore target.

**Storage object backup: NOT independently verified.** Database backup and Storage object recovery are separate concerns; a database restore alone must not be assumed to recreate clinical photo/PDF bytes.

These are release blockers for a claim of fully recoverable Stable production. They are not masked by documentation.

## Recovery inventory

| Asset | Current durable source | Recovery confidence | Notes |
|---|---|---|---|
| Frontend source | GitHub | High | Build is versioned; Vercel can redeploy a known SHA |
| Database schema | GitHub migrations + live Supabase history | Medium | Local rebuild gate added in v4; historical remote/repo migration-version drift still requires reconciliation |
| Database data | Supabase production only under current verified setup | Low | No managed backup/PITR verified on current Free plan |
| Storage metadata | Postgres + migrations | Medium | DB rows/policies versioned or recoverable with DB, but object bytes are separate |
| Clinical photo bytes | Supabase Storage | Low | Private and integrity-tracked, but no independent object backup verified |
| Contract/proposal PDFs | Supabase Storage | Low | Private; no independent object backup verified |
| Edge Function source | GitHub | High | `supabase/functions/` is versioned |
| Edge Function secret values | Supabase control plane / external secret custody | Medium | Secret values intentionally not versioned; recovery requires externally retained credentials |
| Vercel build config | GitHub + Vercel project | High/Medium | `vercel.json` is versioned; environment values are not |
| Vercel environment values | Vercel control plane / external secret custody | Medium | Never copy values to GitHub; connector audit cannot prove an independent backup |
| Google OAuth configuration | Google + Supabase control plane + code | Medium | Redirect/origin logic versioned; client secret and external console configuration are not |

## RPO

**Current verified RPO for database and Storage: unbounded by an audited backup mechanism.**

Do not state “24 hours” or another number until an actual backup mechanism with retained recovery points is enabled and verified. Git history protects code, not production clinical/financial records.

Once a managed/external backup is enabled, record here:

- backup type;
- schedule;
- retention;
- oldest/newest recoverable point;
- whether WAL/PITR is enabled;
- separate Storage object retention/versioning/export strategy;
- date of last successful restore drill.

## RTO

**Current verified RTO for a database-loss disaster: not established.**

A frontend-only bad deployment can generally be recovered by promoting/redeploying a known-good Vercel deployment after verification, but database/Storage RTO cannot be promised until a recovery target and restore drill have been exercised.

## Restore drill result — v4

Real restore: **NO**.

Reason: current production is on Supabase Free and no safe isolated recovery environment was already available. The release explicitly forbids restoring over production. Creating a Supabase branch/project may have cost and requires explicit cost confirmation before creation.

Alternative validation performed/planned in v4:

1. Fresh local Supabase stack in CI.
2. Apply repository migrations from zero using `supabase db reset --local --no-seed`.
3. Fail the release gate if the migration chain cannot recreate the schema.
4. Run read-only security/invariant contract checks against the resulting schema where applicable.

This validates **schema reproducibility**, not production data or Storage recovery.

## Required real recovery drill

When recoverable infrastructure is enabled:

1. Create an isolated recovery target. Never overwrite production.
2. Restrict access to the smallest recovery group; do not use the restored PHI environment as normal development.
3. Restore the selected database recovery point.
4. Validate schema version, extensions, constraints, RLS, functions, triggers and critical row-count ranges without exporting PHI.
5. Validate canonical integrity counts (patients, procedures, payments, photos metadata, contracts, returns, packages, aftercare).
6. Restore/attach Storage object backup separately and validate sampled object-path existence against DB metadata without exposing objects publicly.
7. Validate Edge Functions and required secret *names*; inject secret values through the control plane, never Git.
8. Run authenticated smoke tests with dedicated non-clinical test identities/data.
9. Record actual elapsed recovery time and data-loss window; use those values for RTO/RPO.
10. Destroy/expire the temporary recovery environment when retention/legal requirements allow.

## Storage recovery

### Patient photos

Canonical DB records hold private object paths, checksums and metadata. The original file is the clinical source asset; previews/thumbnails are derived. A future Storage backup should retain original object bytes and preserve owner-prefixed paths. If only derived variants are lost they can, in principle, be regenerated from originals; the original must not be treated as reconstructable from the thumbnail.

### Contracts / proposals

PDF/signature artifacts are private Storage objects linked from immutable/snapshot DB records. Hashes help detect mismatch but do not recreate missing bytes. Object-level backup is required for reliable recovery.

### Current limitation

No independent versioned/exported Storage backup was verified in v4. A database-only backup is therefore insufficient for full clinical recovery.

## Reconstruction checklist

If Vercel disappears:

- recreate/link the Vercel project;
- use `vercel.json` + GitHub source;
- restore environment *names/values* from approved secret custody;
- deploy a known reviewed SHA;
- validate aliases/domains/security headers/PWA.

If Supabase configuration disappears:

- recreate Postgres from migrations only after the migration-history blocker is reconciled and the fresh-rebuild gate is green;
- recreate private buckets/policies from migrations;
- deploy versioned Edge Functions;
- restore secret values only from approved external/control-plane custody;
- restore database data and Storage bytes from verified backup sources;
- reconfigure OAuth external redirect settings.

## Backup operating checklist

Monthly, and after any material infrastructure change:

- verify backup mechanism is enabled;
- inspect latest recovery point and retention;
- verify Storage is backed up separately;
- verify GitHub source + migrations + Edge Functions are current;
- verify external custody of required secrets/configuration without printing values;
- run or schedule an isolated restore drill according to risk and plan capabilities;
- record measured RPO/RTO evidence.

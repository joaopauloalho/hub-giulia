# Hub Giulia 4.0 — Backup and Restore

Audit date: 2026-08-15.

## Executive status

**Schema reconstruction: PASSED.** The complete Git migration chain rebuilds a clean Supabase instance and immediately passes isolated E2E.

**Production data + Storage recovery: PASSED.** A dedicated recovery project (`coimstexbntzxzrwlrws`, `us-east-2`) now receives self-contained private snapshots from production (`pvkrwjryvwsfwaxougyy`). The snapshot contains all 50 public tables, `auth.users`, `auth.identities`, and the actual private bytes from `patient-photos`, `contracts`, and `proposals`.

**Real isolated restore drill: PASSED.** The recovery service first stores the `.json.gz` archive, then restores its own database/Storage from that archive and verifies exact table fingerprints plus object SHA-256 hashes. Production is never a restore target.

**PITR: not enabled.** The v4 recovery mechanism is a verified logical snapshot pipeline, not continuous WAL/PITR.

## Architecture

- Production migration `20260815175237_production_hardening_v4_recovery_cron_extensions.sql` enables `pg_net` and `pg_cron`.
- Production Edge Function: `supabase/functions/recovery-backup-v4/index.ts`.
- Recovery-only Edge Function: `recovery/supabase/functions/recovery-backup-ingest/index.ts`.
- Production cron: `hub-giulia-daily-recovery-backup`, `0 6 * * *` UTC = 03:00 America/Sao_Paulo.
- Recovery Storage bucket: `recovery-backups`, private.
- Retention: latest 14 verified snapshots.
- Secret values live in Supabase Vault and never in Git:
  - `hub_giulia_backup_invoke_token` in production;
  - `hub_giulia_backup_transfer_token` in production and recovery.

The export uses PostgreSQL-side `to_jsonb(row)::text` serialization rather than JavaScript date coercion so PostgreSQL timestamp precision is preserved. Auth sessions/refresh sessions are intentionally excluded: users and identities recover, but clients must sign in again after disaster recovery rather than reviving old sessions.

## Verified restore evidence — 2026-08-15

Successful snapshot/restore:

- source migration version: `20260815175237`;
- public tables: 50;
- Auth tables: 2 (`users`, `identities`);
- private Storage objects: 5;
- raw package: 3,816,244 bytes;
- compressed archive: 2,819,358 bytes;
- archive: `snapshots/2026-08-15T17-58-09-871Z.hub-giulia.json.gz`;
- archive SHA-256: `4557153f10f76328ec7b460661feeeeb2e86efbf6a5307b833b5064ec4445c89`;
- table/object mismatches: 0;
- measured warm snapshot + restore + verification duration: **6.564 seconds**.

Recovery post-check:

- 50/50 public tables have RLS;
- 12/12 public views are `security_invoker`;
- recovery backup bucket is private;
- 5/5 clinical/commercial objects restored;
- 5 patients, 5 anamneses, 2 Auth users restored;
- cross-tenant transactional simulation: user B saw 0 user-A patients and 0 user-A Storage objects.

The first drill attempt intentionally failed verification because JavaScript timestamp conversion rounded PostgreSQL microseconds. That snapshot was removed, serialization was corrected to PostgreSQL-native JSON text, and the full drill was repeated successfully with zero mismatches. Failed newly-created archives are removed automatically.

## RPO

**Recovery-point objective: <= 24 hours** while the scheduled job and recovery project are healthy. Backups run once daily at 03:00 Brazil time and retain 14 verified snapshots. The current mechanism is not PITR; a failure immediately before the next scheduled snapshot can lose changes since the previous successful snapshot.

Operationally verify the latest successful cron/Edge run rather than assuming the RPO from configuration alone.

## RTO

**Measured data-layer warm restore for the current production dataset: 6.564 seconds**, including snapshot transfer, restore, and fingerprint/hash verification into the already-provisioned recovery project.

The recovery schema was also reconstructed independently from all 123 Git migrations in the hosted recovery project before restoring data. Full application failover time (repointing Vercel environment/OAuth/provider configuration and traffic) is not an asserted SLA and was not simulated against live production routing.

## Recovery inventory

| Asset | Durable/recovery source | Confidence |
|---|---|---|
| Frontend + migrations + production Edge Functions | GitHub | High |
| Production database rows | Daily verified recovery snapshot | High for current mechanism |
| Auth users/identities | Daily verified recovery snapshot | High; active sessions intentionally excluded |
| Clinical photos | Snapshot includes original private object bytes + SHA-256 | High |
| Contract/proposal PDFs | Snapshot includes private object bytes + SHA-256 | High |
| Recovery archive | Private `recovery-backups` bucket in dedicated recovery project | High for project-level loss |
| Secrets/OAuth external config | Provider control planes / Vault | Medium; values intentionally not in Git |

## Disaster use

1. Never restore over production during investigation.
2. Inspect the latest verified archive and its timestamp.
3. Use the dedicated recovery project or a newly provisioned isolated target.
4. Reconstruct schema from the green Git migration chain if a cold target is required.
5. Restore the selected snapshot and require zero table/object verification mismatches.
6. Confirm 50/50 RLS, 12/12 security-invoker views, bucket privacy and cross-tenant denial.
7. Deploy/reconfigure Edge Functions and provider secrets through control planes.
8. Point application traffic only after authenticated smoke checks pass.
9. Record actual incident RPO/RTO and preserve evidence without PHI/secrets.

## Operating checks

Daily automation is installed by `scripts/recovery/install-daily-backup.sql`. Monthly and after material infrastructure changes:

- verify `cron.job` is active;
- inspect `cron.job_run_details` and production/recovery Edge logs;
- confirm a recent verified archive exists;
- confirm `recovery-backups` remains private;
- confirm snapshot retention <= 14 archives;
- run an isolated restore drill after material schema/Auth/Storage changes;
- remeasure RPO/RTO when data volume materially grows.

## Residual recovery limitation

Production and the recovery vault are separate Supabase projects but remain within the same provider. This protects against production-project corruption/deletion and provides a proven isolated restore path; it is not a cross-provider disaster archive. A separately encrypted off-provider copy can be added later as defense in depth without blocking v4 Stable.

# Hub Giulia — Recovery Project

This directory versions the code that belongs to the **dedicated recovery project**, not the production Supabase project.

## Targets

- Production: `pvkrwjryvwsfwaxougyy`
- Recovery vault/restore target: `coimstexbntzxzrwlrws`
- Region: `us-east-2`

`recovery/supabase/functions/recovery-backup-ingest/index.ts` must be deployed only to the recovery project. Do not deploy it as part of the normal production Edge Function set.

## Secret custody

Secret values are stored in Supabase Vault and are never committed:

- production Vault: `hub_giulia_backup_invoke_token`
- production + recovery Vault: `hub_giulia_backup_transfer_token`

The transfer token authenticates production-to-recovery snapshot delivery. The invoke token authenticates the scheduled production backup function.

## Snapshot model

Each successful run creates a private gzip archive in recovery Storage under `recovery-backups/snapshots/`. The package contains:

- all `public` table rows, serialized by PostgreSQL as `to_jsonb(row)::text` to preserve native timestamp precision;
- `auth.users` and `auth.identities` (sessions are intentionally not restored);
- private object bytes for `patient-photos`, `contracts`, and `proposals`;
- SHA-256 table/object fingerprints.

The ingest function stores the archive, restores the recovery target from that package, then verifies table fingerprints and Storage hashes. A failed newly-created archive is removed. The latest 14 verified snapshots are retained.

## Operations

The production cron definition is versioned at `scripts/recovery/install-daily-backup.sql` and runs at 06:00 UTC (03:00 America/Sao_Paulo). Monitor the cron job plus production/recovery Edge Function logs. Never point the restore routine at production.

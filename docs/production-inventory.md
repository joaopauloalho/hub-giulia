# Hub Giulia 4.0 — Production Inventory

Audit date: 2026-08-15. Production baseline remains SHA `eae33ffba9c450fefc042496143c5130c8ba6540`; v4 remains isolated on `agent/production-hardening-v4` until final release gates pass.

## Frontend

- React 18.3.1 + TypeScript + Vite 5.4.x.
- Routing: React Router 7.14.x.
- Auth/session: Supabase Auth through `@supabase/supabase-js`.
- PWA: `public/manifest.webmanifest`, `public/sw.js`, orchestration in `src/lib/pwa.ts`.
- Service worker bypasses authenticated Supabase REST/Auth/Storage/Functions traffic and logout purges private session/cache state.
- Dirty-form guard prevents forced PWA update while unsaved work exists.
- v4 fixed a Patient360 close race that could reopen the route-backed drawer and block logout; Playwright covers the regression.

## Production database

- Supabase production project: `pvkrwjryvwsfwaxougyy`, Postgres 17.6.1, region `us-east-2`.
- 50 public base tables; RLS enabled on all 50.
- 12 public views; all audited `security_invoker=true`.
- 37 authenticated `SECURITY DEFINER` RPCs remain intentional API boundaries with fixed `search_path`, tenant/auth checks and no audited dynamic-SQL pattern.
- Critical ownership relationships use composite tenant FKs.
- Historical/immutable semantics are enforced across anamnesis, contracts, photos, injectables, proposals and package/credit ledger flows.
- v4 production recovery migration `20260815175237_production_hardening_v4_recovery_cron_extensions` enables `pg_net` + `pg_cron` for the verified snapshot pipeline.

## Production Storage

| Bucket | Public | Limit | Purpose |
|---|---:|---:|---|
| `patient-photos` | No | 20 MB | Clinical originals, previews, thumbnails |
| `contracts` | No | 10 MB | Contract PDF/signature artifacts |
| `proposals` | No | 10 MB | Proposal PDFs |

Paths are owner-prefixed. Isolated v4 tests prove another tenant cannot list/download/sign/upload-overwrite/delete another tenant's object.

## Recovery infrastructure

- Dedicated recovery Supabase project: `coimstexbntzxzrwlrws`, region `us-east-2`.
- Private recovery bucket: `recovery-backups`.
- Production Edge Function: `recovery-backup-v4` (source under `supabase/functions/`).
- Recovery-only Edge Function: `recovery-backup-ingest` (source under `recovery/supabase/functions/`, never part of normal production deployment).
- Vault-authenticated production-to-recovery transfer; secret values are not in Git.
- Daily cron: `hub-giulia-daily-recovery-backup`, 06:00 UTC / 03:00 America/Sao_Paulo.
- Retention: latest 14 verified archives.
- Package includes all 50 public tables, Auth user/identity records, and actual private bytes from `patient-photos`, `contracts`, `proposals`.
- Prior login sessions are intentionally not restored; re-authentication is required after DR.

Verified hosted drill on 2026-08-15: 50 public tables + 2 Auth tables + 5 private objects, 2,819,358-byte gzip archive, SHA-256 verified, **0 mismatches**, 6.564-second warm snapshot+restore+verification. Recovery post-check remained 50/50 RLS, 12/12 security-invoker views, private backup bucket and cross-tenant 0/0 visibility.

## Edge Functions

Production application functions remain versioned under `supabase/functions/`, including Google OAuth/Calendar, contract finalization and the v4 recovery exporter. Recovery ingestion is deliberately stored under `recovery/` so normal production deployment cannot accidentally install a destructive restore target into production.

## Infrastructure

- Vercel project `hub-giulia`, Node 24.x, production region `iad1`.
- `main` maps to Production.
- `agent/**` automatic Vercel Preview deploys are disabled.
- Production response has HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and strict-origin referrer policy.
- CSP/Permissions-Policy remain a documented non-blocking hardening item rather than a blind enforcement change.

## Tests / CI

- 24 Vitest files, 127 tests.
- Gates: tests, typecheck, lint, Vite build, dependency audit.
- Playwright isolated suite: **12/12 passed**.
- CI creates a disposable local Supabase/Auth/Storage stack; no production clinical write is used.
- Covered: Auth, patient double-submit, Patient360, Global Search isolation, anamnesis, clinical Photos, cross-tenant DB/Storage negatives, attendance + finance + returns + aftercare, injectables concurrency, CRM → proposal → package/credit → Relationship, PWA safety and responsive viewports.

## Database reconstruction / migrations

A clean Supabase reconstruction is a permanent CI gate using CLI 2.114.0. Historical repository DDL gaps were repaired by additive bridge migrations rather than editing applied history. Current hosted grants are represented by `20260815163948_production_hardening_v4_grants_rebuild.sql`. The clean chain now reconstructs schema, functions, triggers, RLS and application grants before E2E.

Historical hosted migration names are not a byte-for-byte mirror of every old marker. This is understood/documented; never rename old migrations or repair remote history blindly.

## Canonical sources

- Returns: `procedure_returns`.
- Credits: credit ledger + derived balance.
- Photos: `patient_photos` metadata + private canonical Storage bytes.
- Contracts: immutable snapshot/hash records + private artifacts.
- Relationship/operational attention: derived read models.
- Finance: procedure/package ledgers and canonical rollups.

## Release status

Migration reconstruction ✅ · isolated E2E ✅ · production data/Storage restore drill ✅. No known release blocker remains before final branch CI, merge, production deployment and post-deploy smoke/revalidation.

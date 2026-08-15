# Hub Giulia 4.0 — Production Inventory

Audit date: 2026-08-15. Production baseline remains SHA `eae33ffba9c450fefc042496143c5130c8ba6540`; v4 work is isolated on `agent/production-hardening-v4` until every Stable gate is satisfied.

## Frontend

- React 18.3.1 + TypeScript + Vite 5.4.x.
- Routing: React Router 7.14.x, application shell in `AppRoutesV2`.
- Auth/session: Supabase Auth through `@supabase/supabase-js`.
- PWA: `public/manifest.webmanifest`, `public/sw.js`, orchestration in `src/lib/pwa.ts`.
- Service worker caches only static shell/assets and explicitly bypasses authenticated Supabase REST/Auth/Storage/Functions traffic.
- Dirty-form guard prevents a waiting service worker from forcing an update while unsaved work exists.
- Root ErrorBoundary exposes visible recovery and v4 emits only redacted event code/request correlation metadata.
- v4 fixed a Patient360 close race that could reopen the route-backed drawer during navigation and block logout; the regression is covered by Playwright.

## Backend / database

- Supabase project `pvkrwjryvwsfwaxougyy`, Postgres 17.6.1, region `us-east-2`.
- 50 public base tables; RLS enabled on all 50.
- 12 public views; all audited with `security_invoker=true`.
- 37 authenticated `SECURITY DEFINER` RPCs remain intentional API boundaries. The audited set uses fixed `search_path`, tenant/auth checks and no dynamic SQL pattern.
- Critical ownership relationships use composite tenant foreign keys in clinical, operational and financial modules.
- History/immutability is enforced by constraints/triggers/RPCs for anamnesis versions, contracts, photos, injectables, proposals, package ledger/redemptions and related records.

## Storage

| Bucket | Public | Limit | Purpose |
|---|---:|---:|---|
| `patient-photos` | No | 20 MB | Clinical originals, previews, thumbnails |
| `contracts` | No | 10 MB | Contract PDF/signature artifacts |
| `proposals` | No | 10 MB | Proposal PDFs |

Paths are owner-prefixed. Clinical photo code verifies file signatures, rejects SVG, caps size/pixels, strips image metadata through canonicalization, keeps immutable original metadata, uses thumbnails in grids, and creates short-lived signed URLs. Isolated v4 tests prove another tenant cannot list/download/sign/upload-overwrite/delete another tenant's clinical object.

## Edge Functions

Six deployed functions are versioned under `supabase/functions/`:

- `google-oauth-start` — JWT required.
- `google-oauth-callback` — browser OAuth callback; JWT intentionally not required, state required and consumed server-side.
- `google-calendar-upsert` — JWT required.
- `google-calendar-status` — JWT required.
- `google-calendar-connection` — JWT required.
- `contract-finalize` — JWT required.

## Google integration

- OAuth authorization-code flow is server-side.
- Random state is hashed before persistence and atomically consumed during callback.
- Client secret, access token and refresh token handling remains server-side; token values are not browser-log material.
- Google token/connection tables are more restricted than normal tenant tables and do not depend on direct browser token access.

## Infrastructure

- Vercel project `hub-giulia`, Node 24.x, production region `iad1`.
- `main` maps to Production.
- `agent/**` deployments are disabled in `vercel.json`, preventing Preview churn.
- Production response has HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and strict-origin referrer policy.
- No rigid CSP was added blindly; Supabase, Google OAuth, fonts/assets and PWA behavior must remain covered before enforcement.

## Tests / CI

- Unit/integration baseline: 24 Vitest files, 127 tests.
- Gates: `npm test`, typecheck, lint, Vite build, production dependency audit, full dependency visibility.
- Playwright 1.62.x added in v4. Final isolated suite: **12/12 passed**.
- The E2E job creates a disposable local Supabase/Auth/Storage stack and two synthetic users; no production patient or production write is used.
- Covered flows include protected-route/login/logout, patient create + double-submit, Patient360, Global Search tenant isolation, anamnesis revision/finalization, clinical Photos lifecycle, cross-tenant DB/Storage negatives, attendance + finance + returns + aftercare, injectables finalization concurrency, CRM → proposal → package/credit → Relationship, PWA cache safety, critical-route smoke and iPhone/iPad/desktop viewport checks.
- Canonical critical RPCs are exercised with parallel retries for attendance, anamnesis finalization, proposal/package lifecycle and injectable finalization.

## Database reconstruction / migrations

Clean reconstruction is now a permanent CI gate using Supabase CLI 2.114.0. A fresh local Supabase instance successfully applies the repository chain from zero and then runs the E2E suite.

Two deliberately additive historical rebuild bridges restore DDL that live production already had but older repository marker files did not reproduce:

- `20260813233950_rebuild_bridge_owner_keys_defaults.sql` — owner composite UNIQUE keys + `auth.uid()` defaults.
- `20260813185425_rebuild_bridge_finance_ledger_rollup.sql` — procedure ledger columns/function/trigger, deliberately without historical data backfill.

Current hosted grants are also represented by `20260815163948_production_hardening_v4_grants_rebuild.sql`. Post-check matrix: anon has 0 public-table privileges, authenticated has the audited application privileges and 0 `TRUNCATE`/`REFERENCES`/`TRIGGER`, service_role retains full table privileges.

Historical Supabase migration version/name records are not an exact textual mirror of every old repository filename. That drift is now understood rather than hidden: do not rename old migrations or repair remote history blindly. The release-relevant requirement — reconstruct current schema, RLS, functions, triggers and application grants from Git — is green.

## Data domains and mutability

| Domain | Canonical sources | Semantics |
|---|---|---|
| Clinical | patients, anamnesis + versions, procedures/items, injectables, photos, contracts, returns, aftercare | Current profile fields mutable; finalized/version/snapshot/original records historical/immutable or voided rather than rewritten |
| Financial | procedure payments/rollups, packages, package items, credits ledger, redemptions | Ledger/redemption history historical; derived balances/rollups recomputable; ambiguous history never auto-fixed |
| Operational | appointments, communications, CRM, relationship | Operational state mutable; relationship/attention/read models derived |
| Configuration | services, templates, protocols, preferences/settings | Mutable with historical snapshots/version tables where required |

## Source of truth

Canonical sources confirmed:

- Returns: `procedure_returns`.
- Credits: credit ledger + derived balance.
- Photos: `patient_photos` metadata + private canonical Storage objects.
- Contracts: contract snapshot/hash records + private artifacts.
- Relationship and operational attention: derived read models, not shadow writable stores.
- Finance: procedure/package ledgers and canonical rollups.

## Release status dependency

Code/schema/test reconstruction is green. The remaining Stable blocker is production-data recoverability: an auditable database backup/recovery point, separate Storage-object recovery and an isolated restore drill with measured RPO/RTO.

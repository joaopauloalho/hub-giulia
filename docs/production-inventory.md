# Hub Giulia 4.0 — Production Inventory

Audit date: 2026-08-15. Production baseline SHA: `eae33ffba9c450fefc042496143c5130c8ba6540`.

## Frontend

- React 18.3.1 + TypeScript + Vite 5.4.x.
- Routing: React Router 7.14.x, application shell in `AppRoutesV2`.
- Auth/session: Supabase Auth through `@supabase/supabase-js`.
- PWA: `public/manifest.webmanifest`, `public/sw.js`, orchestration in `src/lib/pwa.ts`.
- Service worker caches only static shell/assets and explicitly bypasses `/rest/`, `/auth/`, `/storage/` and `/functions/`.
- Dirty-form guard prevents a waiting service worker from forcing an update while unsaved work exists.
- Root ErrorBoundary exposes a visible recovery action; v4 adds redacted correlation logging without error messages/payloads.

## Backend / database

- Supabase project `pvkrwjryvwsfwaxougyy`, Postgres 17.6.1, region `us-east-2`.
- 50 public base tables; RLS enabled on all 50 at audit time.
- 12 public views; all audited with `security_invoker=true`.
- 37 authenticated `SECURITY DEFINER` RPCs remain intentional API boundaries. Audit confirmed fixed `search_path`, `auth.uid()`/owner checks and no dynamic SQL in this set. They remain Advisor warnings by design and require review when changed.
- Critical ownership relationships use composite tenant foreign keys in clinical/financial modules.
- History/immutability is enforced by constraints/triggers for anamnesis versions, contracts, photos, injectables, proposals, package ledger/redemptions and related records.

## Storage

| Bucket | Public | Limit | Purpose |
|---|---:|---:|---|
| `patient-photos` | No | 20 MB | Clinical originals, previews, thumbnails |
| `contracts` | No | 10 MB | Contract PDF/signature artifacts |
| `proposals` | No | 10 MB | Proposal PDFs |

Paths are owner-prefixed. Clinical photo code verifies file signatures, rejects SVG, caps size/pixels, canonicalizes images, strips EXIF/GPS through re-rendering, writes immutable original metadata, uses thumbnails in grids, and creates short-lived signed URLs (10 min thumbnails / 5 min view).

## Edge Functions

Six deployed functions are versioned under `supabase/functions/`:

- `google-oauth-start` — JWT required.
- `google-oauth-callback` — browser OAuth callback; JWT intentionally not required, state is required/consumed server-side.
- `google-calendar-upsert` — JWT required.
- `google-calendar-status` — JWT required.
- `google-calendar-connection` — JWT required.
- `contract-finalize` — JWT required.

## Google integration

- OAuth authorization code flow is server-side.
- Random state is hashed before persistence and atomically consumed during callback.
- Google client secret/refresh token handling remains server-side; no token value belongs in browser logs or repository files.
- Connection metadata is more restricted than normal tenant tables; direct authenticated table access is not relied upon for token operations.

## Infrastructure

- Vercel project: `hub-giulia`, Node 24.x, production region `iad1`.
- `main` maps to Production.
- `agent/**` deployments are disabled in `vercel.json`, preventing Preview churn.
- Production response currently has HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and strict-origin referrer policy.
- No rigid CSP was added in v4 because Supabase, Google OAuth and PWA behavior must be validated together before enforcement.

## Tests / CI

- Baseline before v4: 126 Vitest tests reported green by the 3.9 merge commit.
- Scripts: `npm test`, `npm run typecheck`, `npm run lint`, Vite build.
- v4 CI aligns Node with Vercel (24), adds `npm audit --audit-level=high`, and adds a local Supabase rebuild gate using CLI 2.114.0.
- No Playwright/Cypress suite existed at audit start. Full authenticated/destructive E2E is therefore not claimed as completed.

## Data domains and mutability

| Domain | Canonical sources | Semantics |
|---|---|---|
| Clinical | patients, anamnesis + versions, procedures/items, injectables, photos, contracts, returns, aftercare | Current patient/profile fields mutable; finalized/version/snapshot/original records historical/immutable or voided rather than rewritten |
| Financial | procedure payments/rollups, packages, package items, credits ledger, redemptions | Ledger/redemption history historical; derived balances/rollups recomputable; ambiguous history is never auto-fixed |
| Operational | appointments, communications, CRM, relationship | Operational state mutable; relationship/attention/read models derived |
| Configuration | services, templates, protocols, preferences/settings | Mutable with historical snapshots/version tables where required |

## Source of truth

Canonical sources confirmed:

- Returns: `procedure_returns`.
- Credits: credit ledger + derived balance.
- Photos: `patient_photos` metadata + private canonical Storage objects.
- Contracts: contract snapshot/hash records + private PDF artifacts.
- Relationship and operational attention: derived read models, not shadow writable stores.
- Finance: procedure/package ledgers and their canonical rollups.

### Migration history caveat

Production contains a historical migration-version/name drift relative to repository filenames for a group of previously applied migrations. The 3.9 tail and both v4 migrations are version-aligned, but the older mismatch must be reconciled before remote `supabase db push` can be treated as a proven deployment source of truth. Do not repair production migration history blindly.

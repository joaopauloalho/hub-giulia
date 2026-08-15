# Hub Giulia 4.0 — Security / RLS Matrix

Audit date: 2026-08-15. Matrix reflects production catalog state after v4 ACL/grant hardening.

Legend: S/I/U/D = RLS policy exists for SELECT/INSERT/UPDATE/DELETE. `—` means direct table mutation is intentionally unavailable and normally goes through immutable history or an RPC. All public base tables below have RLS enabled. `anon CRUD` is false for every table.

| Table | RLS | S | I | U | D | Policies | anon CRUD | Ownership / note | Risk |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| anamnesis | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/patient; finalize via RPC/versioning | Low |
| anamnesis_versions | ✅ | ✅ | — | — | — | 1 | none | immutable history | Low |
| appointments | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user/patient composite ownership | Low |
| communication_attention_state | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped, derived operational state | Low |
| communication_messages | ✅ | ✅ | — | — | — | 1 | none | immutable/log style history | Low |
| communication_preferences | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| communication_templates | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| contacts | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| contract_template_versions | ✅ | ✅ | — | — | — | 1 | none | immutable version history | Low |
| contract_templates | ✅ | ✅ | — | — | — | 1 | none | controlled RPC mutation | Low |
| contracts | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | user/patient + finalized guards | Low |
| crm_activities | ✅ | ✅ | ✅ | — | — | 2 | none | append-oriented history | Low |
| crm_deal_interests | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | user/deal/service ownership | Low |
| crm_followups | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/deal ownership | Low |
| data_quality_issue_suppressions | ✅ | ✅ | ✅ | — | ✅ | 3 | none | explicit user suppression only | Low |
| deals | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user/contact/patient ownership | Low |
| google_calendar_connections | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped; direct grants further restricted | Low |
| google_calendar_tokens | ✅ | ✅ | — | — | ✅ | 2 | none | secret-bearing server-side data | Medium: privileged surface |
| injectable_application_points | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | map/application/user ownership | Low |
| injectable_applications | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | map/product/lot/user ownership | Low |
| injectable_maps | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | patient/procedure/user; finalized guard | Low |
| injectable_product_lots | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | product/user ownership | Low |
| injectable_products | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | user scoped | Low |
| maquininha_configs | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user scoped | Low |
| oauth_states | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | short-lived user/provider state | Low |
| package_payments | ✅ | ✅ | — | — | — | 1 | none | immutable package history/RPC | Low |
| package_redemptions | ✅ | ✅ | — | — | — | 1 | none | immutable redemption history | Low |
| patient_credit_ledger | ✅ | ✅ | — | — | — | 1 | none | immutable credit ledger | Low |
| patient_notes | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user/patient ownership | Low |
| patient_package_items | ✅ | ✅ | — | — | — | 1 | none | immutable package item snapshots | Low |
| patient_packages | ✅ | ✅ | — | — | — | 1 | none | lifecycle through idempotent RPCs | Low |
| patient_photo_sessions | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/patient; void semantics | Low |
| patient_photos | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/patient; original immutable | Low |
| patients | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user_id owner | Low |
| pix_installments | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| procedure_followup_plans | ✅ | ✅ | — | ✅ | — | 2 | none | generated canonical aftercare plan | Low |
| procedure_followup_tasks | ✅ | ✅ | — | ✅ | — | 2 | none | generated aftercare history | Low |
| procedure_items | ✅ | ✅ | ✅ | — | — | 2 | none | procedure/user; locked history | Low |
| procedure_payments | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | procedure/user + rollup trigger | Low |
| procedure_returns | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | canonical return source | Low |
| procedures | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | patient/appointment/user ownership | Low |
| professional_profiles | ✅ | ✅ | — | — | — | 1 | none | controlled RPC mutation | Low |
| relationship_preferences | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| service_aftercare_protocol_steps | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | protocol/user ownership | Low |
| service_aftercare_protocols | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | service/user ownership | Low |
| services | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| treatment_proposal_items | ✅ | ✅ | — | — | — | 1 | none | snapshot/version history | Low |
| treatment_proposal_versions | ✅ | ✅ | — | — | — | 1 | none | immutable issued history | Low |
| treatment_proposals | ✅ | ✅ | — | — | — | 1 | none | controlled lifecycle RPCs | Low |
| vouchers | ✅ | ✅ | — | — | — | 1 | none | idempotent lifecycle RPCs | Low |

## Grants hardening and reproducibility

Before v4, 12 public tables granted `TRUNCATE`, `TRIGGER` and `REFERENCES` to `authenticated`. RLS does not protect `TRUNCATE`, so this was a HIGH least-privilege finding. Migration `20260815143819_production_hardening_v4_acl_indexes` revoked those privileges. Migration `20260815163948_production_hardening_v4_grants_rebuild` makes the audited hosted grant matrix reconstructible in a clean database.

Production post-check:

- `anon`: 0 public-table privileges.
- `authenticated`: audited application CRUD/read privileges only; 0 `TRUNCATE`, 0 `REFERENCES`, 0 `TRIGGER`.
- `service_role`: full privileges on all 50 public base tables.
- `PUBLIC`, `anon` and `authenticated`: no `CREATE` on schema `public`.

A clean local Supabase rebuild now reproduces the application grants before E2E execution.

## Functions / RPC

- 37 authenticated `SECURITY DEFINER` RPCs remain callable intentionally.
- Audited definer functions use fixed `search_path`, tenant/auth validation and no dynamic `EXECUTE`/`format()` SQL pattern.
- Security Advisor warnings therefore remain visible by design and must be revisited whenever a function changes.
- Migration `20260815144004_production_hardening_v4_trigger_acl` revoked direct EXECUTE from `PUBLIC`, `anon` and `authenticated` for two trigger-only photo helpers; existing triggers remain the invocation path.

## Cross-tenant evidence

Production rollback-only probes with the second real Auth identity proved DB-level negatives. v4 then added an isolated two-user Playwright/Supabase test environment and proved the same boundaries without production writes.

User B is denied/isolated from User A across patients, appointments, Patient360 RPC, anamnesis versions, procedures, procedure items, payments, returns, aftercare plans/tasks, injectables, proposals, packages, credit ledger, Relationship and Global Search.

Storage API negative coverage is now complete in the isolated environment for `patient-photos`: B cannot list A's folder contents, download A's object, create A's signed URL, upload/overwrite A's path or delete A's object. A can still read the object after B's delete attempt. Clinical photo metadata/session rows are also tenant-isolated, the canonical original path is immutable, and registered clinical originals cannot be physically deleted through the normal authenticated policy.

## Concurrency / idempotency evidence

Parallel-retry tests cover canonical RPCs for:

- attendance / `create_procedure_v2` — one procedure, one item, one payment; returns/aftercare generated once;
- anamnesis finalization — same version returned, one immutable version;
- proposal create/issue/accept and package create/activate — same canonical entities/ledger;
- injectable map finalization — one finalized map/application/point snapshot.

## Storage

All clinical/commercial buckets are private. Policies use owner-prefixed paths and tenant checks. DB rows store canonical object paths, never permanent signed URLs. Photo UI uses short-lived signed URLs and thumbnails/previews rather than originals for grids.

## Advisor disposition

- No RLS-off public base table found.
- No anon public-table CRUD grant found.
- No new Security Advisor finding was introduced by v4 grants hardening.
- Remaining Security Advisor warnings: intentional authenticated SECURITY DEFINER RPCs + leaked-password protection disabled.
- No warning was "fixed" merely to reach zero.

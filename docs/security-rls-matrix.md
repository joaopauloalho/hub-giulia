# Hub Giulia 4.0 — Security / RLS Matrix

Audit date: 2026-08-15. Matrix is generated from production catalog state after v4 ACL hardening.

Legend: S/I/U/D = an RLS policy exists for SELECT/INSERT/UPDATE/DELETE. `—` means the operation is intentionally unavailable through direct table RLS and is normally performed by immutable history or an RPC. All rows below had RLS enabled. `anon CRUD` was false for every public base table.

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
| contract_templates | ✅ | ✅ | — | — | — | 1 | none | mutation through controlled RPCs | Low |
| contracts | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | user/patient + immutable finalized fields | Low |
| crm_activities | ✅ | ✅ | ✅ | — | — | 2 | none | append-oriented history | Low |
| crm_deal_interests | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | user/deal/service composite ownership | Low |
| crm_followups | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/deal ownership | Low |
| data_quality_issue_suppressions | ✅ | ✅ | ✅ | — | ✅ | 3 | none | user scoped, explicit suppression only | Low |
| deals | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user/contact/patient ownership | Low |
| google_calendar_connections | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped; direct grants further restricted | Low |
| google_calendar_tokens | ✅ | ✅ | — | — | ✅ | 2 | none | secret-bearing server-side data | Medium: privileged surface |
| injectable_application_points | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | map/application/user composite ownership | Low |
| injectable_applications | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | map/product/lot/user ownership | Low |
| injectable_maps | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | patient/procedure/user ownership; finalized guard | Low |
| injectable_product_lots | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | product/user ownership | Low |
| injectable_products | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | user scoped | Low |
| maquininha_configs | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user scoped | Low |
| oauth_states | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | short-lived user/provider state | Low |
| package_payments | ✅ | ✅ | — | — | — | 1 | none | immutable package history/RPC | Low |
| package_redemptions | ✅ | ✅ | — | — | — | 1 | none | immutable ledger/redemption history | Low |
| patient_credit_ledger | ✅ | ✅ | — | — | — | 1 | none | immutable credit ledger | Low |
| patient_notes | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user/patient ownership | Low |
| patient_package_items | ✅ | ✅ | — | — | — | 1 | none | immutable package item snapshots | Low |
| patient_packages | ✅ | ✅ | — | — | — | 1 | none | lifecycle through idempotent RPCs | Low |
| patient_photo_sessions | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/patient ownership; void semantics | Low |
| patient_photos | ✅ | ✅ | ✅ | ✅ | — | 3 | none | user/patient ownership; original immutable | Low |
| patients | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user_id owner | Low |
| pix_installments | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| procedure_followup_plans | ✅ | ✅ | — | ✅ | — | 2 | none | generated from canonical procedure | Low |
| procedure_followup_tasks | ✅ | ✅ | — | ✅ | — | 2 | none | generated aftercare history | Low |
| procedure_items | ✅ | ✅ | ✅ | — | — | 2 | none | procedure/user ownership; locked history | Low |
| procedure_payments | ✅ | ✅ | ✅ | ✅ | ✅ | 4 | none | procedure/user ownership + rollup trigger | Low |
| procedure_returns | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | canonical return source | Low |
| procedures | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | patient/appointment/user ownership | Low |
| professional_profiles | ✅ | ✅ | — | — | — | 1 | none | controlled RPC mutation | Low |
| relationship_preferences | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| service_aftercare_protocol_steps | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | protocol/user ownership | Low |
| service_aftercare_protocols | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | service/user ownership | Low |
| services | ✅ | ✅ | ✅ | ✅ | ✅ | 1 | none | user scoped | Low |
| treatment_proposal_items | ✅ | ✅ | — | — | — | 1 | none | snapshot/version history | Low |
| treatment_proposal_versions | ✅ | ✅ | — | — | — | 1 | none | immutable issued history | Low |
| treatment_proposals | ✅ | ✅ | — | — | — | 1 | none | lifecycle through controlled RPCs | Low |
| vouchers | ✅ | ✅ | — | — | — | 1 | none | lifecycle through idempotent RPCs | Low |

## Grants hardening

Before v4, 12 public tables granted `TRUNCATE`, `TRIGGER` and `REFERENCES` to `authenticated`. RLS does not protect `TRUNCATE`, so this was treated as a HIGH least-privilege finding. Migration `20260815143819_production_hardening_v4_acl_indexes` revoked those privileges across all public tables. Post-check: 0 public tables grant any of those three privileges to `authenticated`.

`PUBLIC`, `anon` and `authenticated` do not have `CREATE` on schema `public`.

## Functions / RPC

- 37 authenticated `SECURITY DEFINER` RPCs remain callable intentionally.
- Every audited definer function has a fixed `search_path`, references `auth.uid()`/tenant ownership and showed no dynamic `EXECUTE`/`format()` SQL pattern.
- Security Advisor therefore continues to warn by design. These warnings are not suppressed and must be revisited whenever a function changes.
- Two trigger-only photo validation helpers were callable by `anon` through default function privileges. Migration `20260815144004_production_hardening_v4_trigger_acl` revoked direct EXECUTE from `PUBLIC`, `anon` and `authenticated`; existing triggers remain the invocation path.

## Cross-tenant evidence

Using the second real Auth identity only as a transactional JWT claim (`SET LOCAL ROLE authenticated`, rollback; no fake patient persisted):

- SELECT patient/anamnesis/version/photo/session belonging to user A: 0 rows.
- UPDATE patient A from user B: 0 rows.
- DELETE patient A from user B: 0 rows.
- `get_patient_360_overview_v2(patient_A)`: rejected as `PATIENT_360_NOT_FOUND`.
- direct Google connection table access from user B: permission denied.
- Storage object listing for `patient-photos`, `contracts`, `proposals`: 0 objects visible to user B.

Not claimed: full Storage API signed-URL/upload/delete negative test, because no safe user-B JWT/test environment was available. This remains a test-environment gap, not a proven leakage.

## Storage

All clinical/commercial buckets are private. Policies use owner-prefixed paths and tenant checks. DB rows store canonical object paths, never permanent signed URLs. Photo UI signs thumbnails for 600 seconds and views for 300 seconds.

## Advisor disposition

- No RLS-off table found.
- No anon public table CRUD grant found.
- Remaining Security Advisor warnings: intentional authenticated SECURITY DEFINER RPCs + leaked-password protection disabled.
- No warning was "fixed" merely to reach zero.

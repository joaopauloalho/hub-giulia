# Hub Giulia 4.0 — Release Runbook

`main` is production. Never develop directly on `main`.

## Normal release

1. Start from current `main` and create `agent/<scope>`.
2. Apply database DDL only through a new migration; never edit an already-applied migration.
3. Keep feature work out of hardening releases.
4. Push branch; `agent/**` must not create automatic Vercel Previews.
5. Require CI gates: fresh `npm ci`, high-severity dependency audit, tests, typecheck, lint, build, and local Supabase migration rebuild.
6. Use at most one deliberate Preview when browser QA needs deployment behavior.
7. Open PR with security/integrity/recovery/performance/test evidence and known risks.
8. Do not merge with an unresolved BLOCKER.
9. Merge through GitHub; do not patch `main` manually.
10. Wait for Vercel Production to reach `READY` and verify deployment Git SHA equals merged `main` SHA.
11. Run production smoke read-only whenever possible: Login, Today, Agenda, Global Search, Patient360, Communication, Relationship, Modo Atendimento, Finance, Data Quality, Google status and PWA shell/update.
12. Recheck Vercel runtime errors, Supabase logs, Security Advisor, Performance Advisor and Data Quality.
13. Only after READY + smoke + no blocker, create `v4.0.0` (or the intended release tag) and GitHub Release.

## Merge blockers

Do not merge when any of the following is unresolved:

- RLS/cross-tenant leakage;
- public clinical/financial Storage;
- true secret/service_role exposure;
- unexplained clinical/financial corruption;
- unexplained migration drift that invalidates deployment/rebuild confidence;
- build/type/test gate failure;
- critical E2E failure;
- recovery/restore is claimed without evidence;
- another known BLOCKER in `docs/known-risks-v4.md`.

## Frontend rollback

1. Identify the last known-good production Vercel deployment and its Git SHA.
2. Confirm the incident is frontend-only before changing database state.
3. Promote/redeploy the known-good source/deployment through Vercel's supported production workflow.
4. Verify aliases point to the intended deployment.
5. Smoke the same critical routes and inspect runtime errors.
6. Fix the regression on a branch and release normally.

Do not repeatedly force redeploy the broken SHA.

## Database rollback strategy

There is no promise of automatic migration rollback. Production migrations should be backward-compatible when practical.

For a bad migration:

- stop further rollout;
- understand live data/schema effects;
- create a new reviewed forward-fix migration;
- never rewrite or delete an applied migration file/history row casually;
- never reset production;
- if historical clinical/financial data would need ambiguous correction, require human decision before modifying rows.

## Preview policy

`vercel.json` disables automatic deploys for `agent/**`. Use 0 previews by default and at most 1 deliberate Preview for final QA. Do not use empty/docs commits to trigger builds.

## Version identification

Until the application needs user-facing semantic versioning, Git SHA + release tag identify the stable release. Do not invent a parallel version framework. A `v4.0.0` tag is allowed only after all final release gates pass.

## Current platform governance gaps

At the v4 audit date, GitHub `main` was not branch-protected and Dependabot alerts were disabled. CI/process therefore provides more enforcement than repository settings. Treat direct pushes to `main` as prohibited operationally until platform protection is configured deliberately.

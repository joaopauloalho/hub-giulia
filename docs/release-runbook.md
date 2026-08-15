# Hub Giulia 4.0 — Release Runbook

`main` is production. Never develop directly on `main`.

## Normal release

1. Start from current `main` and work on `agent/<scope>`.
2. Apply DDL through new migrations only; never edit an already-applied migration.
3. Keep unrelated feature work out of hardening releases.
4. Require CI: fresh `npm ci`, dependency gates, tests, typecheck, lint, build, clean Supabase rebuild and isolated E2E.
5. Require documented security/integrity/recovery/performance evidence and known risks.
6. Do not merge with any unresolved BLOCKER.
7. Merge through GitHub; never patch `main` manually.
8. Wait for Vercel Production `READY` and verify deployment Git SHA matches merged `main`.
9. Run production smoke read-only whenever possible: Login, Today, Agenda, Global Search, Patient360, Communication, Relationship, Atendimento, Finance, Data Quality, Google status and PWA shell/update.
10. Recheck Vercel runtime errors, Supabase logs, Security Advisor, Performance Advisor, Data Quality and the recovery cron.
11. Only after READY + smoke + final revalidation, create the intended tag and GitHub Release.

## v4 recovery gate — satisfied

The release recovery gate is satisfied by a dedicated hosted recovery project plus daily verified snapshot/restore pipeline:

- production cron `hub-giulia-daily-recovery-backup` at 06:00 UTC / 03:00 America/Sao_Paulo;
- latest 14 verified snapshots retained privately;
- backup contains all 50 public tables, required Auth identity records and actual private Storage bytes;
- successful hosted restore from the stored archive: 0 table/object mismatches;
- recovery post-check: 50/50 RLS, 12/12 security-invoker views, private backup bucket, cross-tenant 0/0;
- measured warm snapshot+restore+verification: 6.564 seconds for the current dataset;
- target RPO <=24h while the scheduled job is healthy.

The recovery project remains a separate security surface and must not be used as ordinary development. It is same-provider recovery; an encrypted cross-provider archive remains optional defense in depth.

## Merge blockers

Do not merge when any of the following is unresolved:

- RLS/cross-tenant leakage;
- public clinical/financial Storage;
- true secret/service-role exposure;
- unexplained clinical/financial corruption;
- migration drift that invalidates clean reconstruction;
- build/type/test/E2E failure;
- recovery/restore claim without current evidence;
- another known BLOCKER in `docs/known-risks-v4.md`.

## Frontend rollback

Identify the last known-good Vercel Production deployment/SHA, confirm the incident is frontend-only, promote/redeploy the known-good version, verify aliases and smoke critical routes. Fix the regression on a branch and release normally. Do not repeatedly redeploy a broken SHA.

## Database rollback strategy

There is no promise of automatic migration rollback. Stop rollout, understand effects and create a reviewed forward-fix migration. Never rewrite/delete an applied migration/history row or reset production. Ambiguous clinical/financial data correction requires explicit human decision.

## Recovery release check

Before every material release:

- `cron.job` for `hub-giulia-daily-recovery-backup` is active;
- a recent verified recovery archive exists;
- `recovery-backups` remains private;
- production/recovery Edge logs show no unexplained backup failures;
- after material schema/Auth/Storage changes, an isolated restore drill has been repeated or explicitly scheduled before declaring a new recovery SLA.

## Version identification

Git SHA + release tag identify stable releases. `v4.0.0` is allowed only after final branch CI, merge, Vercel READY and post-deploy smoke/revalidation all pass.

## Platform governance gaps

At the v4 audit date, `main` was not branch-protected and Dependabot alerts were disabled. CI/process therefore provides more enforcement than repository settings. Treat direct pushes to `main` as prohibited until protection is configured deliberately.

# Hub Giulia 3.1 — Production rollout

This marker documents the production rollout retry for Hub Giulia 3.1 after PR #16 was merged successfully but the Vercel Git integration did not create a Production deployment for the merge commit.

- PR #16: merged
- Proposals migrations: already applied in production Supabase
- Final proposals Preview: READY
- Change in this commit: documentation only; no runtime, schema, financial, clinical, or patient data changes

The purpose of this commit is to retrigger the normal GitHub → Vercel pipeline while preserving deployment traceability through `main`.

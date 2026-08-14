-- Hub Giulia 2.3 — Injetáveis 2.0
-- Backward compatibility for the currently deployed create_procedure_v2.
-- Legacy callers omit lifecycle columns. Since legacy/default status is finalized,
-- finalized_at must also receive a default. V2 drafts explicitly pass NULL.

alter table public.injectable_maps
  alter column finalized_at set default now();

comment on column public.injectable_maps.finalized_at is
  'Timestamp when the map became immutable history. Legacy inserts default to now(); v2 drafts explicitly store NULL until finalization.';

-- Hub Giulia 2.3 — Injetáveis 2.0
-- Cover composite ownership FKs in their constraint column order.

create index if not exists injectable_product_lots_product_user_fk_idx
  on public.injectable_product_lots (product_id, user_id);

create index if not exists injectable_applications_map_user_fk_idx
  on public.injectable_applications (map_id, user_id);

create index if not exists injectable_applications_service_user_fk_idx
  on public.injectable_applications (service_id, user_id);

create index if not exists injectable_applications_item_user_fk_idx
  on public.injectable_applications (procedure_item_id, user_id)
  where procedure_item_id is not null;

create index if not exists injectable_applications_product_user_fk_idx
  on public.injectable_applications (product_id, user_id);

create index if not exists injectable_applications_lot_product_user_fk_idx
  on public.injectable_applications (lot_id, product_id, user_id)
  where lot_id is not null;

create index if not exists injectable_application_points_application_map_user_fk_idx
  on public.injectable_application_points (application_id, map_id, user_id);

create index if not exists injectable_application_points_map_user_fk_idx
  on public.injectable_application_points (map_id, user_id);

-- The label photo belongs naturally to the physical lot: one photo can document
-- the lot/validity during initial entry and remains available when the same
-- finalized record is reopened later.
alter table public.injectable_product_lots
  add column if not exists label_photo_path text;
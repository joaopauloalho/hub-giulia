# Materials / inventory v1

## Scope

Materials are universal consumables used by any attendance, not commercial catalog products and not an injectable-only feature. The MVP covers owner-scoped material registration, current unit cost, stock balance, minimum stock, stock entries, audited manual adjustments, attendance consumption, historical cost snapshots and compensating stock reversal when a procedure is deleted.

## Authority and atomicity

PostgreSQL is authoritative for stock and attendance material cost. The frontend sends only `material_id` and `quantity` in the attendance payload. It never sends an authoritative material unit cost, line total or post-consumption stock balance.

`create_procedure_v4` and `create_procedure_with_injectable_draft_v4` include canonicalized materials in their idempotency payload hash. Material consumption runs in the same PostgreSQL transaction as procedure creation. Material rows are locked in deterministic order, ownership/active status/positive quantity/available stock are validated, snapshots are created, the inventory ledger is written and stock is decremented before the transaction can commit.

A retry using the same idempotency key and same canonical payload returns the original attendance and does not consume stock twice. Reusing that key with a different material payload is rejected as an idempotency conflict.

## Data model

- `materials`: current owner-scoped material catalog and balance.
- `procedure_materials`: historical attendance consumption with name, unit and unit-cost snapshots.
- `inventory_movements`: immutable-style stock ledger for initial balance, entries, manual adjustments, procedure consumption and procedure reversal.

Current stock is intentionally not a freely editable frontend field. Stock changes are performed through audited operations/RPCs and guarded database context.

## Cost semantics

Historical service cost remains exactly as Hub 4.4 defines it:

`base_service_cost = sum(procedure_items.cost_snapshot * qty)`

Material cost is attendance-level because a consumable may be shared by multiple services in the same attendance:

`materials_cost = sum(procedure_materials.unit_cost_snapshot * quantity)`

The authoritative attendance total is:

`procedures.total_cost = base_service_cost + materials_cost`

The service financial intelligence remains service-attributed and continues to use only `procedure_items.cost_snapshot * qty`. Materials are not arbitrarily allocated across services in v1.

Changing a material's current unit cost affects only future consumptions. Existing `procedure_materials` snapshots are never recalculated. Existing procedures without material rows naturally have material cost zero; no historical backfill is invented.

## Double-counting migration note

After enabling separate materials, review the configured base costs of services that may already include disposable items such as gauze, syringes, gloves or cannulas. Otherwise those future attendances can double-count the same disposable cost.

Do **not** automatically rewrite `services.cost_per_unit`, do not rewrite historical procedure snapshots, and do not attempt to infer which historical service costs included consumables. This is an operational review for future service cost configuration; existing history remains unchanged.

## Reversal

Deleting/reversing a procedure produces compensating `procedure_reversal` ledger movements and returns the consumed quantities before the procedure row is removed. The ledger retains procedure/material snapshot identifiers so the audit trail survives cascades. Duplicate reversal is protected by ledger idempotency uniqueness.

## Security

The three material tables are owner-scoped and RLS-enabled. Cross-owner material use is rejected by composite ownership constraints and RPC/trigger validation. Anonymous access is not granted to the material mutation RPCs. Trigger helpers are not executable by application roles.

## Future work intentionally excluded

Suppliers, invoices, purchase orders, lots/expiry, barcode, storage locations, automatic kits and automatic service-to-material allocation are outside v1.

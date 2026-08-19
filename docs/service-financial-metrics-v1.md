# Service Financial Metrics v1

## Scope

Hub Giulia 4.4 adds managerial financial intelligence by service. The model is realization-based and owner-scoped. It does **not** calculate accounting profit, does not allocate fixed/indirect clinic expenses, and does not recommend clinical or pricing decisions.

Canonical timezone: `America/Sao_Paulo`.

Canonical period date: `procedures.performed_at`.

A procedure row represents a realized attendance. Procedures are physically removed when reversed/deleted; canceled appointments are rejected by the canonical attendance RPC before a procedure is created.

## Historical snapshots

For historical procedure items, never recalculate price or cost from current `services` values.

- Table price snapshot: `procedure_items.list_price` is a **unit** price snapshot.
- Quantity: `procedure_items.qty`.
- Procedure item price snapshot: `procedure_items.final_price` is the **total value for the item**, not a unit value.
- Explicit procedure-time discount: `procedure_items.discount` is a **total amount** and is expected to match `max(list_price * qty - final_price, 0)` within cent tolerance.
- Direct cost snapshot: `procedure_items.cost_snapshot` is a **unit** cost snapshot; total direct cost is `cost_snapshot * qty`, exactly once.
- Package face coverage: `procedure_items.coverage_value_snapshot`.
- Direct amount due: `procedure_items.amount_due_snapshot`.
- Package redemption value source: `patient_package_items.commercial_value_snapshot`, `quantity_granted`, and `package_redemptions.quantity`.
- Duration for new data: `procedure_items.duration_minutes_snapshot`, captured at item creation from the service configuration. Historical rows are not backfilled from current service duration.

## Package valuation v1

The report distinguishes the economic value of a realized service from cash receipt timing.

For a procedure item with no package coverage, realized value is `amount_due_snapshot` (equivalent to the item's historical final price when no coverage exists).

For a package-covered item:

1. Direct portion = `amount_due_snapshot`.
2. A sold package with a canonical item commercial snapshot is amortized by granted quantity:
   `commercial_value_snapshot / quantity_granted * redeemed_quantity`.
3. Only the originally granted quantity is valued. Credits added later by manual adjustments do not inherit a hidden price; excess adjusted redemptions are reported as unvalued.
4. `complimentary` package coverage has economic realized value `0` for the covered portion.
5. `voucher` coverage, or a package without a recorded sale/canonical commercial value, is not assigned a hidden value. The realization remains visible but reduces valuation/contribution coverage.
6. Package sale value is never added again to procedure value. This prevents double counting package sale + redemption.

Package sale fees are attributed using the same commercial allocation basis. A fee is amortized to the realized redemption share; the full package fee is never subtracted on every session. If a package fee cannot be attributed from canonical payment and commercial snapshots, fee/contribution coverage is reduced.

## Fee allocation v1

Procedure payment fees belong only to the direct amount due, not to the package-covered portion.

For each procedure:

- Canonical fee = `procedure_payments.fee_value`.
- A null fee is known zero only when the payment identity proves it (`amount == net_amount` within cent tolerance).
- Procedure fee is allocated among items proportionally to `procedure_items.amount_due_snapshot`.
- Allocation is performed in cents with deterministic residual distribution, so item allocations reconcile exactly to the procedure fee total.
- A procedure fee is never copied in full to every item.

Package payment fees are separate and are never included in procedure fee allocation.

## Cost knowledge

`0` and `unknown` are different states.

Hub 4.4 adds an explicit service cost-configuration flag and snapshots it into each new procedure item. A cost is usable in contribution only when the snapshot is marked known. A known zero is valid. Unknown cost is never silently converted into zero contribution expense.

Historical procedure rows are not backfilled from current service cost.

## Metrics

### Realizations

Count of canonical `procedure_items` in realized procedures, grouped by stable `service_id`. Canonical attendance rejects duplicate service items in one procedure.

Included: existing procedure items in the selected `performed_at` period.

Excluded: canceled appointments that never produced a procedure; deleted/reversed procedures that no longer exist.

### Unique patients

`count(distinct procedures.patient_id)` for the service and period.

This is not the ticket denominator.

### Table value

Numerator: `sum(list_price * qty)`.

Source of truth: procedure item historical snapshots.

### Realized value

Economic value attributed to services actually realized in the period.

For direct service value, use the historical item due amount. For package-covered value, use Package valuation v1 above.

Never add procedure payment amounts to realized value. Receipts are a different domain.

Where package valuation is unavailable, the calculable portion is shown with coverage rather than assuming zero.

### Discount granted

When realized value is fully valued for an item:

`max(table_value - realized_value, 0)`.

This preserves direct procedure discounts and also reflects a sold package's commercial discount when its canonical allocation is lower than the table snapshot.

The explicit `procedure_items.discount` remains an integrity check for the procedure-time snapshot. Inconsistencies are reported, not auto-fixed.

### Average ticket

`realized_value / valued_realizations`.

Patients are not the denominator.

### Direct cost registered

For items with known cost snapshot:

`cost_snapshot * qty`.

Unknown costs do not contribute zero. Cost coverage is the share of realizations with a known cost snapshot.

### Financial fees attributed

Sum of deterministic procedure fee allocations plus deterministic package fee allocations that are fully attributable.

Fee coverage is the share of realizations whose relevant fee sources are attributable.

### Direct contribution

For an item only when realized value, direct cost and relevant financial fees are all known:

`realized_value - direct_cost_registered - attributed_financial_fees`.

The aggregate shown is **contribuição direta calculável** when coverage is below 100%.

This metric is **not clinic profit** and must never be labeled `lucro` or `margem de lucro`.

### Direct contribution margin

For contribution-calculable items where the realized-value base is greater than zero:

`direct_contribution / realized_value_base_of_the_same_calculable_items`.

Label: `Margem de contribuição direta`.

### Agenda duration

For new procedure items, use `duration_minutes_snapshot` captured at realization time. Do not use the current service duration to rewrite historical items.

Existing historical items without a defensible snapshot stay without duration.

Duration is counted once per realized service item; it is not multiplied by service quantity.

### Direct contribution per hour

Only items with both calculable contribution and a positive duration snapshot participate:

`sum(direct_contribution) / (sum(duration_minutes_snapshot) / 60)`.

If coverage is insufficient, UI says `Sem duração suficiente` or shows the coverage; it never substitutes current service duration into history.

## Stable grouping and labels

Group by `procedure_items.service_id`, not by mutable service name. Prefer current service name for display when the service still exists; fall back to the historical item name snapshot. Archived services remain in history.

## Period boundaries

RPC inputs are inclusive local dates. They are converted to a half-open UTC/timestamptz interval using `America/Sao_Paulo`:

`[date_from 00:00 local, date_to + 1 day 00:00 local)`.

Ranges larger than one year are rejected by v1 read models.

## Coverage definitions

Coverage is count-based by realization so it stays auditable even when the missing monetary value itself is unknown.

- Valuation coverage = valued realizations / realizations.
- Cost coverage = realizations with known cost / realizations.
- Fee coverage = realizations with all relevant fees attributable / realizations.
- Contribution coverage = fully contribution-calculable realizations / realizations.
- Duration coverage = realizations with positive duration snapshot / realizations.

## Security and mutation policy

Read models are `SECURITY INVOKER`, owner-scoped by `auth.uid()`, and rely on RLS-protected source tables. `anon` has no execute access. The frontend uses the authenticated Supabase client only.

4.4 is read-heavy. It does not rewrite procedure prices, payment amounts, fee values, package credits, redemptions, or historical snapshots to make a report reconcile.

## Known limitations

- Real production finance tables are empty at the start of 4.4, so current production coverage is not statistically meaningful yet.
- Vouchers without a canonical reimbursed value are intentionally unvalued.
- Positive manual package credit adjustments do not inherit an implicit commercial value.
- Direct contribution excludes rent, payroll, pro-labore, general taxes, energy, internet, marketing, depreciation, accounting and other fixed/indirect expenses.

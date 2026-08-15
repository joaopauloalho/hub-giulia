# Hub Giulia 4.0 — Performance Baseline

Audit date: 2026-08-15. Baselines are intentionally small-sample measurements on current production data; they are evidence of current behavior, not capacity guarantees.

## Frontend build baseline

### 3.9 Production

- Main application JS: ~409.5 kB, ~125.9 kB gzip.
- `react-pdf` chunk: ~1.46 MB, ~489.7 kB gzip.

### v4 branch validation build

- Main application JS: ~411.65 kB, ~126.72 kB gzip.
- `react-pdf` chunk: ~1,457.90 kB, ~489.57 kB gzip.
- Vite build completed successfully after 2,744 modules in ~7.63 s in CI.

The small shell increase includes hardening/observability code and is not evidence of a material bundle regression. PDF code remains split out of the initial shell; v4 does not inline it or perform a major dependency rewrite merely to remove a size warning.

Clinical Photos already use thumbnails in grids, preview/original on demand and short-lived signed URLs. Original uploads are normalized once; thumbnails/previews are generated client-side before upload.

## Database baseline — before v4 FK hardening

Representative authenticated production queries with `EXPLAIN (ANALYZE, BUFFERS)`:

| Surface | Query/read model | Baseline execution |
|---|---|---:|
| Today / Dashboard | `get_operational_day_summary_v1(current_date)` | ~172 ms |
| Patient360 | `get_patient_360_overview_v2(patient_id)` | ~2.6 ms |
| Relationship | `list_relationship_opportunities_v1(..., limit 50)` | ~3.2 ms |

The Dashboard read model was the slowest measured query but was not producing a production runtime error or proven user-visible timeout. No speculative rewrite was made.

## v4 database hardening

The production Performance Advisor identified missing supporting indexes for package/credit/voucher foreign keys. Independent catalog detection found 20 foreign keys without a left-prefix index.

Migration `20260815143819_production_hardening_v4_acl_indexes` added those supporting indexes. Post-check: **0 public foreign keys without a supporting left-prefix index**.

After the migration the Advisor no longer reports missing-FK indexes. It reports `unused_index` INFO entries, including newly created indexes. On the current very small/young dataset this is expected and is not justification to drop ownership or FK support indexes.

## Post-hardening sample

A second authenticated production sample returned approximately:

| Surface | Post sample |
|---|---:|
| Today / Dashboard | ~185 ms |
| Patient360 | ~32 ms |
| Relationship | ~38 ms |

These values show significant cache/execution/sample variance and do **not** establish a regression caused by the v4 indexes, which are on package/credit/voucher relationships rather than these three read models. No micro-optimization was performed from this single sample.

## Query-shape controls already present

- Dashboard/operational RPCs are bounded instead of loading unlimited history.
- Relationship list accepts `limit`/`offset`.
- Patient photo sessions are paginated; legacy photo query is bounded.
- Photo signed URLs are batched (up to 50 paths per request) rather than signed one-by-one.
- Photo grids use thumbnail paths instead of originals.
- Heavy PDF code is a separate chunk.

## Interpretation limits

Current production contains only a small number of clinical rows and essentially no financial/package transaction history. A query that is fast today may still require re-baselining as data volume grows. Conversely, sequential scans on tiny tables are not automatically defects.

## Performance regression gate

Before changing an index/read model:

1. capture the route/request/query that is slow;
2. measure with production-like data or safe production `EXPLAIN (ANALYZE, BUFFERS)`;
3. apply the minimum compatible change;
4. rerun the same measurement;
5. verify tests, advisors and runtime errors;
6. do not remove an ownership/FK index solely because `idx_scan = 0` on a new/small table.

## Monthly baseline

Recheck:

- initial Vite bundle/chunk sizes;
- Today/Dashboard SQL timing;
- Patient360 SQL timing/request count;
- Agenda range queries;
- Communication/Relationship bounds;
- Finance/package queries once real data exists;
- photo thumbnail/original network behavior;
- Performance Advisor and newly unbounded queries.

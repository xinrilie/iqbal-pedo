# GCIMS v0.3.0 — Test Report

Date: 2026-11-15

## Automated checks

| Check | Result |
|---|---:|
| `npm run check` | PASS |
| `npm test` | 34 passed, 0 failed |
| Procurement rules: fixed-point purchase/UOM conversion | PASS |
| Procurement rules: partial/full rejection | PASS |
| Procurement rules: integer Rupiah PO totals | PASS |
| PO state transition tests | PASS |
| Maker-checker helper: distinct known maker and approver | PASS |
| PO/GR approval service invocation guards | PASS (static source check) |
| Migration 006 maker-checker/index guards | PASS (static source check) |
| Read-only preflight file contract | PASS (static source check) |
| Migration 006 preflight prerequisite checks | PASS (static source check) |
| GR state transition tests | PASS |
| Procurement route contract presence | PASS |
| Migration guard: complete idempotency hash + same-PO composite FKs | PASS |
| Existing Sesi 2/Sesi 3 regression suite | PASS |

## Scope of these checks

The procurement tests are unit/static-contract tests. They do not execute supplier/PO/GR SQL against PostgreSQL.

## Environment limitations

- `npm ci --offline` could not install packages in the build container because `zod@4.6.7` is not in the local npm cache. The current project dependencies were not modified; the source test suite uses Node's built-in test runner and completed successfully.
- The build container did not have a PostgreSQL client/server, so migration 005 and end-to-end Goods Receipt posting were not executed against a live PostgreSQL instance here.
- JavaScript syntax checks passed for new services/routes and the full existing check script.

## Required user-side verification

1. Back up `db_gcims_test`.
2. Run `db/preflight/005_procurement.sql`; proceed only if all `affected_rows` are zero. Then apply `db/migrations/0005_procurement_mvp.sql` once.
3. Run `db/preflight/006_maker_checker.sql`; review legacy approvals and proceed only if all `affected_rows` are zero. Then apply `db/migrations/0006_maker_checker_hardening.sql`.
4. Restart backend and verify `/health/ready`.
5. Re-login as admin (JWT TTL defaults to 15m).
6. Run the Procurement acceptance sequence in `reference/kontrak_api_sesi4_procurement.md`.
7. Check that accepted GR quantity creates positive `goods_receipt` ledger entries and increases `v_stock_on_hand` exactly once.
8. Test concurrent GR posting against the same PO and ensure cumulative received quantity cannot exceed ordered quantity.

Passing unit tests is not equivalent to live PostgreSQL integration or production approval. Current source/unit tests include maker-checker helper cases and static guards that both PO and GR approval paths invoke the helper; they do not prove PostgreSQL constraints were applied.

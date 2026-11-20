# GCIMS Backend v0.3.0 — Procurement MVP

## Highlights
- Added supplier CRUD (read/create/update/deactivate).
- Added supplier inventory catalog upsert/list with purchase UOM validation and default price/MOQ/lead time.
- Added Purchase Order draft creation, line snapshots, integer Rupiah totals, idempotency, submit/approve/send/cancel/close transitions.
- Added Goods Receipt draft creation with partial and rejected quantities, lot/expiry metadata, submit/approve/reject/post workflow.
- Goods Receipt posting creates/reuses inventory lots and posts positive `goods_receipt` stock ledger movements atomically.
- Added cumulative PO over-receive protection serialized by PO row lock.
- Added Procurement RBAC permissions and grants to existing ADMIN roles.
- Added database hardening migration `005_procurement_mvp.sql` for idempotency, receipt-to-PO composite foreign keys, lot snapshots, full-rejection support, and strict SHA-256 idempotency hash validation.
- Follow-up patch adds read-only preflight scripts for migration 005/006 and migration `006_maker_checker_hardening.sql` for database-level separation of duties and the goods-receipt lookup index.
- PO and GR approval services now reject self-approval and approval when the maker identity is unavailable.

## Database notes
- `db/seeds/seed_permissions.sql` and `db/seeds/seed_demo_pos.sql` are seed scripts, not migrations. See `db/README.md` for the canonical schema order.
- Run `db/preflight/005_procurement.sql` and require all counts to be zero before applying 005.
- Run `db/preflight/006_maker_checker.sql` and review legacy approvals before applying 006.
- Existing procurement tables are reused; no duplicate supplier/PO/GR tables are created.
- Do not reset the database or rerun migrations already applied.

## Tests
- `npm run check`: PASS.
- `npm test`: 34/34 PASS (unit and static-contract tests).
- PostgreSQL runtime migration and receiving integration were not run in this build environment; user must run preflights and apply outstanding migrations on an isolated `db_gcims_test` before acceptance testing.

## Not included
- Frontend Procurement screens.
- Supplier invoice / AP and supplier payment.
- Supplier returns.
- PO/GR document editing after draft creation.
- Frontend approval screens and exception handling for legacy documents remain outside this backend patch.
- PDF/WhatsApp document output.

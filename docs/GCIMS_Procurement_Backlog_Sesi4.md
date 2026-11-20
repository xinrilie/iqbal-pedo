# GCIMS Procurement Backlog — Sesi 4

## Implemented in v0.3.0
- [x] Supplier list/create/update/deactivate.
- [x] Supplier-item catalog list/upsert.
- [x] Purchase UOM conversion lookup from effective item UOM conversion.
- [x] PO create with immutable item/UOM/quantity/price snapshots.
- [x] PO idempotent create.
- [x] PO submit/approve/send/cancel/close state transitions.
- [x] Goods Receipt draft create with partial and rejected quantities.
- [x] GR submit/approve/reject/post transitions.
- [x] Track-lot/track-expiry metadata and lot create/reuse.
- [x] Atomic positive stock ledger posting on accepted GR quantity.
- [x] Cumulative over-receive check at post under PO row lock.
- [x] Audit log entries and procurement RBAC permissions.
- [x] Composite database constraints binding receipt item to the same PO header and PO line.

## Remaining before production
- [ ] Run `db/preflight/005_procurement.sql`, then apply and validate migration 005 on an isolated PostgreSQL test database.
- [ ] Run `db/preflight/006_maker_checker.sql`, then apply and validate migration 006.
- [ ] Integration test Supplier -> Supplier Catalog -> PO -> approval -> sent -> GR -> approval -> post.
- [ ] Concurrency test: two GR posts against same PO line cannot over-receive.
- [ ] Rollback test: deliberately fail during lot/ledger posting; no partial lot/ledger/GR status.
- [ ] Repeated GR post returns same document and creates no duplicate ledger row.
- [ ] Test full rejection (accepted base = 0) creates no ledger movement.
- [ ] Test track_lot/track_expiry validations and existing lot metadata mismatch.
- [ ] Test partial receiving across multiple GRs and status calculation.
- [ ] Test PO cancel blocked after receiving workflow begins.
- [ ] Add PO/GR draft editing or explicit discard/recreate workflow.
- [x] Enforce PO/GR maker-checker in application services and PostgreSQL constraints (`db/migrations/0006_maker_checker_hardening.sql`).
- [ ] Review any historical self-approved/unknown-maker documents before applying migration 006.
- [ ] Add supplier return and credit note workflow.
- [ ] Add supplier invoice / accounts payable and supplier payment reconciliation.
- [ ] Add frontend procurement screens.
- [ ] Add document PDF/print/WhatsApp output.
- [ ] Add audit report and procurement dashboard.

## Known constraint from runtime audit
`goods_receipt_items` originally rejected `quantity_accepted_base = 0`; migration 005 relaxes this because a fully rejected delivery still needs an auditable GR row, while no stock is posted for zero accepted quantity.


## Latest local build verification (2026-11-15)
- [x] `npm run check` PASS.
- [x] `npm test` 34/34 PASS, including maker-checker helper cases, approval-service source guards, migration/preflight source guards, non-null 64-character SHA-256 idempotency hashes, and composite receipt-to-same-PO foreign keys.
- [ ] Determine applied migration state; apply only pending migration(s) after their preflight on PostgreSQL test DB.
- [ ] Run live Supplier → PO → GR → stock ledger acceptance tests.

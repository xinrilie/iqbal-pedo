# GCIMS Backend — Follow-up Patch Report

**Date:** 15 November 2026  
**Baseline:** `GCIMS_Backend_Audited.zip`  
**Scope:** migration safety, Procurement approvals, and database access path.  
**Source changes:** applied to a working copy; the uploaded baseline archive was not modified.

## What changed

1. `db/README.md` now defines the canonical sequence and keeps schema migrations, seeds, preflights, development fixtures, and checks in separate folders.
2. `db/preflight/005_procurement.sql` performs read-only checks for receipt-line mapping, receipt-to-PO mismatch, duplicate active preferred suppliers, negative accepted quantities, and missing rejection reasons.
3. PO and Goods Receipt approval now call `assertMakerChecker`. Self-approval is rejected, and approval fails closed when maker identity is missing.
4. `db/preflight/006_maker_checker.sql` checks historical approvals and verifies that migration 005 columns exist.
5. `db/migrations/0006_maker_checker_hardening.sql` scopes 005 constraint guards to their target tables, adds database maker-checker constraints, and adds an index for receipt-line lookup by company and receipt.
6. README, handoff, backlog, and test documentation were updated to match the new sequence and limitations.

## Verification

| Check | Result |
|---|---:|
| `npm run check` | PASS |
| `npm test` | 34 passed, 0 failed |
| Maker-checker helper tests | PASS |
| PO/GR approval source guards | PASS (static) |
| Migration/preflight source guards | PASS (static) |
| PostgreSQL migration apply | NOT RUN — PostgreSQL tooling/runtime unavailable |
| PostgreSQL constraints, concurrency, rollback, EXPLAIN | NOT VERIFIED |

## Operator safety notes

- Do not replay schema Sesi 1, migration Sesi 2, 003, 004, 005, or 006 if already applied. Determine the database's actual migration state first.
- For a new empty database, follow `db/README.md` exactly.
- Preflight scripts are read-only. Every `affected_rows` value must be zero before proceeding. Investigate and resolve blockers explicitly; the scripts do not mutate or delete business records.
- If migration 005 is already applied, skip it and run only preflight 006 followed by migration 006 (after backup and zero blockers).
- Migration 006 can fail validation when historical documents were self-approved or lack maker identity. That is intentional fail-closed behavior; review those records before applying it.
- PostgreSQL 15+ is required. Do not point these commands at production.

## Still required before production

Apply the pending migrations on an isolated PostgreSQL database, test fresh install and upgrade, verify permissions, run multi-connection over-receive/reservation tests, force rollback during GR posting and payment, and review query plans on representative data. Passing Node tests does not prove those PostgreSQL behaviors.

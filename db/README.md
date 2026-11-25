# GCIMS database setup and migration order

## File layout

- `migrations/` contains the ordered schema changes (`0001`–`0012`). Apply each only once, in order.
- `seeds/` contains permission and optional demo-data inserts; these do not define schema.
- `preflight/` contains read-only checks that must pass before the matching migration.
- `dev/` contains test-only stock fixtures. Review their comments and target database before use.
- `checks/` contains read-only runtime inspection queries.
- The local PostgreSQL custom-format dump lives at `../backups/db_gcims_source.dump`. It is ignored by Git and must not be published.

## Canonical schema order for a new, empty database

Run from the project root, with `DATABASE_URL` pointing only to the intended local/test database:

1. `db/migrations/0001_schema_sesi1.sql` — baseline schema.
2. `db/migrations/0002_migration_sesi2.sql` — Sesi 2 migration.
3. `db/migrations/0003_hardening_v011.sql` — hardening migration.
4. `db/migrations/0004_inventory_engine_s3.sql` — Inventory Engine migration.
5. `db/seeds/seed_permissions.sql` — permission catalog seed (not a migration).
6. `db/preflight/005_procurement.sql` — read-only checks; all `affected_rows` must be zero before proceeding.
7. `db/migrations/0005_procurement_mvp.sql` — Procurement MVP migration.
8. `db/preflight/006_maker_checker.sql` — read-only historical approval checks; all `affected_rows` must be zero before proceeding.
9. `db/migrations/0006_maker_checker_hardening.sql` — maker-checker constraints and GR lookup index.
10. `db/migrations/0007_goods_receipt_posting_fix.sql` — narrowly permits posting to attach a resolved lot to an approved goods receipt line.
11. `db/migrations/0008_cashier_shifts.sql` — shift lifecycle, cash drawer activity log, and durable cashier transaction history.
12. `db/migrations/0009_admin_accounts_reports.sql` — cashier role, admin account-management permissions, and reporting permissions.
13. `db/migrations/0010_catalog_reference_alignment.sql` — reference-item metadata, test-price marker, and documented package-content conversion rules.
14. `db/migrations/0011_retail_products.sql` — supports inventory-linked retail SKUs alongside prepared café products.
15. `db/seeds/seed_demo_pos.sql` — optional minimal demo data seed; run only after `scripts/bootstrap-admin.js` has provisioned the demo company/outlet.
16. `db/seeds/seed_ready_operational_catalog.sql` — selected test catalog import, restricted to `db_gcims_test`. It imports 220 inventory masters, 55 menu variants, 401 converted recipe lines, 46 UOM conversions, and 8 supplier names. It removes only old menus with no sales-line references, archives 47 superseded test inventory SKUs without deleting their ledger, and retains menus with sales plus all transaction history. Menu prices are pseudorandom test values and visibly flagged; no opening stock or PO/GR transactions are imported. Supplier contact details are kept out of the tracked seed. The generator `scripts/generate_reference_catalog_seed.py` rebuilds this static seed from the two source workbooks when `openpyxl` is available.
17. `db/seeds/seed_handcrafted_bom.sql` — legacy import from the earlier handcrafted BOM workbook. Do not run it together with the selected READY catalog seed.

PostgreSQL 15+ is required. Make a backup before applying migrations to any database that contains data. Review every preflight row; do not proceed when a check reports `BLOCK` or a non-zero `affected_rows` value. Resolve data explicitly—never delete or rewrite business records automatically to make a migration pass.

## Coverage against the product design

| Design area | Main tables | Current coverage |
| --- | --- | --- |
| Menu, café recipe/BOM, and retail | `menu_categories`, `menus`, `menu_variants`, `recipes`, `recipe_versions`, `recipe_items`, `inventory_items` | Admin can inspect and create prepared products with BOMs or retail products linked to an inventory SKU. Both appear in one POS catalog; retail quantities are snapshotted as direct inventory consumption, while only prepared products create barista tickets. |
| Ingredient inventory and milk ledger | `inventory_items`, `inventory_lots`, `stock_ledger`, `stock_reservations`, `stock_reservation_lines` | Item/lot master, stock movements, and POS reservations exist. Opening balances must be entered as intentional inventory transactions; the demo seed does not fabricate stock. |
| Procurement | `suppliers`, `supplier_inventory_items`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items` | Core supplier, PO, and receipt records exist; operator flows remain limited as described in the implementation scope. |
| POS, payment, shift, and kitchen | `sales_orders`, `sales_order_items`, `payments`, `cashier_shifts`, `cash_drawer_events`, `kitchen_tickets`, `kitchen_ticket_items`, `audit_logs` | Order, payment, receipt/KDS, cashier shift closeout, and auditable cash drawer events exist. A physical cash drawer still needs device integration. |

The schema uses English `snake_case` identifiers as internal API/database names. Keep those stable; Indonesian display labels belong in the UI. The READY + Operational Master import aligns the prototype catalog and conversions; verified opening stock, purchase transactions, finished-good stock recipes, and sale prices are still separate inputs. Do not use the random test prices in production.

`db/dev/opening_balance_ready_catalog.sql` adds simulated stock to `db_gcims_test` only. It aggregates the active READY BOMs to cover 10 servings of every active menu, posts 43 append-only opening ledger rows, and is idempotent. It is test inventory, not a physical count; the script will not top up balances after orders consume stock.

## PowerShell example

```powershell
# Fresh database only. Do not run steps 1–4 against an existing database.
$Psql = 'psql' # If psql is not on PATH, set this to the full path of psql.exe.
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0001_schema_sesi1.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0002_migration_sesi2.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0003_hardening_v011.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0004_inventory_engine_s3.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\seeds\seed_permissions.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\preflight\005_procurement.sql
# Inspect preflight output; continue only when every affected_rows = 0.
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0005_procurement_mvp.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\preflight\006_maker_checker.sql
# Inspect preflight output; continue only when every affected_rows = 0.
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0006_maker_checker_hardening.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0007_goods_receipt_posting_fix.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0008_cashier_shifts.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0009_admin_accounts_reports.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0010_catalog_reference_alignment.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0011_retail_products.sql
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\migrations\0012_auth_session_revocation.sql
# Test database only; the seed itself checks that the target is db_gcims_test.
& $Psql "$env:DATABASE_URL" -X -v ON_ERROR_STOP=1 -f .\db\seeds\seed_ready_operational_catalog.sql
```

The preflight scripts open read-only transactions and end with `ROLLBACK`; they do not modify the database. They intentionally report findings instead of repairing them.

## Existing database

Do not run the baseline schema or replay `migration_sesi2`, `003`, or `004`. Confirm which migrations have already been applied, take a backup, and run only the outstanding migration(s) after checking the database state. There is no automatic migration runner/version ledger in this MVP; keep an operator-controlled record of applied files.

For the already initialized local `db_gcims_test`, migrations `0010_catalog_reference_alignment.sql` and `seed_ready_operational_catalog.sql` were applied on 16 November 2026; migration `0011_retail_products.sql` was applied on 20 November 2026. Migration `0012_auth_session_revocation.sql` is pending and must be applied once before running the updated app. The catalog import leaves the 109 existing sales orders intact. Do not replay applied migrations or seeds on that database.

Migration filenames are numbered and intentionally kept stable for installations that already applied them. Some early filenames use session-based names; do not rename them. Use the next available four-digit prefix for new schema changes and update this file in the same pull request. A migration-history table/automatic runner is not implemented yet, so each collaborator must record applied migrations for their own database.

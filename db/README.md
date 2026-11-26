# GCIMS database setup and migration order

## File layout

- `migrations/` contains append-only schema migrations `0001`–`0013`.
- `seeds/` contains permission and optional demo/reference data; these are not schema migrations.
- `preflight/` contains read-only checks the migration runner executes before selected migrations.
- `dev/` contains test-only stock fixtures. Review target guards before use.
- `checks/` contains read-only inspection queries.
- Local database backups belong under `../backups/`; that directory is ignored by Git. Never publish dumps, credentials, or customer data.

## New or existing database

Requirements: PostgreSQL 15+, Node.js 22+, and dependencies installed with `npm ci`.

1. Set `DATABASE_URL` in `.env` to the intended database. For operational use, create a database-specific account with only the required privileges and keep the secret out of source control.
2. For an existing database, create and verify a backup before applying schema changes. Follow [`../docs/operations-level2.md`](../docs/operations-level2.md).
3. Preview the migration plan:

   ```powershell
   npm.cmd run db:migrate -- --dry-run
   ```

4. Confirm the printed database name and pending migration list. Then apply interactively:

   ```powershell
   npm.cmd run db:migrate
   ```

The runner applies the ordered migrations, records them in `gcims.schema_migrations`, checks checksums and schema markers, uses an advisory lock, and runs the preflight checks for migrations 0005 and 0006. It refuses to continue when it finds an unknown schema state, history mismatch, failed preflight, or migration error. Do not bypass a refusal by manually editing the ledger or replaying SQL; investigate and reconcile the database first.

For automation, `--yes` skips the interactive prompt. Use it only after the deployment system has independently validated the database target and reviewed the dry-run plan.

## Bootstrap and optional test data

`npm.cmd run bootstrap:admin` is restricted in code to a database named exactly `db_gcims_test`. The default `admin` / `admin` credentials are for local testing only. Set `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of at least 12 characters before provisioning a shared demo database.

Optional seeds and fixtures are separate from migration history:

- `db/seeds/seed_demo_pos.sql` — minimal demo records; run only in an intended demo/test database after bootstrap.
- `db/seeds/seed_ready_operational_catalog.sql` — guarded to `db_gcims_test`; imports selected test catalog reference data, not verified production prices or opening stock.
- `db/seeds/seed_handcrafted_bom.sql` — legacy workbook import; do not combine with the READY catalog seed.
- `db/dev/opening_balance_ready_catalog.sql` — simulated test balances only; not a physical count.

Never load test/demo seeds into a production database. Verify each script's target guard and expected row counts before execution.

## Current system coverage

| Area | Main tables | Current state |
|---|---|---|
| Café recipes and retail | `menus`, `menu_variants`, `recipes`, `recipe_items`, `inventory_items` | Prepared café products and inventory-linked retail products share the POS catalog. |
| Inventory | `inventory_lots`, `stock_ledger`, `stock_reservations`, `stock_reservation_lines` | Movements and available stock are derived from ledger/reservations; opening stock must be an intentional verified transaction. |
| Procurement | `suppliers`, `purchase_orders`, `goods_receipts` and line/catalog tables | Supplier, PO and GR workflows exist; consult implementation scope for remaining limits. |
| POS, shifts and kitchen | `sales_orders`, `payments`, `cashier_shifts`, `cash_drawer_events`, `kitchen_tickets`, `audit_logs` | POS, cash test path, receipt, KDS API and shift audit data exist. Payment provider and physical cash drawer integration are not enabled. |

## Operational notes

- PostgreSQL backup/restore, release/UAT, incident response, and evidence templates are documented in [`../docs/operations-level2.md`](../docs/operations-level2.md). A procedure is not evidence until it has been executed and the result recorded.
- Keep migration SQL immutable once shared. Create the next four-digit migration and update this guide in the same change.
- The READY catalog has simulated test prices and no verified opening balances. Do not use those values for real operations.
- Database identifiers use English `snake_case`; user-facing labels belong in the UI.

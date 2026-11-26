# Migration policy

- Use the numbered SQL files in this directory to change schema. The current sequence is `0001`–`0013`.
- Applied migration files are immutable. Do not rename, reorder, squash, or edit them; add the next numbered file.
- Wrap each migration in an outer transaction (`BEGIN;` / `COMMIT;`). The runner records each migration in the same transaction as its schema change.
- Keep test/reference data outside migrations. Use `db/seeds/`, `db/preflight/`, or `db/dev/` for their documented purposes.
- Scope constraints and relationships by company/outlet as required by the owning schema.
- Update [`../README.md`](../README.md), root [`../../README.md`](../../README.md), and the operations guide when the migration sequence or operator steps change.

## Apply migrations

Use the migration runner as the canonical route for fresh or existing databases. Set `DATABASE_URL` to the intended target, inspect the target name printed by the runner, and start with a dry run:

```powershell
npm.cmd run db:migrate -- --dry-run
```

If the target and pending migration list are correct, run interactively:

```powershell
npm.cmd run db:migrate
```

The runner checks the PostgreSQL version, detects/baselines a recognized existing schema, validates migration names/order/checksums, takes an advisory lock, runs configured preflights, and applies each migration with a schema ledger entry transactionally. It stops on mismatches or failed checks. `--yes` is intended only for a controlled automation after target validation; do not use it to skip operator review.

Read [`../../docs/operations-level2.md`](../../docs/operations-level2.md) before production-like changes. Back up and verify the restore path first. Optional demo/catalog seeds are separate from schema migration and must follow their database-scope guards.

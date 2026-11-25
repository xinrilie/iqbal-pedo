# Migration policy

- Use the numbered SQL files in this directory to change schema.
- Existing migrations are immutable after they have been applied. Do not rename, reorder, squash, or edit them; make a new migration instead.
- Choose the next four-digit number and a short `snake_case` description, for example `0012_inventory_adjustments.sql`.
- Wrap each migration in a transaction when PostgreSQL supports transactional execution.
- Scope new tables, unique constraints, and foreign keys consistently by `company_id` and `outlet_id` where the owning schema requires it.
- Keep reference/test data out of schema migrations. Use `db/seeds/`, `db/preflight/`, or `db/dev/` according to their documented purpose.
- Update [`../README.md`](../README.md) and the project root [`../../README.md`](../../README.md) when the setup order or feature coverage changes.

This MVP has no automatic migration runner or schema version table. Keep a record of files applied to each local database. The canonical setup sequence and PowerShell commands are in [`../README.md`](../README.md).

The latest migration is `0012_auth_session_revocation.sql`. Apply it before starting the updated application; it adds the token version used to revoke existing sessions after password or account status changes.

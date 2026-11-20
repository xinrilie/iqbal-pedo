# Contributing

Thanks for helping with GCIMS. This repository is a local prototype, so keep changes easy to review and safe for the shared test database.

## First setup

1. Install Node.js 22+ and PostgreSQL 15+.
2. Follow [`db/README.md`](db/README.md) for a local test database. Do not run the fresh-database sequence against the existing shared database.
3. Run `npm ci`, copy `.env.example` to `.env`, then set `DATABASE_URL` and a private `JWT_SECRET`.
4. Run `npm run bootstrap:admin` only against `db_gcims_test` to create the local prototype Admin and outlet.
5. Start the app with `npm run dev`.

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by script execution policy.

## Working together

- Create a branch per task, for example `feature/retail-barcode` or `fix/stock-filter`.
- Keep pull requests focused. Explain the user-visible change, database impact, and how you checked it.
- Do not commit `.env`, database dumps/backups, real customer data, or private source workbooks.
- Keep existing migration files unchanged after they have been applied. Add the next numbered SQL file under `db/migrations/` and update `db/README.md` plus the root README when needed.
- Put seed data under `db/seeds/`, read-only migration checks under `db/preflight/`, and disposable test fixtures under `db/dev/`.
- Use parameterized SQL. Preserve company/outlet scoping and permission checks in every protected API route.
- Keep public-facing labels in Indonesian and database/API identifiers in English `snake_case`.

## Before opening a pull request

```bash
npm run check
npm test
```

If a change affects SQL behavior, also verify it on a disposable local PostgreSQL database. Record which migrations were applied; never “fix” a test by resetting or deleting the shared database.

## Suggested pull request notes

- What changed and why
- Screens or API routes affected
- Migration/seed steps, if any
- Checks run and results
- Follow-up work or known limitations

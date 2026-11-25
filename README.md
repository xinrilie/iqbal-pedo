# GCIMS POS & Inventory MVP

Prototype point of sale and inventory system for a café and convenience store. One cashier catalog supports prepared café products with recipes and retail products linked to inventory SKUs.

> **Prototype only.** Cash payment is test-only and is guarded to a local database named `db_gcims_test`. Do not deploy this setup for real payments or production use.

## Stack

- **Backend:** Node.js 22+, JavaScript ES modules, Fastify 5.
- **Frontend:** plain HTML, CSS, and browser JavaScript served by Fastify; no frontend framework or bundler.
- **Database:** PostgreSQL 15+ using `pg` and parameterized SQL; no ORM.
- **Validation and security:** Zod, bcrypt password hashes, HttpOnly JWT session cookies with CSRF protection, role/permission checks, Helmet, CORS allowlist, and rate limits.

Authentication is implemented. Login checks an active account and company/outlet membership, then sets a short-lived JWT in an `HttpOnly`, `SameSite=Strict` cookie (default 15 minutes; `Secure` in production). State-changing browser requests must include a CSRF token held in memory. Protected API routes verify account, membership, session version, and permissions such as `pos.order.create` or `admin.inventory.read`. Bearer-token authentication is disabled; old tokens stored by previous builds are rejected. The prototype bootstrap can create `admin` / `admin` only when connected to `db_gcims_test`; change that password before sharing the database and never use those credentials outside local testing.

The admin panel includes cashier/admin accounts, product and BOM management, inventory filters, stock ledger, stocktake approval/posting, supplier catalog, purchase orders, and goods receipt posting. Account password/status changes revoke existing JWT sessions. Procurement and stocktake approvals use maker-checker checks. The kitchen display is currently API-only; it does not yet have a dedicated staff screen.

## Quick start

Requirements: Node.js 22+, npm, and PostgreSQL. In PowerShell on Windows, use `npm.cmd` if the execution policy blocks `npm.ps1`.

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env: set DATABASE_URL and a private JWT_SECRET (at least 32 characters).
npm.cmd run check
npm.cmd run dev
```

Before starting the server for the first time, set up an empty local/test database by following [`db/README.md`](db/README.md). Then provision the prototype account and outlet with `npm.cmd run bootstrap:admin`. The bootstrap script refuses to run unless the active database is named exactly `db_gcims_test`.

Open `http://127.0.0.1:3000/`. Login sends Admin to `/admin` and Cashier to `/pos`. Use `npm.cmd test` to run the automated unit and source-contract tests.

## Project map

| Path | Contents |
| --- | --- |
| `src/` | Fastify app, authentication, API routes, and business services |
| `public/` | POS, Admin, login pages, styles, browser JavaScript, and local assets |
| `db/migrations/` | Ordered, append-only PostgreSQL schema migrations |
| `db/seeds/` | Permission and optional test/demo catalog data |
| `db/preflight/` | Read-only checks required before selected migrations |
| `db/dev/` | Explicitly test-only stock fixtures |
| `db/checks/` | Read-only database inspection queries |
| `scripts/` | Local admin bootstrap and reference-catalog seed generator |
| `tests/` | Unit and source-contract tests |
| `reference/` | API contracts, architecture, scope, and acceptance notes |
| `docs/` | Product, data-import, procurement, and historical audit documentation |
| `desain/` | UI design references |

## Database changes

Start with [`db/README.md`](db/README.md) for the canonical setup order and PowerShell commands. Never replay the baseline schema or an already applied migration on a database with data. Treat numbered migrations as immutable after sharing: make the next numbered migration for every schema change. Keep seeds, preflight checks, and test fixtures separate from migrations.

The current retail catalog support is migration `0011_retail_products.sql`. Migration `0012_auth_session_revocation.sql` adds session revocation after password or account status changes. Applying a migration changes the database schema; the app needs all numbered migrations before startup.

## Useful commands

```bash
npm run check       # JavaScript syntax checks
npm test            # unit and source-contract tests
npm run dev         # local development server with watch mode
npm start           # start the server
```

## Collaboration and safety

- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a branch or changing database files.
- `.env`, backups, dumps, local logs, and `node_modules` are excluded by `.gitignore`. Commit `.env.example`, never `.env`.
- Do not upload database dumps, credentials, customer data, or source workbooks. Rotate credentials if they were ever shared or committed.
- Payments are not connected to a production provider. The test cash-payment flag must stay off outside local tests.
- Current feature coverage and known limits are summarized in [`reference/implementation_scope.md`](reference/implementation_scope.md) and [`docs/GCIMS_Procurement_Backlog_Sesi4.md`](docs/GCIMS_Procurement_Backlog_Sesi4.md).
- Earlier audit and patch reports are retained under [`docs/archive/`](docs/archive/README.md).

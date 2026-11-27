# Graph Report - GCIMS_Backend_MVP  (2026-11-27)

## Corpus Check
- 88 files · ~94,924 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: .css 4, (none) 3, .example 1)

## Summary
- 567 nodes · 1594 edges · 18 communities (15 shown, 3 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 35 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6824915a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- public/admin.js
- notFound
- app.js
- public/pos.js
- badRequest
- package.json
- restore-db.js
- ci.yml
- migrate.js
- kds-service.js
- routes/admin.js
- generate_reference_catalog_seed.py
- ui.js
- updates
- cashier-stock.js
- login.js

## God Nodes (most connected - your core abstractions)
1. `notFound()` - 46 edges
2. `badRequest()` - 45 edges
3. `conflict()` - 37 edges
4. `withTransaction()` - 35 edges
5. `initialize()` - 30 edges
6. `escapeHtml()` - 28 edges
7. `unprocessable()` - 28 edges
8. `request()` - 21 edges
9. `procurementRoutes()` - 21 edges
10. `startApp()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `loadMigrations()` --calls--> `assertContiguousMigrations()`  [EXTRACTED]
  scripts/migrate.js → src/lib/migration-runner.js
- `loadMigrations()` --calls--> `migrationChecksum()`  [EXTRACTED]
  scripts/migrate.js → src/lib/migration-runner.js
- `loadMigrations()` --calls--> `parseMigrationFilename()`  [EXTRACTED]
  scripts/migrate.js → src/lib/migration-runner.js
- `inspectSchema()` --calls--> `inferAppliedVersion()`  [EXTRACTED]
  scripts/migrate.js → src/lib/migration-runner.js
- `runPreflight()` --calls--> `blockedPreflightRows()`  [EXTRACTED]
  scripts/migrate.js → src/lib/migration-runner.js

## Import Cycles
- None detected.

## Communities (18 total, 3 thin omitted)

### Community 0 - "public/admin.js"
Cohesion: 0.07
Nodes (75): addPurchaseOrderLine(), addRecipeLine(), adminMenus, adminPermissions, adminUsers, cashierOptions(), cashiers, downloadCsv() (+67 more)

### Community 1 - "notFound"
Cohesion: 0.10
Nodes (56): withTransaction(), conflict(), notFound(), notImplemented(), consumeOrderStock(), expireDueReservationsForOutlet(), getLotBuckets(), getNonLotBuckets() (+48 more)

### Community 2 - "app.js"
Cohesion: 0.08
Nodes (40): zod, buildApp(), loginWithPassword(), registerAuth(), config, EnvSchema, parsed, alertSecurityEvent() (+32 more)

### Community 3 - "public/pos.js"
Cohesion: 0.13
Nodes (57): addProduct(), artClass(), beginCheckout(), cancelShiftDraft(), cartSubtotal(), changeQuantity(), closePaymentDialog(), closeShiftDialog() (+49 more)

### Community 4 - "badRequest"
Cohesion: 0.11
Nodes (50): badRequest(), unprocessable(), makeDocumentNumber(), acceptedPurchaseQuantity(), assertMakerChecker(), computePurchaseOrderTotals(), decimalToUnits(), MAX_SAFE (+42 more)

### Community 5 - "package.json"
Cohesion: 0.06
Nodes (41): dependencies, bcryptjs@^2.4.3, dotenv@^16.4.7, fastify@^5.2.1, @fastify/cors@^10.0.2, @fastify/helmet@^13.2.0, @fastify/jwt@10.2.7, @fastify/rate-limit@^10.2.1 (+33 more)

### Community 6 - "restore-db.js"
Cohesion: 0.11
Nodes (16): getEncryptionKey(), MAGIC, main(), runPgDump(), parsePostgresConnection(), decryptStream(), getEncryptionKey(), MAGIC (+8 more)

### Community 7 - "ci.yml"
Cohesion: 0.07
Nodes (31): name, runs-on, steps, timeout-minutes, concurrency, cancel-in-progress, group, name (+23 more)

### Community 8 - "migrate.js"
Cohesion: 0.15
Nodes (22): applyMigration(), confirmPlan(), ensureHistoryTable(), inspectSchema(), loadMigrations(), LOCK_KEY, main(), MIGRATIONS_DIR (+14 more)

### Community 9 - "kds-service.js"
Cohesion: 0.18
Nodes (19): canonicalize(), decodeQueueCursor(), encodeQueueCursor(), requestHash(), deriveTicketStatus(), progressRank, allowedTransitions, getTicket() (+11 more)

### Community 10 - "routes/admin.js"
Cohesion: 0.16
Nodes (19): cashierShiftCsv(), csvNumber(), csvQuantity(), csvText(), salesReportCsv(), stockLedgerCsv(), adminRoutes(), CashierCreate (+11 more)

### Community 11 - "generate_reference_catalog_seed.py"
Cohesion: 0.16
Nodes (10): boolean(), build(), category_codes(), clean(), normalize_unit(), number(), rows_with_headers(), slug() (+2 more)

### Community 12 - "ui.js"
Cohesion: 0.13
Nodes (14): adminCss, adminHtml, adminJs, brandLogo, cashierStockCss, cashierStockHtml, cashierStockJs, loginCss (+6 more)

### Community 13 - "updates"
Cohesion: 0.18
Nodes (10): npm-minor-and-patch, update-types, interval, updates, directory, groups, open-pull-requests-limit, package-ecosystem (+2 more)

### Community 14 - "cashier-stock.js"
Cohesion: 0.36
Nodes (10): dateLabel(), escapeHtml(), fetchApi(), fmt(), initialize(), loadStock(), populateFilter(), qtyFormat (+2 more)

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `badRequest()` connect `badRequest` to `kds-service.js`, `app.js`, `routes/admin.js`, `notFound`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `initialize()` (e.g. with `closeShiftDialog()` and `confirmCashPayment()`) actually correct?**
  _`initialize()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `public/admin.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07245386192754613 - nodes in this community are weakly interconnected._
- **Why does `zod` connect `app.js` to `notFound`, `badRequest`, `package.json`, `kds-service.js`, `routes/admin.js`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Should `notFound` be split into smaller, more focused modules?**
  _Cohesion score 0.10384615384615385 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `package.json` to `migrate.js`, `app.js`, `restore-db.js`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08123904149620105 - nodes in this community are weakly interconnected._
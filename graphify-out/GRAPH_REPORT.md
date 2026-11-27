# Graph Report - GCIMS_Backend_MVP  (2026-11-27)

## Corpus Check
- 105 files · ~95,391 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 9 file(s) not represented in the graph (top: .css 4, (none) 3, .example 1)

## Summary
- 587 nodes · 1387 edges · 29 communities (22 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7365a774`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- notFound
- app.js
- kds-service.js
- pos/01-core.js
- badRequest
- package.json
- ui.js
- ci.yml
- migrate.js
- inventory-service.js
- routes/admin.js
- generate_reference_catalog_seed.py
- 06-reports.js
- updates
- cashier-stock.js
- login.js
- admin/01-core.js
- 05-procurement.js
- restore-db.js
- 02-dashboard-inventory.js
- 03-catalog.js
- 04-cart.js
- 04-stocktakes.js

## God Nodes (most connected - your core abstractions)
1. `notFound()` - 46 edges
2. `badRequest()` - 45 edges
3. `conflict()` - 37 edges
4. `withTransaction()` - 35 edges
5. `unprocessable()` - 28 edges
6. `procurementRoutes()` - 21 edges
7. `createGoodsReceipt()` - 16 edges
8. `createPurchaseOrder()` - 16 edges
9. `createCashPayment()` - 15 edges
10. `buildApp()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `buildApp()` --indirect_call--> `kdsRoutes()`  [INFERRED]
  src/app.js → src/routes/kds.js
- `buildApp()` --indirect_call--> `orderRoutes()`  [INFERRED]
  src/app.js → src/routes/orders.js
- `buildApp()` --indirect_call--> `paymentRoutes()`  [INFERRED]
  src/app.js → src/routes/payments.js
- `buildApp()` --indirect_call--> `adminRoutes()`  [INFERRED]
  src/app.js → src/routes/admin.js
- `buildApp()` --indirect_call--> `procurementRoutes()`  [INFERRED]
  src/app.js → src/routes/procurement.js

## Import Cycles
- None detected.

## Communities (29 total, 7 thin omitted)

### Community 0 - "notFound"
Cohesion: 0.14
Nodes (33): badRequest(), notImplemented(), canonicalize(), decodeQueueCursor(), encodeQueueCursor(), requestHash(), releaseOrderStock(), formatMilli() (+25 more)

### Community 1 - "app.js"
Cohesion: 0.06
Nodes (63): zod, adminKeys, hasAllAdminValues, hasAnyAdminValue, permissions, buildApp(), loginWithPassword(), registerAuth() (+55 more)

### Community 2 - "kds-service.js"
Cohesion: 0.29
Nodes (12): deriveTicketStatus(), progressRank, allowedTransitions, getTicket(), listTickets(), timestampColumn(), updateTicketItemStatus(), updateTicketStatus() (+4 more)

### Community 3 - "pos/01-core.js"
Cohesion: 0.08
Nodes (34): closeShiftDialog(), closeStockAlert(), escapeHtml(), hideLogin(), hideShiftDialog(), initializeApp(), loadScope(), money (+26 more)

### Community 4 - "badRequest"
Cohesion: 0.11
Nodes (51): conflict(), notFound(), unprocessable(), makeDocumentNumber(), acceptedPurchaseQuantity(), assertMakerChecker(), computePurchaseOrderTotals(), decimalToUnits() (+43 more)

### Community 5 - "package.json"
Cohesion: 0.06
Nodes (37): dependencies, bcryptjs@^2.4.3, dotenv@^16.4.7, fastify@^5.2.1, @fastify/cors@^10.0.2, @fastify/helmet@^13.2.0, @fastify/jwt@10.2.7, @fastify/rate-limit@^10.2.1 (+29 more)

### Community 6 - "ui.js"
Cohesion: 0.14
Nodes (13): adminCss, adminHtml, brandLogo, cashierStockCss, cashierStockHtml, cashierStockJs, loginCss, loginHtml (+5 more)

### Community 7 - "ci.yml"
Cohesion: 0.07
Nodes (31): name, runs-on, steps, timeout-minutes, concurrency, cancel-in-progress, group, name (+23 more)

### Community 8 - "migrate.js"
Cohesion: 0.15
Nodes (22): applyMigration(), confirmPlan(), ensureHistoryTable(), inspectSchema(), loadMigrations(), LOCK_KEY, main(), MIGRATIONS_DIR (+14 more)

### Community 9 - "inventory-service.js"
Cohesion: 0.32
Nodes (11): allocateStockBuckets(), decimalToMicros(), microsToDecimal(), consumeOrderStock(), expireDueReservationsForOutlet(), getLotBuckets(), getNonLotBuckets(), lockInventoryItems() (+3 more)

### Community 10 - "routes/admin.js"
Cohesion: 0.14
Nodes (21): isBcryptPasswordLengthValid(), toLoginCredentials(), cashierShiftCsv(), csvNumber(), csvQuantity(), csvText(), salesReportCsv(), stockLedgerCsv() (+13 more)

### Community 11 - "generate_reference_catalog_seed.py"
Cohesion: 0.12
Nodes (11): boolean(), build(), category_codes(), clean(), normalize_unit(), number(), rows_with_headers(), slug() (+3 more)

### Community 12 - "06-reports.js"
Cohesion: 0.11
Nodes (23): addRecipeLine(), loadMenus(), openMenuCreate(), openRecipeEditor(), renderMenuDetail(), renderMenuList(), syncProductTypeFields(), cashierOptions() (+15 more)

### Community 13 - "updates"
Cohesion: 0.18
Nodes (10): npm-minor-and-patch, update-types, interval, updates, directory, groups, open-pull-requests-limit, package-ecosystem (+2 more)

### Community 14 - "cashier-stock.js"
Cohesion: 0.36
Nodes (10): dateLabel(), escapeHtml(), fetchApi(), fmt(), initialize(), loadStock(), populateFilter(), qtyFormat (+2 more)

### Community 18 - "admin/01-core.js"
Cohesion: 0.08
Nodes (22): adminMenus, adminPermissions, adminUsers, cashiers, escapeHtml(), goodsReceipts, inventoryRows, ledgerQuery (+14 more)

### Community 21 - "05-procurement.js"
Cohesion: 0.24
Nodes (7): addPurchaseOrderLine(), fillSelect(), loadGoodsReceipts(), loadPurchaseOrders(), loadSupplierCatalog(), loadSuppliers(), procurementStatusLabels

### Community 22 - "restore-db.js"
Cohesion: 0.12
Nodes (13): getEncryptionKey(), MAGIC, main(), runPgDump(), parsePostgresConnection(), decryptStream(), getEncryptionKey(), MAGIC (+5 more)

### Community 23 - "02-dashboard-inventory.js"
Cohesion: 0.28
Nodes (4): inventoryDateLabel(), renderInventory(), login(), startApp()

### Community 24 - "03-catalog.js"
Cohesion: 0.36
Nodes (6): artClass(), getCategories(), imageMarkup(), renderCategories(), renderMenuGrid(), visibleProducts()

### Community 25 - "04-cart.js"
Cohesion: 0.47
Nodes (8): addProduct(), beginCheckout(), cartSubtotal(), ensureDraftOrder(), orderBody(), renderCart(), serializeCart(), setCartOpen()

### Community 28 - "04-stocktakes.js"
Cohesion: 0.53
Nodes (5): loadStocktakes(), openStocktake(), renderStocktakeDetail(), renderStocktakeList(), stocktakeStatusLabels

## Knowledge Gaps
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `badRequest()` connect `notFound` to `app.js`, `kds-service.js`, `routes/admin.js`, `badRequest`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `notFound` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Why does `zod` connect `app.js` to `notFound`, `kds-service.js`, `badRequest`, `package.json`, `routes/admin.js`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06435498089920658 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `package.json` to `migrate.js`, `app.js`, `restore-db.js`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Should `pos/01-core.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08478513356562137 - nodes in this community are weakly interconnected._
- **Should `badRequest` be split into smaller, more focused modules?**
  _Cohesion score 0.10839598997493734 - nodes in this community are weakly interconnected._
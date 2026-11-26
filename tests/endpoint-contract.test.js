import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('API routes in implementation match declared core paths', async () => {
  const root = resolve('src/routes');
  const [auth, pos, orders, payments, kds, procurement] = await Promise.all([
    readFile(resolve(root, 'auth.js'), 'utf8'),
    readFile(resolve(root, 'pos.js'), 'utf8'),
    readFile(resolve(root, 'orders.js'), 'utf8'),
    readFile(resolve(root, 'payments.js'), 'utf8'),
    readFile(resolve(root, 'kds.js'), 'utf8'),
    readFile(resolve(root, 'procurement.js'), 'utf8')
  ]);
  assert.ok(auth.includes('loginWithPassword(toLoginCredentials(parsed.data))'));
  assert.match(auth, /accessTokenClaims\(user, csrfToken\)/);
  assert.match(auth, /serializeSessionCookie\(token/);
  assert.match(auth, /app\.post\('\/auth\/logout'/);
  for (const needle of ['/outlets/:outletId/catalog']) assert.ok(pos.includes(needle));
  for (const needle of ['/outlets/:outletId/orders', '/orders/:orderId', '/orders/:orderId/items']) assert.ok(orders.includes(needle));
  for (const needle of ['/orders/:orderId/payments', '/payments/:paymentId', '/orders/:orderId/receipt', '/webhooks/payments/:providerCode']) assert.ok(payments.includes(needle));
  for (const needle of ['/kds/tickets', '/kds/tickets/:ticketId/status', '/kds/tickets/:ticketId/items/:ticketItemId/status']) assert.ok(kds.includes(needle));
  for (const needle of ['/procurement/inventory-items', '/procurement/suppliers', '/procurement/purchase-orders', '/procurement/purchase-orders/:poId/goods-receipts', '/procurement/goods-receipts/:receiptId', 'app.delete(', 'procurement.receipt.post']) assert.ok(procurement.includes(needle));
});

test('admin stocktake and procurement views are routed and permission guarded', async () => {
  const [ui, stocktake, procurement, html, js, migration] = await Promise.all([
    readFile(resolve('src/routes/ui.js'), 'utf8'),
    readFile(resolve('src/routes/stocktakes.js'), 'utf8'),
    readFile(resolve('src/routes/procurement.js'), 'utf8'),
    readFile(resolve('public/admin.html'), 'utf8'),
    readFile(resolve('public/admin.js'), 'utf8'),
    readFile(resolve('db/migrations/0012_auth_session_revocation.sql'), 'utf8')
  ]);
  for (const path of ['/admin/suppliers', '/admin/purchase-orders', '/admin/goods-receipts']) assert.ok(ui.includes(path));
  for (const permission of ['admin.inventory.read', 'admin.inventory.update']) assert.ok(stocktake.includes(permission));
  for (const permission of ['procurement.supplier.read', 'procurement.catalog.write', 'procurement.po.approve', 'procurement.receipt.post']) assert.ok(procurement.includes(permission));
  for (const page of ['suppliers-page', 'purchase-orders-page', 'goods-receipts-page']) assert.ok(html.includes(page));
  for (const behavior of ['idempotency-key', 'data-po-action', 'data-gr-action']) assert.ok(js.includes(behavior));
  assert.match(migration, /auth_token_version INTEGER NOT NULL DEFAULT 0/);
});

test('admin ledger export is permission guarded and matches current ledger filters', async () => {
  const [admin, html, js] = await Promise.all([
    readFile(resolve('src/routes/admin.js'), 'utf8'),
    readFile(resolve('public/admin.html'), 'utf8'),
    readFile(resolve('public/admin.js'), 'utf8')
  ]);
  assert.match(admin, /app\.get\('\/admin\/inventory\/ledger\/export'.*admin\.inventory\.read/s);
  assert.match(admin, /LIMIT 10001/);
  assert.match(admin, /stockLedgerCsv\(result\.rows\)/);
  assert.match(html, /id="ledger-export"/);
  assert.match(js, /admin\/inventory\/ledger\/export/);
  assert.match(js, /ledgerQuery/);
});

test('admin browser script selectors resolve to page or dialog elements', async () => {
  const [html, js] = await Promise.all([
    readFile(resolve('public/admin.html'), 'utf8'),
    readFile(resolve('public/admin.js'), 'utf8')
  ]);
  const ids = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((match) => match[1]));
  const selectors = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]));
  const missing = [...selectors].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});

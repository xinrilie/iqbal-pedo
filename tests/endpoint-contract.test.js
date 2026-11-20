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
  for (const needle of ['/outlets/:outletId/catalog']) assert.ok(pos.includes(needle));
  for (const needle of ['/outlets/:outletId/orders', '/orders/:orderId', '/orders/:orderId/items']) assert.ok(orders.includes(needle));
  for (const needle of ['/orders/:orderId/payments', '/payments/:paymentId', '/orders/:orderId/receipt', '/webhooks/payments/:providerCode']) assert.ok(payments.includes(needle));
  for (const needle of ['/kds/tickets', '/kds/tickets/:ticketId/status', '/kds/tickets/:ticketId/items/:ticketItemId/status']) assert.ok(kds.includes(needle));
  for (const needle of ['/procurement/suppliers', '/procurement/purchase-orders', '/procurement/purchase-orders/:poId/goods-receipts', '/procurement/goods-receipts/:receiptId', 'procurement.receipt.post']) assert.ok(procurement.includes(needle));
});

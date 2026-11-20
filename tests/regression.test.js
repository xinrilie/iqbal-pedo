import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requestHash, encodeQueueCursor, decodeQueueCursor } from '../src/lib/ids.js';
import { quantityToMilli } from '../src/lib/money.js';
import { paymentRequestFingerprint, isReceiptPaid } from '../src/lib/payment-rules.js';
import { deriveTicketStatus } from '../src/lib/kds-rules.js';

const companyId = '123e4567-e89b-42d3-a456-426614174000';
const outletId = '123e4567-e89b-42d3-a456-426614174001';
const orderA = '5a9c0000-0000-4000-8000-000000000401';
const orderB = '5a9c0000-0000-4000-8000-000000000402';
const paymentBody = { method: 'cash', amount: 38000, cash_received_amount: 50000 };

test('payment idempotency fingerprint includes company, outlet, order and request body', () => {
  const base = { companyId, outletId, orderId: orderA, body: paymentBody };
  assert.equal(paymentRequestFingerprint(base), paymentRequestFingerprint({ ...base, body: { ...paymentBody } }));
  assert.notEqual(paymentRequestFingerprint(base), paymentRequestFingerprint({ ...base, orderId: orderB }));
  assert.notEqual(paymentRequestFingerprint(base), paymentRequestFingerprint({ ...base, outletId: '123e4567-e89b-42d3-a456-426614174002' }));
  assert.notEqual(paymentRequestFingerprint(base), paymentRequestFingerprint({ ...base, body: { ...paymentBody, amount: 40000 } }));
});

test('receipt is available only for fully paid confirmed/completed orders', () => {
  assert.equal(isReceiptPaid({ orderStatus: 'confirmed', grandTotalAmount: 38000, successfulPaymentAmounts: ['38000'] }), true);
  assert.equal(isReceiptPaid({ orderStatus: 'completed', grandTotalAmount: 38000, successfulPaymentAmounts: ['20000', '18000'] }), true);
  assert.equal(isReceiptPaid({ orderStatus: 'draft', grandTotalAmount: 38000, successfulPaymentAmounts: ['38000'] }), false);
  assert.equal(isReceiptPaid({ orderStatus: 'confirmed', grandTotalAmount: 38000, successfulPaymentAmounts: ['20000'] }), false);
  assert.equal(isReceiptPaid({ orderStatus: 'confirmed', grandTotalAmount: 0, successfulPaymentAmounts: ['1'] }), false);
});

test('NUMERIC(12,3) quantity upper bound is enforced', () => {
  assert.equal(quantityToMilli('999999999.999'), 999999999999n);
  assert.throws(() => quantityToMilli('1000000000'));
  assert.throws(() => quantityToMilli('1000000000.000'));
});

test('KDS queue cursor preserves FIFO tuple and rejects malformed data', () => {
  const cursor = encodeQueueCursor({
    priority: 12,
    queuedAt: '2026-11-15T10:11:12.000Z',
    id: orderA
  });
  assert.deepEqual(decodeQueueCursor(cursor), {
    priority: 12,
    queuedAt: '2026-11-15T10:11:12.000Z',
    id: orderA
  });
  assert.equal(decodeQueueCursor('invalid'), null);
  assert.equal(decodeQueueCursor('x'.repeat(513)), null);
});

test('KDS ticket status does not regress when item cancellation changes aggregate counts', () => {
  assert.equal(deriveTicketStatus('in_preparation', {
    activeCount: 1, servedCount: 0, readyCount: 0, preparingCount: 0
  }), 'in_preparation');
  assert.equal(deriveTicketStatus('ready', {
    activeCount: 2, servedCount: 0, readyCount: 1, preparingCount: 0
  }), 'ready');
  assert.equal(deriveTicketStatus('in_preparation', {
    activeCount: 0, servedCount: 0, readyCount: 0, preparingCount: 0
  }), 'cancelled');
});

test('security and catalog regression guards are present in service source', async () => {
  const root = resolve('src');
  const [auth, pos, order, payment, kds] = await Promise.all([
    readFile(resolve(root, 'auth.js'), 'utf8'),
    readFile(resolve(root, 'routes/pos.js'), 'utf8'),
    readFile(resolve(root, 'lib/order-service.js'), 'utf8'),
    readFile(resolve(root, 'lib/payment-service.js'), 'utf8'),
    readFile(resolve(root, 'lib/kds-service.js'), 'utf8')
  ]);
  assert.equal((auth.match(/gcims\.companies c ON c\.id = cm\.company_id AND c\.is_active = TRUE/g) ?? []).length, 2);
  assert.match(pos, /requirePermission\('admin\.menu\.read'\)/);
  assert.match(order, /RECIPE_REQUIRED/);
  assert.match(payment, /paymentRequestFingerprint\(\{ companyId, outletId, orderId, body \}\)/);
  assert.match(payment, /p\.status = 'succeeded'/);
  assert.match(kds, /ORDER BY priority, queued_at, id/);
  assert.doesNotMatch(kds, /for \(const row of pageRows\) tickets\.push\(await getTicket/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedPurchaseQuantity,
  assertMakerChecker,
  computePurchaseOrderTotals,
  decimalToUnits,
  nextGoodsReceiptStatus,
  nextPurchaseOrderStatus,
  quantityBaseFromFactor,
  unitCostBaseAmount
} from '../src/lib/procurement-rules.js';

test('purchase quantity conversion uses integer arithmetic and rounds to six base decimals', () => {
  assert.equal(quantityBaseFromFactor('2.5', '1000.00000000'), '2500.000000');
  assert.equal(quantityBaseFromFactor('0.000001', '0.50000000'), '0.000001');
  assert.equal(decimalToUnits('10.000000', 6), 10_000_000n);
  assert.throws(() => quantityBaseFromFactor('1', '0'), /lebih besar dari nol/);
  assert.throws(() => quantityBaseFromFactor('1.0000001', '1.00000000'), /maksimal 6/);
});

test('goods receipt supports partial acceptance and fully rejected deliveries without negative quantities', () => {
  assert.equal(acceptedPurchaseQuantity('10.000000', '2.500000'), '7.500000');
  assert.equal(acceptedPurchaseQuantity('4', '4'), '0.000000');
  assert.throws(() => acceptedPurchaseQuantity('2', '3'), /tidak boleh melebihi/);
  assert.throws(() => acceptedPurchaseQuantity('2', '-1'), /desimal positif/);
});

test('purchase order totals use integer rupiah, line discounts and safe rounding', () => {
  const result = computePurchaseOrderTotals([
    { quantity: '1.5', unit_price_purchase_uom: 10000, discount_amount: 100 },
    { quantity: '0.000001', unit_price_purchase_uom: 500000, discount_amount: 0 }
  ], { taxAmount: 1000, shippingAmount: 500 });
  assert.deepEqual({
    subtotal: result.subtotal_amount,
    discount: result.discount_amount,
    tax: result.tax_amount,
    shipping: result.shipping_amount,
    total: result.total_amount
  }, { subtotal: 15001, discount: 100, tax: 1000, shipping: 500, total: 16401 });
  assert.equal(result.lines[0].line_total_amount, 14900);
  assert.equal(unitCostBaseAmount(45000, '1000.00000000'), 45);
  assert.throws(() => computePurchaseOrderTotals([{ quantity: '1', unit_price_purchase_uom: 100, discount_amount: 101 }]), /Diskon baris/);
});

test('purchase order workflow accepts only declared transitions', () => {
  assert.equal(nextPurchaseOrderStatus('draft', 'submit'), 'pending_approval');
  assert.equal(nextPurchaseOrderStatus('pending_approval', 'approve'), 'approved');
  assert.equal(nextPurchaseOrderStatus('approved', 'send'), 'sent');
  assert.equal(nextPurchaseOrderStatus('fully_received', 'close'), 'closed');
  assert.throws(() => nextPurchaseOrderStatus('draft', 'send'), /tidak dapat melakukan aksi/);
});

test('goods receipt workflow requires approval before posting', () => {
  assert.equal(nextGoodsReceiptStatus('draft', 'submit'), 'submitted');
  assert.equal(nextGoodsReceiptStatus('submitted', 'approve'), 'approved');
  assert.equal(nextGoodsReceiptStatus('approved', 'post'), 'posted');
  assert.throws(() => nextGoodsReceiptStatus('submitted', 'post'), /tidak dapat diposting/);
  assert.equal(nextGoodsReceiptStatus('submitted', 'reject'), 'rejected');
});


test('procurement migration enforces complete idempotency hashes and binds receipt lines to the same PO', async () => {
  const { readFile } = await import('node:fs/promises');
  const migration = await readFile(new URL('../db/migrations/0005_procurement_mvp.sql', import.meta.url), 'utf8');
  assert.match(migration, /idempotency_request_hash IS NOT NULL AND idempotency_request_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /FOREIGN KEY \(company_id, goods_receipt_id, outlet_id, purchase_order_id\)/);
  assert.match(migration, /FOREIGN KEY \(company_id, purchase_order_id, purchase_order_item_id, inventory_item_id\)/);
  assert.match(migration, /CHECK \(quantity_accepted_base >= 0\)/);
});


test('maker-checker requires a known maker and a different approver', () => {
  const maker = 'A0B1C2D3-E4F5-4678-9012-3456789ABCDE';
  const otherUser = 'b0b1c2d3-e4f5-4678-9012-3456789abcde';
  assert.doesNotThrow(() => assertMakerChecker(maker, otherUser, 'Purchase order'));
  assert.throws(
    () => assertMakerChecker(maker, maker.toLowerCase(), 'Purchase order'),
    (error) => error.code === 'FORBIDDEN' && /pembuatnya sendiri/.test(error.message)
  );
  assert.throws(
    () => assertMakerChecker(null, otherUser, 'Goods receipt'),
    (error) => error.code === 'MAKER_IDENTITY_REQUIRED'
  );
  assert.throws(
    () => assertMakerChecker(maker, null, 'Goods receipt'),
    (error) => error.code === 'MAKER_IDENTITY_REQUIRED'
  );
});

test('PO and goods receipt approval services invoke maker-checker validation', async () => {
  const { readFile } = await import('node:fs/promises');
  const service = await readFile(new URL('../src/lib/procurement-service.js', import.meta.url), 'utf8');
  assert.match(service, /action === 'approve'\) assertMakerChecker\(po\.created_by, userId, 'Purchase order'\)/);
  assert.match(service, /action==='approve'\) assertMakerChecker\(gr\.received_by, userId, 'Goods receipt'\)/);
});

test('migration 006 adds database-level maker-checker and receipt header lookup index', async () => {
  const { readFile } = await import('node:fs/promises');
  const migration = await readFile(new URL('../db/migrations/0006_maker_checker_hardening.sql', import.meta.url), 'utf8');
  assert.match(migration, /conrelid = 'gcims\.purchase_orders'::regclass/);
  assert.match(migration, /conrelid = 'gcims\.goods_receipts'::regclass/);
  assert.match(migration, /approved_by IS DISTINCT FROM created_by/);
  assert.match(migration, /approved_by IS DISTINCT FROM received_by/);
  assert.match(migration, /company_id, goods_receipt_id, id/);
});

test('migration 005 preflight is read-only and covers the known data blockers', async () => {
  const { readFile } = await import('node:fs/promises');
  const preflight = await readFile(new URL('../db/preflight/005_procurement.sql', import.meta.url), 'utf8');
  assert.match(preflight, /READ ONLY/i);
  assert.match(preflight, /receipt_line_po_mismatch/);
  assert.match(preflight, /duplicate_preferred_supplier_item/);
  assert.match(preflight, /receipt_line_unresolvable/);
});

test('migration 006 preflight is read-only and verifies migration 005 prerequisites', async () => {
  const { readFile } = await import('node:fs/promises');
  const preflight = await readFile(new URL('../db/preflight/006_maker_checker.sql', import.meta.url), 'utf8');
  assert.match(preflight, /READ ONLY/i);
  assert.match(preflight, /idempotency_request_hash/);
  assert.match(preflight, /goods_receipt_items\.purchase_order_id/);
  assert.match(preflight, /po_approved_without_distinct_maker/);
  assert.match(preflight, /gr_approved_without_distinct_receiver/);
});

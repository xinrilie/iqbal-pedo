import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = async (path) => readFile(resolve(path), 'utf8');

test('Sesi 3 migration persists scoped reservations and their lot allocations', async () => {
  const migration = await source('db/migrations/0004_inventory_engine_s3.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gcims\.stock_reservations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gcims\.stock_reservation_lines/);
  assert.match(migration, /FOREIGN KEY \(company_id, outlet_id, order_id\)/);
  assert.match(migration, /FOREIGN KEY \(company_id, inventory_item_id, stock_location_id, lot_id\)/);
  assert.match(migration, /WHERE status = 'reserved'/);
  assert.match(migration, /CREATE OR REPLACE VIEW gcims\.v_stock_available/);
  assert.match(migration, /sr\.expires_at > now\(\)/);
});

test('reservation service serializes item access and counts other live reservations', async () => {
  const inventory = await source('src/lib/inventory-service.js');
  assert.match(inventory, /ORDER BY id\s+FOR UPDATE/);
  assert.match(inventory, /sr\.expires_at > now\(\)/);
  assert.match(inventory, /FOR UPDATE SKIP LOCKED/);
  assert.match(inventory, /FOR UPDATE OF l/);
  assert.match(inventory, /ORDER BY\s+CASE WHEN \$5::boolean THEN \(l\.expiry_date IS NULL\)/);
  assert.match(inventory, /INSUFFICIENT_STOCK/);
  assert.match(inventory, /NEGATIVE_STOCK_POLICY_CONFLICT/);
  assert.match(inventory, /trackExpiry/);
  assert.match(inventory, /l\.expiry_date >= \(now\(\) AT TIME ZONE outlet\.timezone_name\)::date/);
  assert.match(inventory, /STOCK_RESERVATION_NO_LONGER_BACKED/);
  assert.match(inventory, /jsonb_build_object\('order_id',\$5::uuid,'reservation_status','reserved'\)/, 'audit log order_id parameter must be explicitly typed as UUID');
  assert.match(inventory, /export async function releaseOrderStock/);
  assert.match(inventory, /movement_type, quantity_delta_base/);
  assert.match(inventory, /'sale_consumption'/);
  assert.match(inventory, /ON CONFLICT \(idempotency_key\) DO NOTHING/);
  assert.doesNotMatch(inventory, /parseFloat\(|Number\([^)]*quantity/);
});

test('cash payment reserves, consumes stock, and confirms order in the same transaction', async () => {
  const payment = await source('src/lib/payment-service.js');
  const reserveAt = payment.indexOf('await reserveOrderStock(client');
  const paymentInsertAt = payment.indexOf('INSERT INTO gcims.payments');
  const consumeAt = payment.indexOf('await consumeOrderStock(client');
  const confirmAt = payment.indexOf("SET status = 'confirmed'");
  const ticketAt = payment.indexOf('INSERT INTO gcims.kitchen_tickets');
  assert.ok(reserveAt >= 0 && paymentInsertAt > reserveAt);
  assert.ok(consumeAt > paymentInsertAt);
  assert.ok(confirmAt > consumeAt);
  assert.ok(ticketAt > confirmAt);
  assert.match(payment, /PAYMENT_RUNTIME_VALIDATION_REQUIRED/);
  assert.match(payment, /database\.rows\[0\]\?\.name !== 'db_gcims_test'/);
});


test('JSONB metadata parameters have explicit PostgreSQL types', async () => {
  const [inventory, payment, kds, order] = await Promise.all([
    source('src/lib/inventory-service.js'),
    source('src/lib/payment-service.js'),
    source('src/lib/kds-service.js'),
    source('src/lib/order-service.js')
  ]);
  assert.match(inventory, /jsonb_build_object\('order_id',\$5::uuid,'reservation_status','reserved'\)/);
  assert.match(inventory, /jsonb_build_object\('order_id',\$5::uuid,'ledger_line_count',\$6::integer\)/);
  assert.match(inventory, /jsonb_build_object\('order_id',\$6::uuid,'reservation_status','released'\)/);
  assert.match(payment, /jsonb_build_object\('order_id',\$5::uuid\)/);
  assert.match(payment, /jsonb_build_object\('order_id',\$3::uuid,'payment_id',\$5::uuid,'ticket_id',\$6::uuid\)/);
  assert.match(payment, /jsonb_build_object\('order_id',\$3::uuid,'reservation_id',\$5::uuid,'ledger_line_count',\$6::integer\)/);
  assert.match(payment, /jsonb_build_object\('amount',\$5::bigint,'method','cash'\)/);
  assert.match(kds, /jsonb_build_object\('updated_item_count',\$8::integer\)/);
  assert.equal((kds.match(/jsonb_build_object\('status',\$6::text\),jsonb_build_object\('status',\$7::text\)/g) ?? []).length, 2);
  assert.match(kds, /jsonb_build_object\('source_item_id',\$8::uuid\)/);
  assert.match(order, /jsonb_build_object\('version_no',\$5::integer\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateStockBuckets, decimalToMicros, microsToDecimal } from '../src/lib/inventory-rules.js';

test('inventory quantity math preserves six decimal places without floating point', () => {
  assert.equal(decimalToMicros('1'), 1_000_000n);
  assert.equal(decimalToMicros('0.000001'), 1n);
  assert.equal(decimalToMicros('12.345678'), 12_345_678n);
  assert.equal(decimalToMicros('-0.125'), -125_000n);
  assert.equal(microsToDecimal(12_345_678n), '12.345678');
  assert.equal(microsToDecimal(-125_000n), '-0.125000');
  assert.throws(() => decimalToMicros('1.0000001'), /Invalid NUMERIC/);
  assert.throws(() => decimalToMicros('1e-6'), /Invalid NUMERIC/);
});

test('stock allocation follows caller FEFO order and subtracts live reservations', () => {
  const result = allocateStockBuckets('7.500000', [
    { lot_id: 'lot-expiring-first', on_hand_qty_base: '5.000000', reserved_qty_base: '1.000000' },
    { lot_id: 'lot-expiring-second', on_hand_qty_base: '6.000000', reserved_qty_base: '0.500000' }
  ]);
  assert.equal(result.fulfilled, true);
  assert.deepEqual(result.allocations, [
    { lotId: 'lot-expiring-first', quantityBase: '4.000000' },
    { lotId: 'lot-expiring-second', quantityBase: '3.500000' }
  ]);
  assert.equal(result.unallocatedQuantity, '0.000000');
});

test('stock allocation reports exact shortage rather than allowing negative stock', () => {
  const result = allocateStockBuckets('2.000001', [
    { lot_id: null, on_hand_qty_base: '2.000000', reserved_qty_base: '0' }
  ]);
  assert.equal(result.fulfilled, false);
  assert.deepEqual(result.allocations, [{ lotId: null, quantityBase: '2.000000' }]);
  assert.equal(result.unallocatedQuantity, '0.000001');
});

test('negative on-hand stock cannot be allocated', () => {
  const result = allocateStockBuckets('1.000000', [
    { lot_id: null, on_hand_qty_base: '-2.000000', reserved_qty_base: '0.000000' }
  ]);
  assert.equal(result.fulfilled, false);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.unallocatedQuantity, '1.000000');
});

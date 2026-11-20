import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, requestHash } from '../src/lib/ids.js';
import { formatMilli, lineGrossAmount, quantityToMilli, taxAmount } from '../src/lib/money.js';

const uuid = '5a9c0000-0000-4000-8000-000000000401';

test('quantity parser preserves three decimal places', () => {
  assert.equal(quantityToMilli('2'), 2000n);
  assert.equal(quantityToMilli('0.125'), 125n);
  assert.equal(formatMilli(quantityToMilli('12.34')), '12.340');
});

test('quantity parser rejects zero, negative and excess precision', () => {
  assert.throws(() => quantityToMilli('0'));
  assert.throws(() => quantityToMilli('-1'));
  assert.throws(() => quantityToMilli('1.0001'));
});

test('Rupiah line total uses integer arithmetic and half-up rounding', () => {
  assert.equal(lineGrossAmount(38000, '2'), 76000);
  assert.equal(lineGrossAmount(100, '1.005'), 101);
});

test('tax amount uses decimal integer arithmetic and rounds to a whole Rupiah', () => {
  assert.equal(taxAmount(76000, 0.1), 7600);
  assert.equal(taxAmount(101, 0.5), 51);
  assert.equal(taxAmount(1000000000000000, 0.1), 100000000000000);
  assert.throws(() => taxAmount(1000, 1.1));
  assert.throws(() => taxAmount(Number.MAX_SAFE_INTEGER + 1, 0.1));
});

test('request hash is stable across object key order', () => {
  assert.equal(requestHash({ a: 1, b: { x: 2, y: 3 } }), requestHash({ b: { y: 3, x: 2 }, a: 1 }));
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
});

test('UUID cursor encoding round trips and rejects invalid cursor', () => {
  assert.equal(decodeCursor(encodeCursor(uuid)), uuid);
  assert.equal(decodeCursor('not-a-cursor'), null);
});

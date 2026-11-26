import test from 'node:test';
import assert from 'node:assert/strict';
import { stockLedgerCsv } from '../src/lib/csv.js';

test('stock ledger CSV keeps decimal quantities and escapes spreadsheet formulas', () => {
  const csv = stockLedgerCsv([{
    occurred_at: new Date('2026-11-25T00:00:00.000Z'),
    sku: '=HYPERLINK("https://example.com")',
    item_name: 'Kopi, Arabika',
    movement_type: 'sale_consumption',
    quantity_delta_base: '-1.250000',
    base_uom_code: 'g',
    stock_location_name: 'Gudang "Utama"',
    lot_code: null,
    expiry_date: null,
    source_type: 'sales_order',
    source_id: '00000000-0000-0000-0000-000000000001',
    reason: '+cmd',
    actor_name: 'Kasir'
  }]);

  assert.ok(csv.startsWith('\uFEFF"Waktu (UTC)"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""https://example.com"")"`));
  assert.ok(csv.includes(',"-1,25","g",'));
  assert.ok(csv.includes('"Gudang ""Utama"""'));
  assert.ok(csv.includes(`"'+cmd"`));
  assert.ok(csv.endsWith('\r\n'));
});

test('empty stock ledger export still includes a UTF-8 BOM and headers', () => {
  const csv = stockLedgerCsv([]);
  assert.ok(csv.startsWith('\uFEFF"Waktu (UTC)"'));
  assert.equal(csv.split('\r\n').length, 2);
});

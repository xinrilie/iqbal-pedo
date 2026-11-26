function csvText(value) {
  const text = String(value ?? '');
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvNumber(value) {
  const text = String(value ?? '');
  return /^-?\d+(?:\.\d+)?$/.test(text) ? text : csvText(text);
}

function csvQuantity(value) {
  const text = String(value ?? '');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return csvText(text);
  const [whole, fraction = ''] = text.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return csvText(normalizedFraction ? `${whole},${normalizedFraction}` : whole);
}

export function stockLedgerCsv(rows) {
  const header = [
    'Waktu (UTC)', 'SKU', 'Nama item', 'Tipe pergerakan', 'Jumlah', 'Saldo setelah', 'Satuan dasar',
    'Lokasi stok', 'Kode lot', 'Tanggal kedaluwarsa', 'Tipe sumber', 'ID sumber',
    'Alasan', 'Dicatat oleh'
  ];
  const lines = [header.map(csvText).join(',')];
  for (const row of rows) {
    lines.push([
      csvText(row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at),
      csvText(row.sku), csvText(row.item_name), csvText(row.movement_type),
      csvQuantity(row.quantity_delta_base), csvQuantity(row.balance_after_base), csvText(row.base_uom_code),
      csvText(row.stock_location_name), csvText(row.lot_code), csvText(row.expiry_date),
      csvText(row.source_type), csvText(row.source_id), csvText(row.reason), csvText(row.actor_name)
    ].join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function salesReportCsv(rows) {
  const header = [
    'Waktu UTC', 'No bayar', 'No order', 'Kasir', 'Metode', 'Tipe', 'Meja', 'Qty', 'Item',
    'Bayar (Rp)', 'Tunai (Rp)', 'Kembali (Rp)', 'Status'
  ];
  const lines = [header.map(csvText).join(',')];
  for (const row of rows) {
    lines.push([
      csvText(row.confirmed_at instanceof Date ? row.confirmed_at.toISOString() : row.confirmed_at),
      csvText(row.payment_number), csvText(row.order_number), csvText(row.cashier_name),
      csvText(row.method), csvText(row.order_type), csvText(row.table_label),
      csvQuantity(row.item_quantity), csvText(String(row.item_summary ?? '').replace(/\r?\n/g, ' | ')),
      csvNumber(row.amount), csvNumber(row.cash_received_amount), csvNumber(row.cash_change_amount),
      csvText(row.order_status)
    ].join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function cashierShiftCsv(rows) {
  const header = [
    'Kasir', 'Status', 'Dibuka (UTC)', 'Ditutup (UTC)', 'Kas awal (Rp)',
    'Kas masuk (Rp)', 'Kas keluar (Rp)', 'Penjualan tunai (Rp)',
    'Kas seharusnya (Rp)', 'Kas dihitung (Rp)', 'Selisih (Rp)', 'Catatan tutup'
  ];
  const lines = [header.map(csvText).join(',')];
  for (const row of rows) {
    lines.push([
      csvText(row.cashier_name), csvText(row.status),
      csvText(row.opened_at instanceof Date ? row.opened_at.toISOString() : row.opened_at),
      csvText(row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at),
      csvNumber(row.opening_cash_amount), csvNumber(row.cash_in_amount), csvNumber(row.cash_out_amount),
      csvNumber(row.cash_sales_amount), csvNumber(row.expected_cash_amount),
      csvNumber(row.closing_cash_amount), csvNumber(row.variance_amount), csvText(row.closing_note)
    ].join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

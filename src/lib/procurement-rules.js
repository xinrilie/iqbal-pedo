import { badRequest, conflict, forbidden, unprocessable } from './errors.js';

const QTY_SCALE = 1_000_000n;
const FACTOR_SCALE = 100_000_000n;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function decimalToUnits(value, scale = 6, { allowZero = false } = {}) {
  const text = String(value);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text);
  if (!match) throw badRequest('Kuantitas harus berupa desimal positif tanpa notasi eksponen.');
  const fraction = match[2] ?? '';
  if (fraction.length > scale) throw badRequest(`Kuantitas maksimal ${scale} angka desimal.`);
  const units = BigInt(match[1]) * (10n ** BigInt(scale)) + BigInt((fraction + '0'.repeat(scale)).slice(0, scale) || '0');
  if (units > 999_999_999_999_999_999n) throw badRequest('Kuantitas melebihi batas NUMERIC(18,6/8).');
  if (allowZero ? units < 0n : units <= 0n) throw badRequest(allowZero ? 'Kuantitas tidak boleh negatif.' : 'Kuantitas harus lebih besar dari nol.');
  return units;
}

export function unitsToDecimal(units, scale = 6) {
  const value = BigInt(units);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const base = 10n ** BigInt(scale);
  return `${sign}${abs / base}.${String(abs % base).padStart(scale, '0')}`;
}

export function quantityBaseFromFactor(quantity, factor) {
  const qtyUnits = decimalToUnits(quantity, 6);
  const factorUnits = decimalToUnits(factor, 8);
  const roundedMicros = (qtyUnits * factorUnits + FACTOR_SCALE / 2n) / FACTOR_SCALE;
  if (roundedMicros > 999_999_999_999_999_999n) throw unprocessable('BASE_QUANTITY_OVERFLOW', 'Hasil konversi melebihi batas NUMERIC(18,6).');
  if (roundedMicros <= 0n) throw unprocessable('INVALID_BASE_QUANTITY', 'Hasil konversi kuantitas ke satuan dasar harus lebih besar dari nol.');
  return unitsToDecimal(roundedMicros, 6);
}

export function unitCostBaseAmount(unitPricePurchaseUom, factor) {
  const price = parsePositiveInteger(unitPricePurchaseUom, 'Harga satuan tidak valid.', true);
  const factorUnits = decimalToUnits(factor, 8);
  const rounded = (BigInt(price) * FACTOR_SCALE + factorUnits / 2n) / factorUnits;
  if (rounded > MAX_SAFE) throw badRequest('Biaya per satuan dasar melebihi batas integer aman.');
  return Number(rounded);
}

export function parsePositiveInteger(value, message = 'Nilai harus berupa integer non-negatif.', allowZero = false) {
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) throw badRequest(message);
  const parsed = BigInt(text);
  if ((allowZero ? parsed < 0n : parsed <= 0n) || parsed > MAX_SAFE) throw badRequest(message);
  return Number(parsed);
}

export function computePurchaseOrderTotals(lines, { taxAmount = 0, shippingAmount = 0 } = {}) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw badRequest('Purchase order harus memiliki 1 sampai 100 baris item.');
  }
  let subtotal = 0n;
  let discount = 0n;
  const computedLines = lines.map((line) => {
    const qtyUnits = decimalToUnits(line.quantity, 6);
    const unitPrice = BigInt(parsePositiveInteger(line.unit_price_purchase_uom, 'Harga satuan wajib berupa integer Rupiah.', true));
    const lineGross = (qtyUnits * unitPrice + QTY_SCALE / 2n) / QTY_SCALE;
    const lineDiscount = BigInt(parsePositiveInteger(line.discount_amount ?? 0, 'Diskon baris tidak valid.', true));
    if (lineDiscount > lineGross) throw unprocessable('PO_LINE_DISCOUNT_EXCEEDS_GROSS', 'Diskon baris tidak boleh melebihi nilai bruto baris.');
    const lineTotal = lineGross - lineDiscount;
    subtotal += lineGross;
    discount += lineDiscount;
    return { ...line, line_gross_amount: safeAmount(lineGross), discount_amount: safeAmount(lineDiscount), line_total_amount: safeAmount(lineTotal) };
  });
  const tax = BigInt(parsePositiveInteger(taxAmount, 'Pajak PO tidak valid.', true));
  const shipping = BigInt(parsePositiveInteger(shippingAmount, 'Biaya pengiriman tidak valid.', true));
  if (discount > subtotal) throw unprocessable('PO_DISCOUNT_EXCEEDS_SUBTOTAL', 'Total diskon PO tidak boleh melebihi subtotal.');
  const total = subtotal - discount + tax + shipping;
  return {
    subtotal_amount: safeAmount(subtotal),
    discount_amount: safeAmount(discount),
    tax_amount: safeAmount(tax),
    shipping_amount: safeAmount(shipping),
    total_amount: safeAmount(total),
    lines: computedLines
  };
}

function safeAmount(value) {
  if (value < 0n || value > MAX_SAFE) throw badRequest('Nilai PO melebihi batas integer Rupiah yang aman.');
  return Number(value);
}

const PO_TRANSITIONS = Object.freeze({
  submit: { from: ['draft'], to: 'pending_approval' },
  approve: { from: ['pending_approval'], to: 'approved' },
  send: { from: ['approved'], to: 'sent' },
  cancel: { from: ['draft', 'pending_approval', 'approved', 'sent'], to: 'cancelled' },
  close: { from: ['fully_received'], to: 'closed' }
});

const RECEIPT_TRANSITIONS = Object.freeze({
  submit: { from: ['draft'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved' },
  reject: { from: ['submitted'], to: 'rejected' }
});

/** Enforce maker-checker approval for procurement documents.
 * Missing maker identity is rejected so legacy records are not silently
 * approved without a verifiable separation of duties. UUID comparison is
 * case-insensitive because PostgreSQL UUID text is canonicalized.
 */
export function assertMakerChecker(makerId, approverId, documentLabel = 'Dokumen') {
  if (typeof makerId !== 'string' || !makerId.trim() ||
      typeof approverId !== 'string' || !approverId.trim()) {
    throw conflict(
      'MAKER_IDENTITY_REQUIRED',
      `${documentLabel}: identitas pembuat dan penyetuju harus tersedia sebelum approval.`
    );
  }

  if (makerId.trim().toLowerCase() === approverId.trim().toLowerCase()) {
    throw forbidden(`${documentLabel} tidak boleh disetujui oleh pembuatnya sendiri.`);
  }
}

export function nextPurchaseOrderStatus(currentStatus, action) {
  const transition = PO_TRANSITIONS[action];
  if (!transition) throw badRequest('Aksi purchase order tidak dikenal.');
  if (!transition.from.includes(currentStatus)) {
    throw conflict('INVALID_PO_TRANSITION', `Purchase order berstatus '${currentStatus}' tidak dapat melakukan aksi '${action}'.`);
  }
  return transition.to;
}

export function nextGoodsReceiptStatus(currentStatus, action) {
  if (action === 'post') {
    if (currentStatus !== 'approved') throw conflict('INVALID_RECEIPT_TRANSITION', `Goods receipt berstatus '${currentStatus}' tidak dapat diposting.`);
    return 'posted';
  }
  const transition = RECEIPT_TRANSITIONS[action];
  if (!transition) throw badRequest('Aksi goods receipt tidak dikenal.');
  if (!transition.from.includes(currentStatus)) {
    throw conflict('INVALID_RECEIPT_TRANSITION', `Goods receipt berstatus '${currentStatus}' tidak dapat melakukan aksi '${action}'.`);
  }
  return transition.to;
}

export function acceptedPurchaseQuantity(received, rejected) {
  const receivedUnits = decimalToUnits(received, 6);
  const rejectedUnits = decimalToUnits(rejected ?? '0.000000', 6, { allowZero: true });
  if (rejectedUnits > receivedUnits) throw unprocessable('REJECTED_QTY_EXCEEDS_RECEIVED', 'Kuantitas ditolak tidak boleh melebihi kuantitas yang diterima.');
  return unitsToDecimal(receivedUnits - rejectedUnits, 6);
}

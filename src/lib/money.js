import { badRequest } from './errors.js';

// Quantity is stored as NUMERIC(12,3). Parse without binary floating point.
export function quantityToMilli(value) {
  const text = String(value);
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(text)) {
    throw badRequest('Kuantitas harus desimal positif dengan maksimal 3 angka pecahan.');
  }
  const [whole, fraction = ''] = text.split('.');
  const milli = BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  if (milli <= 0n || milli > 999_999_999_999n) throw badRequest('Kuantitas di luar batas.');
  return milli;
}

export function formatMilli(milli) {
  const whole = milli / 1000n;
  const fraction = String(milli % 1000n).padStart(3, '0');
  return `${whole}.${fraction}`;
}

export function lineGrossAmount(unitPrice, quantity) {
  const price = BigInt(unitPrice);
  const milli = quantityToMilli(quantity);
  const rounded = (price * milli + 500n) / 1000n; // half-up to whole IDR
  return safeInteger(rounded, 'Nilai baris terlalu besar.');
}

export function taxAmount(netAmount, taxRate) {
  if (!Number.isSafeInteger(netAmount) || netAmount < 0) {
    throw badRequest('Dasar pengenaan pajak harus berupa integer Rupiah yang aman.');
  }
  const text = String(taxRate);
  const match = /^(0|1)(?:\.(\d+))?$/.exec(text);
  if (!match) throw badRequest('Tarif pajak harus berada pada rentang 0 sampai 1.');
  const fraction = match[2] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1]) * denominator + BigInt(fraction || '0');
  if (numerator > denominator) throw badRequest('Tarif pajak harus berada pada rentang 0 sampai 1.');
  const rounded = (BigInt(netAmount) * numerator + denominator / 2n) / denominator;
  return safeInteger(rounded, 'Nilai pajak terlalu besar.');
}

export function safeInteger(value, message = 'Nilai uang di luar batas integer aman.') {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw badRequest(message);
  return n;
}

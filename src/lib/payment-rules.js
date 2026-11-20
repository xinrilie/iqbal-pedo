import { requestHash } from './ids.js';

// The resource identity is part of the idempotency fingerprint. Reusing one key
// for a different order/outlet/company must never replay another payment.
export function paymentRequestFingerprint({ companyId, outletId, orderId, body }) {
  return requestHash({
    company_id: companyId,
    outlet_id: outletId,
    order_id: orderId,
    payment: body
  });
}

export function isReceiptPaid({ orderStatus, grandTotalAmount, successfulPaymentAmounts }) {
  if (!['confirmed', 'completed'].includes(orderStatus)) return false;
  const total = BigInt(String(grandTotalAmount));
  if (total <= 0n) return false;
  const paid = successfulPaymentAmounts.reduce((sum, amount) => sum + BigInt(String(amount)), 0n);
  return paid >= total;
}

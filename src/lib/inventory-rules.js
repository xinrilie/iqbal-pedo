const SCALE = 1_000_000n;

/** Convert a decimal quantity to an exact integer with six fractional digits. */
export function decimalToMicros(value) {
  const raw = String(value ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
  if (!match) throw new TypeError(`Invalid NUMERIC(18,6) quantity: ${raw}`);

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(6, '0') || '0');
  return sign * (whole * SCALE + fraction);
}

/** Format an exact six-decimal quantity accepted by PostgreSQL NUMERIC(18,6). */
export function microsToDecimal(value) {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Allocate a requirement across already-ordered stock buckets (FEFO/FIFO).
 * Each bucket has lot_id, on_hand_qty_base, and reserved_qty_base.
 * The caller controls SQL ordering; this function never uses floating point.
 */
export function allocateStockBuckets(requiredQuantity, buckets) {
  let remaining = decimalToMicros(requiredQuantity);
  if (remaining <= 0n) throw new RangeError('Required stock quantity must be greater than zero.');

  const allocations = [];
  for (const bucket of buckets) {
    if (remaining === 0n) break;
    const onHand = decimalToMicros(bucket.on_hand_qty_base);
    const reserved = decimalToMicros(bucket.reserved_qty_base ?? '0');
    const available = onHand - reserved;
    if (available <= 0n) continue;

    const quantity = available < remaining ? available : remaining;
    allocations.push({ lotId: bucket.lot_id ?? null, quantityBase: microsToDecimal(quantity) });
    remaining -= quantity;
  }

  return {
    allocations,
    unallocatedQuantity: microsToDecimal(remaining),
    fulfilled: remaining === 0n
  };
}

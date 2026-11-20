import { createHash } from 'node:crypto';
import { conflict, notFound, unprocessable } from './errors.js';
import { allocateStockBuckets, decimalToMicros } from './inventory-rules.js';

const UUID_LIST = 'uuid[]';

function reservationTtlMinutes() {
  const configured = Number.parseInt(process.env.GCIMS_STOCK_RESERVATION_TTL_MINUTES ?? '15', 10);
  if (!Number.isInteger(configured) || configured < 1 || configured > 120) return 15;
  return configured;
}

function reservationIdempotencyKey({ companyId, orderId, idempotencyKey }) {
  const fingerprint = createHash('sha256')
    .update(`${companyId}:${orderId}:${idempotencyKey}`)
    .digest('hex');
  return `stock-reservation:${fingerprint}`;
}

async function expireDueReservationsForOutlet(client, { companyId, outletId, orderId }) {
  // Expire this order first so its partial-unique active reservation key is free.
  await client.query(
    `UPDATE gcims.stock_reservations
        SET status = 'expired', expired_at = now(), updated_at = now()
      WHERE company_id = $1 AND outlet_id = $2 AND order_id = $3
        AND status = 'reserved' AND expires_at <= now()`,
    [companyId, outletId, orderId]
  );
  // Opportunistic cleanup for other expired reservations; SKIP LOCKED avoids blocking
  // a concurrent payment/release transaction holding one of these reservation rows.
  await client.query(
    `WITH due AS (
       SELECT id
         FROM gcims.stock_reservations
        WHERE company_id = $1 AND outlet_id = $2
          AND status = 'reserved' AND expires_at <= now()
        ORDER BY expires_at, id
        LIMIT 100
        FOR UPDATE SKIP LOCKED
     )
     UPDATE gcims.stock_reservations sr
        SET status = 'expired', expired_at = now(), updated_at = now()
       FROM due
      WHERE sr.id = due.id`,
    [companyId, outletId]
  );
}

async function lockInventoryItems(client, { companyId, inventoryItemIds }) {
  const result = await client.query(
    `SELECT id, sku, name, track_lot, track_expiry, allow_negative_stock, is_active
       FROM gcims.inventory_items
      WHERE company_id = $1 AND id = ANY($2::${UUID_LIST})
      ORDER BY id
      FOR UPDATE`,
    [companyId, inventoryItemIds]
  );
  if (result.rowCount !== inventoryItemIds.length) {
    throw unprocessable('INVENTORY_ITEM_SNAPSHOT_INVALID', 'Snapshot BOM memuat bahan yang tidak lagi terdaftar pada perusahaan ini.');
  }
  const itemsById = new Map(result.rows.map((item) => [item.id, item]));
  for (const id of inventoryItemIds) {
    const item = itemsById.get(id);
    if (!item?.is_active) {
      throw conflict('INVENTORY_ITEM_INACTIVE', `Bahan ${item?.sku ?? id} sudah tidak aktif dan tidak dapat dikonsumsi untuk penjualan baru.`);
    }
    if (item.allow_negative_stock) {
      throw conflict('NEGATIVE_STOCK_POLICY_CONFLICT', `Bahan ${item.sku} dikonfigurasi mengizinkan stok minus, sedangkan kebijakan POS GCIMS Sesi 3 melarang stok minus. Nonaktifkan allow_negative_stock pada master bahan.`);
    }
  }
  return itemsById;
}

async function getNonLotBuckets(client, { companyId, outletId, stockLocationId, inventoryItemId }) {
  const result = await client.query(
    `SELECT NULL::uuid AS lot_id,
            COALESCE(SUM(soh.on_hand_qty_base), 0)::numeric(18,6)::text AS on_hand_qty_base,
            COALESCE((
              SELECT SUM(srl.quantity_reserved_base)
                FROM gcims.stock_reservation_lines srl
                JOIN gcims.stock_reservations sr
                  ON sr.company_id = srl.company_id AND sr.id = srl.reservation_id
               WHERE sr.company_id = $1 AND sr.outlet_id = $2
                 AND sr.stock_location_id = $3 AND srl.inventory_item_id = $4
                 AND srl.lot_id IS NULL AND sr.status = 'reserved'
                 AND sr.expires_at > now()
            ), 0)::numeric(18,6)::text AS reserved_qty_base
       FROM gcims.v_stock_on_hand soh
      WHERE soh.company_id = $1 AND soh.outlet_id = $2
        AND soh.stock_location_id = $3 AND soh.inventory_item_id = $4
        AND soh.lot_id IS NULL`,
    [companyId, outletId, stockLocationId, inventoryItemId]
  );
  return result.rows;
}

async function getLotBuckets(client, { companyId, outletId, stockLocationId, inventoryItemId, trackExpiry }) {
  const result = await client.query(
    `SELECT l.id AS lot_id, l.expiry_date, l.received_at,
            COALESCE(soh.on_hand_qty_base, 0)::numeric(18,6)::text AS on_hand_qty_base,
            COALESCE(reserved.reserved_qty_base, 0)::numeric(18,6)::text AS reserved_qty_base
       FROM gcims.inventory_lots l
       JOIN gcims.outlets outlet
         ON outlet.company_id = l.company_id AND outlet.id = $2
       LEFT JOIN gcims.v_stock_on_hand soh
         ON soh.company_id = l.company_id
        AND soh.outlet_id = $2
        AND soh.stock_location_id = l.stock_location_id
        AND soh.inventory_item_id = l.inventory_item_id
        AND soh.lot_id = l.id
       LEFT JOIN LATERAL (
         SELECT SUM(srl.quantity_reserved_base) AS reserved_qty_base
           FROM gcims.stock_reservation_lines srl
           JOIN gcims.stock_reservations sr
             ON sr.company_id = srl.company_id AND sr.id = srl.reservation_id
          WHERE sr.company_id = $1 AND sr.outlet_id = $2
            AND sr.stock_location_id = $3 AND srl.inventory_item_id = $4
            AND srl.lot_id = l.id AND sr.status = 'reserved'
            AND sr.expires_at > now()
       ) reserved ON TRUE
      WHERE l.company_id = $1 AND l.stock_location_id = $3
        AND l.inventory_item_id = $4
        AND (
          ($5::boolean AND l.expiry_date >= (now() AT TIME ZONE outlet.timezone_name)::date)
          OR (NOT $5::boolean AND (l.expiry_date IS NULL OR l.expiry_date >= (now() AT TIME ZONE outlet.timezone_name)::date))
        )
      ORDER BY
        CASE WHEN $5::boolean THEN (l.expiry_date IS NULL) ELSE FALSE END,
        CASE WHEN $5::boolean THEN l.expiry_date END NULLS LAST,
        l.received_at, l.id
      FOR UPDATE OF l`,
    [companyId, outletId, stockLocationId, inventoryItemId, trackExpiry]
  );
  return result.rows;
}

/**
 * Reserve the BOM snapshot for an order. Must run inside the caller's SQL transaction.
 * All callers that mutate sale/waste/adjustment stock must lock inventory_items in
 * ascending UUID order before changing stock_ledger, using the same protocol.
 */
export async function reserveOrderStock(client, {
  companyId, outletId, orderId, actorUserId, idempotencyKey
}) {
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 120) {
    throw unprocessable('STOCK_RESERVATION_KEY_REQUIRED', 'Kunci idempotensi reservasi stok wajib berisi 16–120 karakter.');
  }

  const orderResult = await client.query(
    `SELECT id, stock_location_id, status
       FROM gcims.sales_orders
      WHERE company_id = $1 AND outlet_id = $2 AND id = $3
      FOR UPDATE`,
    [companyId, outletId, orderId]
  );
  if (!orderResult.rowCount) throw notFound('Pesanan tidak ditemukan saat reservasi stok.');
  const order = orderResult.rows[0];
  if (!['draft', 'pending_payment'].includes(order.status)) {
    throw conflict('ORDER_NOT_RESERVABLE', 'Hanya pesanan draft atau pending payment yang dapat mereservasi stok.');
  }

  await expireDueReservationsForOutlet(client, { companyId, outletId, orderId });

  const reservationKey = reservationIdempotencyKey({ companyId, orderId, idempotencyKey });
  const activeReservation = await client.query(
    `SELECT id, idempotency_key FROM gcims.stock_reservations
      WHERE company_id = $1 AND outlet_id = $2 AND order_id = $3
        AND status = 'reserved' AND expires_at > now()
      FOR UPDATE`,
    [companyId, outletId, orderId]
  );
  if (activeReservation.rowCount) {
    if (activeReservation.rows[0].idempotency_key !== reservationKey) {
      throw conflict('ORDER_STOCK_ALREADY_RESERVED', 'Pesanan ini sudah memiliki reservasi aktif dari percobaan pembayaran lain. Selesaikan atau lepaskan percobaan tersebut terlebih dahulu.');
    }
    return { reservationId: activeReservation.rows[0].id, replay: true };
  }

  const closedKey = await client.query(
    `SELECT id, status FROM gcims.stock_reservations
      WHERE company_id = $1 AND idempotency_key = $2
      FOR UPDATE`,
    [companyId, reservationKey]
  );
  if (closedKey.rowCount) {
    throw conflict('STOCK_RESERVATION_KEY_CLOSED', 'Kunci reservasi stok ini sudah pernah ditutup. Gunakan kunci pembayaran baru.');
  }

  const incompleteSnapshot = await client.query(
    `SELECT soi.id
       FROM gcims.sales_order_items soi
      WHERE soi.company_id = $1 AND soi.order_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM gcims.sales_order_item_recipe_lines r
           WHERE r.company_id = soi.company_id
             AND r.sales_order_item_id = soi.id
        )
      LIMIT 1`,
    [companyId, orderId]
  );
  if (incompleteSnapshot.rowCount) {
    throw unprocessable('ORDER_BOM_SNAPSHOT_INCOMPLETE', 'Pesanan memiliki item tanpa snapshot BOM; stok tidak dapat direservasi.');
  }

  const requirementResult = await client.query(
    `SELECT inventory_item_id,
            SUM(quantity_base)::numeric(18,6)::text AS required_qty_base
       FROM gcims.sales_order_item_recipe_lines
      WHERE company_id = $1 AND sales_order_item_id IN (
        SELECT id FROM gcims.sales_order_items WHERE company_id = $1 AND order_id = $2
      )
      GROUP BY inventory_item_id
      ORDER BY inventory_item_id`,
    [companyId, orderId]
  );
  if (!requirementResult.rowCount) {
    throw unprocessable('ORDER_BOM_SNAPSHOT_EMPTY', 'Pesanan tidak memiliki kebutuhan bahan dari snapshot BOM.');
  }

  const requirements = requirementResult.rows;
  const inventoryItemIds = requirements.map((row) => row.inventory_item_id);
  const itemsById = await lockInventoryItems(client, { companyId, inventoryItemIds });

  const locationResult = await client.query(
    `SELECT id FROM gcims.stock_locations
      WHERE company_id = $1 AND outlet_id = $2 AND id = $3 AND is_active`,
    [companyId, outletId, order.stock_location_id]
  );
  if (!locationResult.rowCount) {
    throw conflict('STOCK_LOCATION_INACTIVE', 'Lokasi stok pesanan tidak ditemukan atau sudah tidak aktif.');
  }

  const reservationResult = await client.query(
    `INSERT INTO gcims.stock_reservations
      (company_id, outlet_id, stock_location_id, order_id, status,
       idempotency_key, expires_at, created_by)
     VALUES ($1,$2,$3,$4,'reserved',$5,
             now() + ($6::integer * interval '1 minute'),$7)
     RETURNING id`,
    [companyId, outletId, order.stock_location_id, orderId, reservationKey,
     reservationTtlMinutes(), actorUserId]
  );
  const reservationId = reservationResult.rows[0].id;

  for (const requirement of requirements) {
    const item = itemsById.get(requirement.inventory_item_id);
    const bucketArgs = {
      companyId, outletId, stockLocationId: order.stock_location_id,
      inventoryItemId: requirement.inventory_item_id
    };
    const buckets = item.track_lot
      ? await getLotBuckets(client, { ...bucketArgs, trackExpiry: item.track_expiry })
      : await getNonLotBuckets(client, bucketArgs);
    const allocation = allocateStockBuckets(requirement.required_qty_base, buckets);
    if (!allocation.fulfilled) {
      throw conflict(
        'INSUFFICIENT_STOCK',
        `Stok ${item.name} (${item.sku}) tidak cukup. Dibutuhkan ${requirement.required_qty_base}; kekurangan ${allocation.unallocatedQuantity}.`
      );
    }

    for (const allocated of allocation.allocations) {
      await client.query(
        `INSERT INTO gcims.stock_reservation_lines
          (company_id, reservation_id, stock_location_id, inventory_item_id,
           lot_id, quantity_reserved_base)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [companyId, reservationId, order.stock_location_id, requirement.inventory_item_id,
         allocated.lotId, allocated.quantityBase]
      );
    }
  }

  await client.query(
    `INSERT INTO gcims.audit_logs
      (company_id, outlet_id, actor_user_id, actor_type, action,
       entity_type, entity_id, after_data)
     VALUES ($1,$2,$3,'user','stock.reservation.created',
             'stock_reservation',$4,
             jsonb_build_object('order_id',$5::uuid,'reservation_status','reserved'))`,
    [companyId, outletId, actorUserId, reservationId, orderId]
  );

  return { reservationId, replay: false };
}

/** Consume a live reservation into append-only sale_consumption ledger movements. */
export async function consumeOrderStock(client, {
  companyId, outletId, orderId, reservationId, actorUserId
}) {
  const reservationResult = await client.query(
    `SELECT id, stock_location_id, status, expires_at,
            (expires_at <= now()) AS is_expired
       FROM gcims.stock_reservations
      WHERE company_id = $1 AND outlet_id = $2 AND order_id = $3 AND id = $4
      FOR UPDATE`,
    [companyId, outletId, orderId, reservationId]
  );
  if (!reservationResult.rowCount) throw notFound('Reservasi stok tidak ditemukan.');
  const reservation = reservationResult.rows[0];
  if (reservation.status === 'consumed') return { replay: true };
  if (reservation.status !== 'reserved') {
    throw conflict('STOCK_RESERVATION_NOT_ACTIVE', 'Reservasi stok sudah dilepas atau kedaluwarsa.');
  }
  if (reservation.is_expired) {
    throw conflict('STOCK_RESERVATION_EXPIRED', 'Reservasi stok sudah kedaluwarsa; buat reservasi baru sebelum pembayaran.');
  }

  const reservationLines = await client.query(
    `SELECT id, inventory_item_id, lot_id,
            quantity_reserved_base::numeric(18,6)::text AS quantity_reserved_base
       FROM gcims.stock_reservation_lines
      WHERE company_id = $1 AND reservation_id = $2
      ORDER BY inventory_item_id, lot_id NULLS FIRST, id`,
    [companyId, reservationId]
  );
  if (!reservationLines.rowCount) {
    throw conflict('STOCK_RESERVATION_EMPTY', 'Reservasi stok tidak memiliki baris bahan.');
  }

  const itemIds = [...new Set(reservationLines.rows.map((line) => line.inventory_item_id))].sort();
  await lockInventoryItems(client, { companyId, inventoryItemIds: itemIds });

  // Read balances only after acquiring the same sorted item locks used by reservation.
  const linesResult = await client.query(
    `SELECT srl.id, srl.inventory_item_id, srl.lot_id,
            srl.quantity_reserved_base::numeric(18,6)::text AS quantity_reserved_base,
            COALESCE(soh.on_hand_qty_base, 0)::numeric(18,6)::text AS on_hand_qty_base,
            COALESCE(other_reserved.quantity_reserved_base, 0)::numeric(18,6)::text AS other_reserved_qty_base,
            (lot.expiry_date < (now() AT TIME ZONE outlet.timezone_name)::date) AS lot_expired
       FROM gcims.stock_reservation_lines srl
       LEFT JOIN gcims.v_stock_on_hand soh
         ON soh.company_id = srl.company_id
        AND soh.outlet_id = $2
        AND soh.stock_location_id = srl.stock_location_id
        AND soh.inventory_item_id = srl.inventory_item_id
        AND soh.lot_id IS NOT DISTINCT FROM srl.lot_id
       LEFT JOIN gcims.outlets outlet
         ON outlet.company_id = srl.company_id AND outlet.id = $2
       LEFT JOIN gcims.inventory_lots lot
         ON lot.company_id = srl.company_id
        AND lot.inventory_item_id = srl.inventory_item_id
        AND lot.stock_location_id = srl.stock_location_id
        AND lot.id = srl.lot_id
       LEFT JOIN LATERAL (
         SELECT SUM(other_line.quantity_reserved_base) AS quantity_reserved_base
           FROM gcims.stock_reservation_lines other_line
           JOIN gcims.stock_reservations other_header
             ON other_header.company_id = other_line.company_id
            AND other_header.id = other_line.reservation_id
          WHERE other_header.company_id = $1 AND other_header.outlet_id = $2
            AND other_header.stock_location_id = $4
            AND other_header.status = 'reserved' AND other_header.expires_at > now()
            AND other_header.id <> $3
            AND other_line.inventory_item_id = srl.inventory_item_id
            AND other_line.lot_id IS NOT DISTINCT FROM srl.lot_id
       ) other_reserved ON TRUE
      WHERE srl.company_id = $1 AND srl.reservation_id = $3
      ORDER BY srl.inventory_item_id, srl.lot_id NULLS FIRST, srl.id`,
    [companyId, outletId, reservationId, reservation.stock_location_id]
  );

  for (const line of linesResult.rows) {
    if (line.lot_expired) {
      throw conflict('RESERVED_LOT_EXPIRED', 'Lot bahan pada reservasi sudah melewati tanggal kedaluwarsa.');
    }
    const availableForThisReservation = decimalToMicros(line.on_hand_qty_base)
      - decimalToMicros(line.other_reserved_qty_base);
    if (availableForThisReservation < decimalToMicros(line.quantity_reserved_base)) {
      throw conflict('STOCK_RESERVATION_NO_LONGER_BACKED', 'Saldo stok berubah sehingga reservasi tidak lagi sepenuhnya didukung stok fisik.');
    }
  }

  for (const line of linesResult.rows) {
    const ledgerIdempotencyKey = `sale-consumption:${reservationId}:${line.id}`;
    await client.query(
      `INSERT INTO gcims.stock_ledger
        (company_id, outlet_id, stock_location_id, inventory_item_id, lot_id,
         movement_type, quantity_delta_base, occurred_at, source_type, source_id,
         source_line_id, source_line_sequence, idempotency_key, reason, actor_user_id)
       VALUES ($1,$2,$3,$4,$5,'sale_consumption',$6::numeric * -1,now(),
               'sale',$7,$8,1,$9,'Konsumsi BOM dari penjualan POS',$10)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [companyId, outletId, reservation.stock_location_id, line.inventory_item_id,
       line.lot_id, line.quantity_reserved_base, orderId, line.id,
       ledgerIdempotencyKey, actorUserId]
    );
  }

  await client.query(
    `UPDATE gcims.stock_reservations
        SET status = 'consumed', consumed_at = now(), updated_at = now()
      WHERE company_id = $1 AND id = $2 AND status = 'reserved'`,
    [companyId, reservationId]
  );
  await client.query(
    `INSERT INTO gcims.audit_logs
      (company_id, outlet_id, actor_user_id, actor_type, action,
       entity_type, entity_id, after_data)
     VALUES ($1,$2,$3,'user','stock.reservation.consumed',
             'stock_reservation',$4,
             jsonb_build_object('order_id',$5::uuid,'ledger_line_count',$6::integer))`,
    [companyId, outletId, actorUserId, reservationId, orderId, linesResult.rowCount]
  );

  return { replay: false, ledgerLineCount: linesResult.rowCount };
}

/** Release a reservation after a failed/cancelled pending payment; no ledger entry is created. */
export async function releaseOrderStock(client, {
  companyId, outletId, orderId, reservationId, actorUserId, reason
}) {
  const reservationResult = await client.query(
    `SELECT id, status FROM gcims.stock_reservations
      WHERE company_id = $1 AND outlet_id = $2 AND order_id = $3 AND id = $4
      FOR UPDATE`,
    [companyId, outletId, orderId, reservationId]
  );
  if (!reservationResult.rowCount) throw notFound('Reservasi stok tidak ditemukan.');
  const status = reservationResult.rows[0].status;
  if (status === 'released' || status === 'expired') return { replay: true };
  if (status === 'consumed') {
    throw conflict('STOCK_ALREADY_CONSUMED', 'Stok yang sudah dikonsumsi tidak dapat dilepas; gunakan alur retur/adjustment.');
  }

  await client.query(
    `UPDATE gcims.stock_reservations
        SET status = 'released', released_at = now(), release_reason = $3, updated_at = now()
      WHERE company_id = $1 AND id = $2 AND status = 'reserved'`,
    [companyId, reservationId, reason ?? 'Payment failed or order cancelled']
  );
  await client.query(
    `INSERT INTO gcims.audit_logs
      (company_id, outlet_id, actor_user_id, actor_type, action,
       entity_type, entity_id, reason, after_data)
     VALUES ($1,$2,$3,'user','stock.reservation.released',
             'stock_reservation',$4,$5,
             jsonb_build_object('order_id',$6::uuid,'reservation_status','released'))`,
    [companyId, outletId, actorUserId, reservationId, reason ?? null, orderId]
  );
  return { replay: false };
}

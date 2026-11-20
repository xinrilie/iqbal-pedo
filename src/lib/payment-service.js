import { withTransaction, pool } from './db.js';
import { badRequest, conflict, notFound, unprocessable, notImplemented } from './errors.js';
import { makeDocumentNumber } from './ids.js';
import { safeInteger } from './money.js';
import { paymentRequestFingerprint, isReceiptPaid } from './payment-rules.js';
import { reserveOrderStock, consumeOrderStock } from './inventory-service.js';

export async function createCashPayment({ companyId, outletId, orderId, userId, idempotencyKey, body }) {
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 120) {
    throw badRequest('Header Idempotency-Key wajib diisi (16–120 karakter).');
  }
  if (body.method !== 'cash') {
    throw notImplemented('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Implementasi awal hanya mengaktifkan pembayaran tunai. QRIS/kartu/transfer menunggu pemilihan dan integrasi provider serta rekonsiliasi sandbox.');
  }
  if (process.env.GCIMS_ALLOW_TEST_ONLY_PAYMENT !== 'true' || process.env.NODE_ENV === 'production') {
    throw notImplemented('PAYMENT_RUNTIME_VALIDATION_REQUIRED', 'Inventory Engine Sesi 3 sudah terintegrasi pada kode, tetapi konfirmasi pembayaran tetap test-only sampai migration dan integration/concurrency test PostgreSQL lulus. Untuk uji pada db_gcims_test saja, aktifkan GCIMS_ALLOW_TEST_ONLY_PAYMENT=true. Jangan aktifkan di produksi.');
  }
  const hash = paymentRequestFingerprint({ companyId, outletId, orderId, body });
  const result = await withTransaction(async (client) => {
    const database = await client.query('SELECT current_database() AS name');
    if (database.rows[0]?.name !== 'db_gcims_test') {
      throw notImplemented('TEST_DATABASE_REQUIRED', 'Pembayaran test-only hanya boleh dijalankan pada database db_gcims_test.');
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`payment:${companyId}:${idempotencyKey}`]);
    const existing = await client.query(
      `SELECT id, idempotency_request_hash FROM gcims.payments
        WHERE company_id = $1 AND idempotency_key = $2`, [companyId, idempotencyKey]
    );
    if (existing.rowCount) {
      if (existing.rows[0].idempotency_request_hash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key sudah dipakai dengan isi pembayaran berbeda.');
      return { paymentId: existing.rows[0].id, replay: true };
    }

    const orderResult = await client.query(
      `SELECT * FROM gcims.sales_orders
        WHERE company_id = $1 AND outlet_id = $2 AND id = $3
        FOR UPDATE`, [companyId, outletId, orderId]
    );
    if (!orderResult.rowCount) throw notFound('Pesanan tidak ditemukan.');
    const order = orderResult.rows[0];
    if (!['draft', 'pending_payment'].includes(order.status)) throw conflict('ORDER_NOT_PAYABLE', 'Pesanan tidak berada pada status yang dapat dibayar.');
    const amountDue = safeInteger(order.grand_total_amount);
    if (body.amount !== amountDue) throw unprocessable('PAYMENT_AMOUNT_MISMATCH', 'Nominal pembayaran harus sama dengan total tagihan. Split payment belum diaktifkan.');
    if (!Number.isSafeInteger(body.cash_received_amount) || body.cash_received_amount < body.amount) {
      throw unprocessable('INSUFFICIENT_CASH_RECEIVED', 'Uang yang diterima harus sama dengan atau lebih besar dari tagihan.');
    }

    // Reserve the frozen BOM requirements before accepting payment. The reservation,
    // payment, stock ledger movements, order confirmation, and KDS ticket all share
    // this transaction: any failure rolls the entire operation back.
    const stockReservation = await reserveOrderStock(client, {
      companyId, outletId, orderId, actorUserId: userId, idempotencyKey
    });

    const paymentId = (await client.query(
      `INSERT INTO gcims.payments
        (company_id, order_id, payment_number, method, status, amount,
         currency_code, idempotency_key, idempotency_request_hash,
         initiated_at, confirmed_at, cash_received_amount, cash_change_amount, created_by)
       VALUES ($1,$2,$3,'cash','succeeded',$4,'IDR',$5,$6,now(),now(),$7,$8,$9)
       RETURNING id`,
      [companyId, orderId, makeDocumentNumber('PAY'), amountDue, idempotencyKey, hash,
       body.cash_received_amount, body.cash_received_amount - amountDue, userId]
    )).rows[0].id;

    const stockConsumption = await consumeOrderStock(client, {
      companyId, outletId, orderId,
      reservationId: stockReservation.reservationId,
      actorUserId: userId
    });

    await client.query(
      `UPDATE gcims.sales_orders SET status = 'confirmed', confirmed_at = now(), updated_at = now()
        WHERE company_id = $1 AND outlet_id = $2 AND id = $3`, [companyId, outletId, orderId]
    );

    const lines = await client.query(
      `SELECT id, line_no, menu_name_snapshot, variant_name_snapshot, quantity, item_note
         FROM gcims.sales_order_items WHERE order_id = $1 AND recipe_version_id IS NOT NULL ORDER BY line_no`, [orderId]
    );
    let ticketId = null;
    if (lines.rowCount) {
      ticketId = (await client.query(
        `INSERT INTO gcims.kitchen_tickets
          (company_id, outlet_id, order_id, ticket_number, status)
         VALUES ($1,$2,$3,$4,'queued') RETURNING id`,
        [companyId, outletId, orderId, makeDocumentNumber('KDS')]
      )).rows[0].id;
      for (const line of lines.rows) {
        const ticketItemId = (await client.query(
          `INSERT INTO gcims.kitchen_ticket_items
            (company_id, kitchen_ticket_id, order_id, sales_order_item_id, line_no,
             menu_name_snapshot, variant_name_snapshot, quantity, item_note, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued')
           RETURNING id`,
          [companyId, ticketId, orderId, line.id, line.line_no,
           line.menu_name_snapshot, line.variant_name_snapshot, line.quantity, line.item_note]
        )).rows[0].id;
        await client.query(
          `INSERT INTO gcims.kitchen_ticket_events
            (company_id, outlet_id, kitchen_ticket_id, kitchen_ticket_item_id,
             event_type, from_status, to_status, actor_user_id, metadata)
           VALUES ($1,$2,$3,$4,'item_queued',NULL,'queued',$5,'{}'::jsonb)`,
          [companyId, outletId, ticketId, ticketItemId, userId]
        );
      }
      await client.query(
        `INSERT INTO gcims.kitchen_ticket_events
          (company_id, outlet_id, kitchen_ticket_id, event_type, from_status, to_status, actor_user_id, metadata)
         VALUES ($1,$2,$3,'ticket_created',NULL,'queued',$4,jsonb_build_object('order_id',$5::uuid))`,
        [companyId, outletId, ticketId, userId, orderId]
      );
    }
    await client.query(
      `INSERT INTO gcims.outbox_events
        (company_id, outlet_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
       VALUES ($1,$2,'sales_order',$3,'order.confirmed',$4,
               jsonb_build_object('order_id',$3::uuid,'payment_id',$5::uuid,'ticket_id',$6::uuid))
       ON CONFLICT (company_id, dedupe_key) DO NOTHING`,
      [companyId, outletId, orderId, `order-confirmed:${orderId}`, paymentId, ticketId]
    );
    await client.query(
      `INSERT INTO gcims.outbox_events
        (company_id, outlet_id, aggregate_type, aggregate_id, event_type, dedupe_key, payload)
       VALUES ($1,$2,'sales_order',$3,'inventory.sale_consumed',$4,
               jsonb_build_object('order_id',$3::uuid,'reservation_id',$5::uuid,'ledger_line_count',$6::integer))
       ON CONFLICT (company_id, dedupe_key) DO NOTHING`,
      [companyId, outletId, orderId, `inventory-sale-consumed:${orderId}`,
       stockReservation.reservationId, stockConsumption.ledgerLineCount ?? 0]
    );
    await client.query(
      `INSERT INTO gcims.audit_logs
        (company_id, outlet_id, actor_user_id, actor_type, action, entity_type, entity_id, after_data)
       VALUES ($1,$2,$3,'user','payment.succeeded','payment',$4,jsonb_build_object('amount',$5::bigint,'method','cash'))`,
      [companyId, outletId, userId, paymentId, amountDue]
    );
    return { paymentId, replay: false };
  });
  return { payment: await getPayment({ companyId, outletId, paymentId: result.paymentId }), replay: result.replay };
}

export async function getPayment({ companyId, outletId, paymentId }) {
  const result = await pool.query(
    `SELECT p.*, o.outlet_id
       FROM gcims.payments p
       JOIN gcims.sales_orders o ON o.company_id = p.company_id AND o.id = p.order_id
      WHERE p.company_id = $1 AND o.outlet_id = $2 AND p.id = $3`,
    [companyId, outletId, paymentId]
  );
  if (!result.rowCount) throw notFound('Pembayaran tidak ditemukan.');
  const p = result.rows[0];
  return {
    id: p.id, payment_number: p.payment_number, method: p.method, status: p.status,
    amount: safeInteger(p.amount), currency: p.currency_code,
    provider_reference: p.provider_reference,
    cash_received_amount: p.cash_received_amount == null ? null : safeInteger(p.cash_received_amount),
    cash_change_amount: p.cash_change_amount == null ? null : safeInteger(p.cash_change_amount),
    confirmed_at: p.confirmed_at
  };
}

export async function getReceipt({ companyId, outletId, orderId }) {
  const order = await (await import('./order-service.js')).getOrder({ companyId, outletId, orderId });
  const payments = await pool.query(
    `SELECT p.id, p.amount
       FROM gcims.payments p
       JOIN gcims.sales_orders o ON o.company_id = p.company_id AND o.id = p.order_id
      WHERE p.company_id = $1 AND o.outlet_id = $2 AND p.order_id = $3
        AND p.status = 'succeeded'
      ORDER BY p.created_at, p.id`, [companyId, outletId, orderId]
  );
  if (!isReceiptPaid({
    orderStatus: order.status,
    grandTotalAmount: order.grand_total_amount,
    successfulPaymentAmounts: payments.rows.map((row) => row.amount)
  })) {
    throw conflict('RECEIPT_NOT_PAID', 'Bukti pembayaran hanya tersedia setelah pembayaran berhasil melunasi total pesanan.');
  }
  const paymentList = [];
  for (const row of payments.rows) paymentList.push(await getPayment({ companyId, outletId, paymentId: row.id }));
  return { order, payments: paymentList, issued_at: new Date().toISOString(), receipt_reference: order.order_number };
}

export async function cancelPendingPayment({ companyId, outletId, paymentId }) {
  const result = await withTransaction(async (client) => {
    const payment = await client.query(
      `SELECT p.*, o.outlet_id FROM gcims.payments p
        JOIN gcims.sales_orders o ON o.company_id = p.company_id AND o.id = p.order_id
       WHERE p.company_id = $1 AND o.outlet_id = $2 AND p.id = $3
       FOR UPDATE OF p`, [companyId, outletId, paymentId]
    );
    if (!payment.rowCount) throw notFound('Pembayaran tidak ditemukan.');
    if (payment.rows[0].status !== 'pending') throw conflict('PAYMENT_NOT_PENDING', 'Hanya pembayaran pending yang dapat dibatalkan.');
    // Pending provider payments are not created until a provider adapter is configured.
    throw notImplemented('PAYMENT_CANCELLATION_NOT_CONFIGURED', 'Pembatalan pembayaran eksternal belum tersedia karena provider belum dikonfigurasi.');
  });
  return result;
}

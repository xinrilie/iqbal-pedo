import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { pool, withTransaction } from '../lib/db.js';
import { createDraftOrder, getOrder, replaceDraftOrderItems } from '../lib/order-service.js';
import { releaseOrderStock } from '../lib/inventory-service.js';

const Line = z.object({
  menu_variant_id: z.string().uuid(),
  quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/),
  item_note: z.string().max(500).nullable().optional()
});
const CreateOrder = z.object({
  order_type: z.enum(['dine_in', 'takeaway']),
  stock_location_id: z.string().uuid(),
  table_label: z.string().max(40).nullable().optional(),
  queue_name: z.string().max(100).nullable().optional(),
  customer_note: z.string().max(1000).nullable().optional(),
  lines: z.array(Line).min(1).max(50)
});
const ReplaceItems = z.object({
  lines: z.array(Line).min(1).max(50),
  customer_note: z.string().max(1000).nullable().optional()
});
const CancelDraft = z.object({ reason: z.string().trim().min(2).max(240).default('Draft dibatalkan oleh kasir') });

export async function orderRoutes(app) {
  app.get('/outlets/:outletId/stock-locations', {
    preHandler: [app.authenticate, app.requirePermission('pos.order.create')]
  }, async (request) => {
    if (request.params.outletId !== request.gcims.outletId) throw notFound('Outlet tidak ditemukan.');
    const result = await pool.query(
      `SELECT sl.id,sl.code,sl.name,sl.location_type,o.code AS outlet_code,o.name AS outlet_name
         FROM gcims.stock_locations sl
         JOIN gcims.outlets o ON o.company_id=sl.company_id AND o.id=sl.outlet_id
        WHERE sl.company_id=$1 AND sl.outlet_id=$2 AND sl.is_active=TRUE
        ORDER BY sl.name,sl.id`,
      [request.gcims.companyId,request.gcims.outletId]
    );
    return { data: result.rows };
  });

  app.post('/outlets/:outletId/orders', {
    preHandler: [app.authenticate, app.requirePermission('pos.order.create')]
  }, async (request, reply) => {
    if (request.params.outletId !== request.gcims.outletId) throw notFound('Outlet tidak ditemukan.');
    const parsed = CreateOrder.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload order tidak valid.', parsed.error.issues);
    const result = await createDraftOrder({
      ...request.gcims,
      userId: request.gcims.userId,
      idempotencyKey: request.headers['idempotency-key'],
      body: parsed.data
    });
    return reply.code(result.replay ? 200 : 201).send(result.order);
  });

  app.get('/orders/:orderId', {
    preHandler: [app.authenticate, app.requirePermission('pos.order.read')]
  }, async (request) => getOrder({ ...request.gcims, orderId: request.params.orderId }));

  app.put('/orders/:orderId/items', {
    preHandler: [app.authenticate, app.requirePermission('pos.order.update')]
  }, async (request) => {
    const parsed = ReplaceItems.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload keranjang tidak valid.', parsed.error.issues);
    const rawIfMatch = request.headers['if-match'];
    const expectedVersion = Number(String(rawIfMatch ?? '').replaceAll('"', ''));
    return replaceDraftOrderItems({
      ...request.gcims, orderId: request.params.orderId,
      userId: request.gcims.userId, expectedVersion, body: parsed.data
    });
  });

  app.post('/orders/:orderId/cancel', {
    preHandler: [app.authenticate, app.requirePermission('pos.order.update')]
  }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.orderId).success) throw notFound('Draft pesanan tidak ditemukan.');
    const parsed = CancelDraft.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest('Alasan pembatalan draft tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    return withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id,order_number,status,cashier_user_id FROM gcims.sales_orders
          WHERE company_id=$1 AND outlet_id=$2 AND id=$3 AND cashier_user_id=$4
          FOR UPDATE`, [companyId,outletId,request.params.orderId,userId]
      );
      if (!locked.rowCount) throw notFound('Draft pesanan tidak ditemukan.');
      const order = locked.rows[0];
      if (!['draft','pending_payment'].includes(order.status)) {
        throw conflict('ORDER_NOT_CANCELLABLE', 'Hanya draft yang belum dibayar yang dapat dibatalkan.');
      }

      const payment = await client.query(
        `SELECT id,status FROM gcims.payments
          WHERE company_id=$1 AND order_id=$2 AND status IN ('pending','succeeded')
          ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [companyId,order.id]
      );
      if (payment.rows[0]?.status === 'succeeded') {
        throw conflict('ORDER_ALREADY_PAID', 'Pesanan sudah dibayar dan tidak dapat dibatalkan sebagai draft.');
      }
      if (payment.rows[0]?.status === 'pending') {
        throw conflict('ORDER_PAYMENT_IN_PROGRESS', 'Pembayaran sedang diproses. Tunggu hasil pembayaran sebelum membatalkan draft.');
      }

      const reservation = await client.query(
        `SELECT id FROM gcims.stock_reservations
          WHERE company_id=$1 AND outlet_id=$2 AND order_id=$3 AND status='reserved'
          ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [companyId,outletId,order.id]
      );
      if (reservation.rowCount) {
        await releaseOrderStock(client, {
          companyId,outletId,orderId:order.id,reservationId:reservation.rows[0].id,
          actorUserId:userId,reason:parsed.data.reason
        });
      }

      await client.query(
        `UPDATE gcims.sales_orders SET status='cancelled',cancelled_at=now(),cancel_reason=$4,updated_at=now()
          WHERE company_id=$1 AND outlet_id=$2 AND id=$3`, [companyId,outletId,order.id,parsed.data.reason]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs
          (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
         VALUES ($1,$2,$3,'pos.order.draft_cancelled','sales_order',$4,
           jsonb_build_object('status',$5::text),jsonb_build_object('status','cancelled'),$6)`,
        [companyId,outletId,userId,order.id,order.status,parsed.data.reason]
      );
      return { id: order.id, order_number: order.order_number, status: 'cancelled' };
    });
  });

}

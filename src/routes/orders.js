import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { pool } from '../lib/db.js';
import { createDraftOrder, getOrder, replaceDraftOrderItems } from '../lib/order-service.js';

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
}

import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import {
  approveStocktake, cancelStocktake, countStocktakeLine, createStocktake,
  getStocktake, listStocktakes, postStocktake, submitStocktake
} from '../lib/stocktake-service.js';

const Uuid = z.string().uuid();
const Quantity = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/);
const CreateBody = z.object({ stock_location_id: Uuid, notes: z.string().trim().max(1000).nullable().optional() });
const CountBody = z.object({
  counted_qty_base: Quantity,
  reason_code: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional()
});
const CancelBody = z.object({ reason: z.string().trim().min(2).max(500) });
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

function parse(schema, value, message) {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(message, result.error.issues);
  return result.data;
}

export async function stocktakeRoutes(app) {
  app.get('/admin/stocktakes', {
    preHandler: [app.authenticate, app.requirePermission('admin.inventory.read')]
  }, async (request) => {
    const query = parse(ListQuery, request.query, 'Parameter stok opname tidak valid.');
    return listStocktakes({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, limit: query.limit });
  });

  app.post('/admin/stocktakes', {
    preHandler: [app.authenticate, app.requirePermission('admin.inventory.update')]
  }, async (request, reply) => {
    const body = parse(CreateBody, request.body, 'Data stok opname tidak valid.');
    const stocktake = await createStocktake({
      companyId: request.gcims.companyId, outletId: request.gcims.outletId,
      stockLocationId: body.stock_location_id, userId: request.gcims.userId, notes: body.notes ?? null
    });
    return reply.code(201).send(stocktake);
  });

  app.get('/admin/stocktakes/:stocktakeId', {
    preHandler: [app.authenticate, app.requirePermission('admin.inventory.read')]
  }, async (request) => {
    if (!Uuid.safeParse(request.params.stocktakeId).success) throw notFound('Stok opname tidak ditemukan.');
    return getStocktake({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, stocktakeId: request.params.stocktakeId });
  });

  app.put('/admin/stocktakes/:stocktakeId/items/:itemId', {
    preHandler: [app.authenticate, app.requirePermission('admin.inventory.update')]
  }, async (request) => {
    const { stocktakeId, itemId } = request.params;
    if (!Uuid.safeParse(stocktakeId).success || !Uuid.safeParse(itemId).success) throw notFound('Baris stok opname tidak ditemukan.');
    const body = parse(CountBody, request.body, 'Data hitung stok tidak valid.');
    return countStocktakeLine({
      companyId: request.gcims.companyId, outletId: request.gcims.outletId,
      stocktakeId, lineId: itemId, userId: request.gcims.userId,
      countedQty: body.counted_qty_base, reasonCode: body.reason_code ?? null, notes: body.notes ?? null
    });
  });

  for (const [action, handler] of [
    ['submit', submitStocktake], ['approve', approveStocktake], ['post', postStocktake]
  ]) {
    app.post(`/admin/stocktakes/:stocktakeId/${action}`, {
      preHandler: [app.authenticate, app.requirePermission('admin.inventory.update')]
    }, async (request) => {
      if (!Uuid.safeParse(request.params.stocktakeId).success) throw notFound('Stok opname tidak ditemukan.');
      return handler({
        companyId: request.gcims.companyId, outletId: request.gcims.outletId,
        stocktakeId: request.params.stocktakeId, userId: request.gcims.userId
      });
    });
  }

  app.post('/admin/stocktakes/:stocktakeId/cancel', {
    preHandler: [app.authenticate, app.requirePermission('admin.inventory.update')]
  }, async (request) => {
    if (!Uuid.safeParse(request.params.stocktakeId).success) throw notFound('Stok opname tidak ditemukan.');
    const body = parse(CancelBody, request.body, 'Alasan pembatalan tidak valid.');
    return cancelStocktake({
      companyId: request.gcims.companyId, outletId: request.gcims.outletId,
      stocktakeId: request.params.stocktakeId, userId: request.gcims.userId, reason: body.reason
    });
  });
}

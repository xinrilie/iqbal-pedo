import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import {
  createSupplier, updateSupplier, listSuppliers, listSupplierItems, upsertSupplierItem,
  createPurchaseOrder, getPurchaseOrder, listPurchaseOrders, transitionPurchaseOrder,
  createGoodsReceipt, getGoodsReceipt, listGoodsReceipts, transitionGoodsReceipt
} from '../lib/procurement-service.js';

const Uuid = z.string().uuid();
const Decimal6 = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
const PositiveDecimal6 = z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
const isRealDate = (value) => { const date = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; };
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, 'Tanggal tidak valid.');
const DateTime = z.string().datetime({ offset: true });
const SupplierFields = {
  code: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  name: z.string().trim().min(2).max(160),
  contact_name: z.string().trim().max(120).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(4000).nullable().optional(),
  payment_terms: z.string().max(120).nullable().optional(),
  default_lead_time_days: z.number().int().min(0).max(365).nullable().optional(),
  is_active: z.boolean().optional()
};
const { is_active: _isActive, ...SupplierCreateFields } = SupplierFields;
const SupplierCreate = z.object(SupplierCreateFields);
const SupplierUpdate = z.object(SupplierFields).partial().refine((v) => Object.keys(v).length > 0, 'Minimal satu field harus dikirim.');
const SupplierItemUpsert = z.object({
  supplier_sku: z.string().max(80).nullable().optional(),
  purchase_uom_id: Uuid,
  default_unit_price: z.number().int().nonnegative().nullable().optional(),
  minimum_order_qty: PositiveDecimal6.nullable().optional(),
  lead_time_days: z.number().int().min(0).max(365).nullable().optional(),
  is_preferred: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true)
});
const PurchaseOrderCreate = z.object({
  supplier_id: Uuid,
  expected_at: DateTime.nullable().optional(),
  currency_code: z.string().regex(/^[A-Z]{3}$/).optional().default('IDR'),
  tax_amount: z.number().int().nonnegative().optional().default(0),
  shipping_amount: z.number().int().nonnegative().optional().default(0),
  notes: z.string().max(4000).nullable().optional(),
  lines: z.array(z.object({
    inventory_item_id: Uuid,
    purchase_uom_id: Uuid.optional(),
    quantity: PositiveDecimal6,
    unit_price_purchase_uom: z.number().int().nonnegative().optional(),
    discount_amount: z.number().int().nonnegative().optional().default(0),
    notes: z.string().max(1000).nullable().optional()
  })).min(1).max(100)
});
const GoodsReceiptCreate = z.object({
  stock_location_id: Uuid,
  received_at: DateTime.optional(),
  supplier_document_no: z.string().max(100).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  lines: z.array(z.object({
    purchase_order_item_id: Uuid,
    quantity_received: PositiveDecimal6,
    quantity_rejected: Decimal6.optional().default('0'),
    lot_code: z.string().trim().min(1).max(100).nullable().optional(),
    supplier_lot_code: z.string().max(100).nullable().optional(),
    manufactured_at: DateOnly.nullable().optional(),
    expiry_date: DateOnly.nullable().optional(),
    rejection_reason: z.string().trim().max(1000).nullable().optional(),
    notes: z.string().max(1000).nullable().optional()
  })).min(1).max(100)
});
const ListQuery = z.object({
  q: z.string().max(120).optional(),
  status: z.string().max(30).optional(),
  supplierId: Uuid.optional(),
  purchaseOrderId: Uuid.optional(),
  includeInactive: z.enum(['true','false']).optional().default('false'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

function parseOrThrow(schema, value, message) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest(message, parsed.error.issues);
  return parsed.data;
}

export async function procurementRoutes(app) {
  app.get('/procurement/suppliers', { preHandler: [app.authenticate, app.requirePermission('procurement.supplier.read')] }, async (request) => {
    const q = parseOrThrow(ListQuery, request.query, 'Parameter supplier tidak valid.');
    return listSuppliers({ companyId: request.gcims.companyId, q: q.q, includeInactive: q.includeInactive === 'true', limit: q.limit });
  });

  app.post('/procurement/suppliers', { preHandler: [app.authenticate, app.requirePermission('procurement.supplier.write')] }, async (request, reply) => {
    const body = parseOrThrow(SupplierCreate, request.body, 'Payload supplier tidak valid.');
    const supplier = await createSupplier({ companyId: request.gcims.companyId, userId: request.gcims.userId, body: { ...body, code: body.code.toUpperCase() } });
    return reply.code(201).send(supplier);
  });

  app.patch('/procurement/suppliers/:supplierId', { preHandler: [app.authenticate, app.requirePermission('procurement.supplier.write')] }, async (request) => {
    if (!Uuid.safeParse(request.params.supplierId).success) throw notFound('Supplier tidak ditemukan.');
    const body = parseOrThrow(SupplierUpdate, request.body, 'Payload perubahan supplier tidak valid.');
    if (body.code) body.code = body.code.toUpperCase();
    return updateSupplier({ companyId: request.gcims.companyId, userId: request.gcims.userId, supplierId: request.params.supplierId, body });
  });

  app.get('/procurement/suppliers/:supplierId/items', { preHandler: [app.authenticate, app.requirePermission('procurement.catalog.read')] }, async (request) => {
    if (!Uuid.safeParse(request.params.supplierId).success) throw notFound('Supplier tidak ditemukan.');
    return listSupplierItems({ companyId: request.gcims.companyId, supplierId: request.params.supplierId });
  });

  app.put('/procurement/suppliers/:supplierId/items/:inventoryItemId', { preHandler: [app.authenticate, app.requirePermission('procurement.catalog.write')] }, async (request) => {
    const { supplierId, inventoryItemId } = request.params;
    if (!Uuid.safeParse(supplierId).success || !Uuid.safeParse(inventoryItemId).success) throw notFound('Supplier atau item tidak ditemukan.');
    const body = parseOrThrow(SupplierItemUpsert, request.body, 'Payload katalog supplier tidak valid.');
    return upsertSupplierItem({ companyId: request.gcims.companyId, supplierId, inventoryItemId, userId: request.gcims.userId, body });
  });

  app.get('/procurement/purchase-orders', { preHandler: [app.authenticate, app.requirePermission('procurement.po.read')] }, async (request) => {
    const q = parseOrThrow(ListQuery, request.query, 'Parameter purchase order tidak valid.');
    return listPurchaseOrders({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, status: q.status, supplierId: q.supplierId, limit: q.limit });
  });

  app.post('/procurement/purchase-orders', { preHandler: [app.authenticate, app.requirePermission('procurement.po.create')] }, async (request, reply) => {
    const body = parseOrThrow(PurchaseOrderCreate, request.body, 'Payload purchase order tidak valid.');
    const result = await createPurchaseOrder({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, userId: request.gcims.userId, idempotencyKey: request.headers['idempotency-key'], body });
    return reply.code(result.replay ? 200 : 201).send(result.purchaseOrder);
  });

  app.get('/procurement/purchase-orders/:poId', { preHandler: [app.authenticate, app.requirePermission('procurement.po.read')] }, async (request) => {
    if (!Uuid.safeParse(request.params.poId).success) throw notFound('Purchase order tidak ditemukan.');
    return getPurchaseOrder({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, poId: request.params.poId });
  });

  for (const [action, permission] of [['submit','procurement.po.submit'],['approve','procurement.po.approve'],['send','procurement.po.send'],['cancel','procurement.po.cancel'],['close','procurement.po.close']]) {
    app.post(`/procurement/purchase-orders/:poId/${action}`, { preHandler: [app.authenticate, app.requirePermission(permission)] }, async (request) => {
      if (!Uuid.safeParse(request.params.poId).success) throw notFound('Purchase order tidak ditemukan.');
      return transitionPurchaseOrder({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, poId: request.params.poId, userId: request.gcims.userId, action });
    });
  }

  app.post('/procurement/purchase-orders/:poId/goods-receipts', { preHandler: [app.authenticate, app.requirePermission('procurement.receipt.create')] }, async (request, reply) => {
    if (!Uuid.safeParse(request.params.poId).success) throw notFound('Purchase order tidak ditemukan.');
    const body = parseOrThrow(GoodsReceiptCreate, request.body, 'Payload goods receipt tidak valid.');
    const result = await createGoodsReceipt({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, userId: request.gcims.userId, poId: request.params.poId, idempotencyKey: request.headers['idempotency-key'], body });
    return reply.code(result.replay ? 200 : 201).send(result.goodsReceipt);
  });

  app.get('/procurement/goods-receipts', { preHandler: [app.authenticate, app.requirePermission('procurement.receipt.read')] }, async (request) => {
    const q = parseOrThrow(ListQuery, request.query, 'Parameter goods receipt tidak valid.');
    return listGoodsReceipts({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, status: q.status, poId: q.purchaseOrderId, limit: q.limit });
  });

  app.get('/procurement/goods-receipts/:receiptId', { preHandler: [app.authenticate, app.requirePermission('procurement.receipt.read')] }, async (request) => {
    if (!Uuid.safeParse(request.params.receiptId).success) throw notFound('Goods receipt tidak ditemukan.');
    return getGoodsReceipt({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, receiptId: request.params.receiptId });
  });

  for (const [action, permission] of [['submit','procurement.receipt.submit'],['approve','procurement.receipt.approve'],['reject','procurement.receipt.approve'],['post','procurement.receipt.post']]) {
    app.post(`/procurement/goods-receipts/:receiptId/${action}`, { preHandler: [app.authenticate, app.requirePermission(permission)] }, async (request) => {
      if (!Uuid.safeParse(request.params.receiptId).success) throw notFound('Goods receipt tidak ditemukan.');
      const reason = request.body?.reason;
      if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) throw badRequest('Alasan harus berupa teks maksimal 1000 karakter.');
      return transitionGoodsReceipt({ companyId: request.gcims.companyId, outletId: request.gcims.outletId, receiptId: request.params.receiptId, userId: request.gcims.userId, action, reason });
    });
  }
}

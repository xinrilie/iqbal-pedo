import { withTransaction, pool } from './db.js';
import { badRequest, conflict, notFound, unprocessable } from './errors.js';
import { makeDocumentNumber, requestHash } from './ids.js';
import {
  acceptedPurchaseQuantity,
  assertMakerChecker,
  computePurchaseOrderTotals,
  decimalToUnits,
  nextGoodsReceiptStatus,
  nextPurchaseOrderStatus,
  parsePositiveInteger,
  quantityBaseFromFactor,
  unitCostBaseAmount
} from './procurement-rules.js';

function requireIdempotencyKey(key, label) {
  if (typeof key !== 'string' || key.length < 16 || key.length > 120) {
    throw badRequest(`Header Idempotency-Key wajib diisi untuk ${label} (16–120 karakter).`);
  }
}

async function writeAudit(client, { companyId, outletId, userId, action, entityType, entityId, beforeData = null, afterData = null, reason = null }) {
  await client.query(
    `INSERT INTO gcims.audit_logs
      (company_id, outlet_id, actor_user_id, actor_type, action, entity_type, entity_id, before_data, after_data, reason)
     VALUES ($1,$2,$3,'user',$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [companyId, outletId, userId, action, entityType, entityId,
      beforeData ? JSON.stringify(beforeData) : null,
      afterData ? JSON.stringify(afterData) : null, reason]
  );
}

async function getPurchaseUomFactor(client, { companyId, inventoryItemId, purchaseUomId, baseUomId }) {
  if (purchaseUomId === baseUomId) return '1.00000000';
  const result = await client.query(
    `SELECT factor_to_base::numeric(18,8)::text AS factor_to_base
       FROM gcims.item_uom_conversions
      WHERE company_id = $1 AND inventory_item_id = $2 AND from_uom_id = $3
        AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY valid_from DESC, created_at DESC
      LIMIT 1`,
    [companyId, inventoryItemId, purchaseUomId]
  );
  if (!result.rowCount) {
    throw unprocessable('PURCHASE_UOM_CONVERSION_REQUIRED', 'Konversi UOM pembelian ke satuan dasar belum tersedia atau tidak berlaku hari ini.');
  }
  return result.rows[0].factor_to_base;
}

export async function listSuppliers({ companyId, q, includeInactive = false, limit = 50 }) {
  const result = await pool.query(
    `SELECT s.id,s.code,s.name,s.contact_name,s.email,s.phone,s.address,s.payment_terms,
            s.default_lead_time_days,s.is_active,s.created_at,s.updated_at,
            COUNT(DISTINCT sii.id)::integer AS catalog_item_count
       FROM gcims.suppliers s
       LEFT JOIN gcims.supplier_inventory_items sii
         ON sii.company_id=s.company_id AND sii.supplier_id=s.id AND sii.is_active=TRUE
      WHERE s.company_id=$1 AND ($2::text IS NULL OR s.code ILIKE '%'||$2||'%' OR s.name ILIKE '%'||$2||'%')
        AND ($3::boolean OR s.is_active=TRUE)
      GROUP BY s.id
      ORDER BY s.name,s.id LIMIT $4`,
    [companyId, q ?? null, includeInactive, limit]
  );
  return { data: result.rows };
}

export async function listProcurementInventoryItems({ companyId }) {
  const result = await pool.query(
    `SELECT i.id,i.sku,i.name,i.base_uom_id,u.code AS base_uom_code,i.track_lot,i.track_expiry,
            jsonb_agg(DISTINCT jsonb_build_object('id',units.uom_id,'code',units.code,'name',units.name)) AS purchase_uoms
       FROM gcims.inventory_items i
       JOIN gcims.uoms u ON u.id=i.base_uom_id
       LEFT JOIN LATERAL (
         SELECT i.base_uom_id AS uom_id,u.code,u.name
         UNION
         SELECT c.from_uom_id,pu.code,pu.name
           FROM gcims.item_uom_conversions c JOIN gcims.uoms pu ON pu.id=c.from_uom_id
          WHERE c.company_id=i.company_id AND c.inventory_item_id=i.id
            AND c.valid_from<=CURRENT_DATE AND (c.valid_to IS NULL OR c.valid_to>=CURRENT_DATE)
       ) units ON TRUE
      WHERE i.company_id=$1 AND i.is_active=TRUE
      GROUP BY i.id,u.code,u.name ORDER BY i.name,i.sku`, [companyId]
  );
  return { data: result.rows };
}

export async function createSupplier({ companyId, userId, body }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO gcims.suppliers
        (company_id,code,name,contact_name,email,phone,address,payment_terms,default_lead_time_days,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       RETURNING *`,
      [companyId, body.code, body.name, body.contact_name ?? null, body.email ?? null,
       body.phone ?? null, body.address ?? null, body.payment_terms ?? null, body.default_lead_time_days ?? null]
    );
    const supplier = result.rows[0];
    await writeAudit(client, { companyId, userId, action: 'procurement.supplier.created', entityType: 'supplier', entityId: supplier.id, afterData: { code: supplier.code, name: supplier.name } });
    return supplier;
  });
}

export async function updateSupplier({ companyId, userId, supplierId, body }) {
  const result = await withTransaction(async (client) => {
    const current = await client.query('SELECT * FROM gcims.suppliers WHERE company_id=$1 AND id=$2 FOR UPDATE', [companyId, supplierId]);
    if (!current.rowCount) throw notFound('Supplier tidak ditemukan.');
    const old = current.rows[0];
    const next = {
      code: body.code ?? old.code,
      name: body.name ?? old.name,
      contact_name: body.contact_name === undefined ? old.contact_name : body.contact_name,
      email: body.email === undefined ? old.email : body.email,
      phone: body.phone === undefined ? old.phone : body.phone,
      address: body.address === undefined ? old.address : body.address,
      payment_terms: body.payment_terms === undefined ? old.payment_terms : body.payment_terms,
      default_lead_time_days: body.default_lead_time_days === undefined ? old.default_lead_time_days : body.default_lead_time_days,
      is_active: body.is_active === undefined ? old.is_active : body.is_active
    };
    const updated = await client.query(
      `UPDATE gcims.suppliers SET code=$3,name=$4,contact_name=$5,email=$6,phone=$7,address=$8,
         payment_terms=$9,default_lead_time_days=$10,is_active=$11,updated_at=now()
       WHERE company_id=$1 AND id=$2 RETURNING *`,
      [companyId, supplierId, next.code, next.name, next.contact_name, next.email, next.phone,
       next.address, next.payment_terms, next.default_lead_time_days, next.is_active]
    );
    await writeAudit(client, { companyId, userId, action: 'procurement.supplier.updated', entityType: 'supplier', entityId: supplierId, beforeData: { code: old.code, name: old.name, is_active: old.is_active }, afterData: { code: next.code, name: next.name, is_active: next.is_active } });
    return updated.rows[0];
  });
  return result;
}

export async function listSupplierItems({ companyId, supplierId }) {
  const supplier = await pool.query('SELECT id,name FROM gcims.suppliers WHERE company_id=$1 AND id=$2', [companyId, supplierId]);
  if (!supplier.rowCount) throw notFound('Supplier tidak ditemukan.');
  const result = await pool.query(
    `SELECT sii.id,sii.supplier_id,sii.inventory_item_id,i.sku,i.name AS inventory_item_name,
            sii.supplier_sku,sii.purchase_uom_id,u.code AS purchase_uom_code,u.name AS purchase_uom_name,
            sii.default_unit_price,sii.minimum_order_qty::numeric(18,6)::text AS minimum_order_qty,
            sii.lead_time_days,sii.is_preferred,sii.is_active
       FROM gcims.supplier_inventory_items sii
       JOIN gcims.inventory_items i ON i.company_id=sii.company_id AND i.id=sii.inventory_item_id
       JOIN gcims.uoms u ON u.id=sii.purchase_uom_id
      WHERE sii.company_id=$1 AND sii.supplier_id=$2
      ORDER BY i.name,i.sku`, [companyId, supplierId]
  );
  return { supplier: supplier.rows[0], data: result.rows };
}

export async function upsertSupplierItem({ companyId, supplierId, inventoryItemId, userId, body }) {
  return withTransaction(async (client) => {
    const supplier = await client.query('SELECT id,is_active FROM gcims.suppliers WHERE company_id=$1 AND id=$2 FOR SHARE', [companyId, supplierId]);
    if (!supplier.rowCount || !supplier.rows[0].is_active) throw notFound('Supplier tidak ditemukan atau tidak aktif.');
    const item = await client.query('SELECT id,base_uom_id FROM gcims.inventory_items WHERE company_id=$1 AND id=$2 AND is_active=TRUE', [companyId, inventoryItemId]);
    if (!item.rowCount) throw notFound('Inventory item tidak ditemukan atau tidak aktif.');
    await getPurchaseUomFactor(client, { companyId, inventoryItemId, purchaseUomId: body.purchase_uom_id, baseUomId: item.rows[0].base_uom_id });
    if (body.is_preferred ?? false) {
      await client.query(
        `UPDATE gcims.supplier_inventory_items SET is_preferred=FALSE
          WHERE company_id=$1 AND inventory_item_id=$2 AND supplier_id<>$3 AND is_preferred=TRUE`,
        [companyId, inventoryItemId, supplierId]
      );
    }
    const result = await client.query(
      `INSERT INTO gcims.supplier_inventory_items
        (company_id,supplier_id,inventory_item_id,supplier_sku,purchase_uom_id,default_unit_price,minimum_order_qty,lead_time_days,is_preferred,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (supplier_id,inventory_item_id) DO UPDATE SET
         supplier_sku=EXCLUDED.supplier_sku,purchase_uom_id=EXCLUDED.purchase_uom_id,
         default_unit_price=EXCLUDED.default_unit_price,minimum_order_qty=EXCLUDED.minimum_order_qty,
         lead_time_days=EXCLUDED.lead_time_days,is_preferred=EXCLUDED.is_preferred,is_active=EXCLUDED.is_active
       RETURNING *`,
      [companyId, supplierId, inventoryItemId, body.supplier_sku ?? null, body.purchase_uom_id,
       body.default_unit_price ?? null, body.minimum_order_qty ?? null, body.lead_time_days ?? null,
       body.is_preferred ?? false, body.is_active ?? true]
    );
    await writeAudit(client, { companyId, userId, action: 'procurement.supplier_item.upserted', entityType: 'supplier_inventory_item', entityId: result.rows[0].id, afterData: { supplier_id: supplierId, inventory_item_id: inventoryItemId, purchase_uom_id: body.purchase_uom_id } });
    return result.rows[0];
  });
}

async function loadPurchaseOrder(client, { companyId, outletId, poId, forUpdate = false }) {
  const result = await client.query(
    `SELECT po.*,s.code AS supplier_code,s.name AS supplier_name
       FROM gcims.purchase_orders po
       JOIN gcims.suppliers s ON s.company_id=po.company_id AND s.id=po.supplier_id
      WHERE po.company_id=$1 AND po.outlet_id=$2 AND po.id=$3 ${forUpdate ? 'FOR UPDATE OF po' : ''}`,
    [companyId, outletId, poId]
  );
  if (!result.rowCount) throw notFound('Purchase order tidak ditemukan.');
  return result.rows[0];
}

export async function getPurchaseOrder({ companyId, outletId, poId }) {
  const po = await loadPurchaseOrder(pool, { companyId, outletId, poId });
  const lines = await pool.query(
    `SELECT poi.*,i.sku,u.code AS purchase_uom_code,u.name AS purchase_uom_name,
            COALESCE(received.received_qty,0)::numeric(18,6)::text AS quantity_received_purchase_uom,
            GREATEST(poi.quantity_ordered-COALESCE(received.received_qty,0),0)::numeric(18,6)::text AS quantity_outstanding_purchase_uom
       FROM gcims.purchase_order_items poi
       JOIN gcims.inventory_items i ON i.company_id=poi.company_id AND i.id=poi.inventory_item_id
       JOIN gcims.uoms u ON u.id=poi.purchase_uom_id
       LEFT JOIN LATERAL (
         SELECT SUM(gri.quantity_received_purchase_uom) AS received_qty
           FROM gcims.goods_receipt_items gri
           JOIN gcims.goods_receipts gr ON gr.company_id=gri.company_id AND gr.id=gri.goods_receipt_id
          WHERE gri.company_id=poi.company_id AND gri.purchase_order_item_id=poi.id AND gr.status='posted'
       ) received ON TRUE
      WHERE poi.company_id=$1 AND poi.purchase_order_id=$2
      ORDER BY poi.line_no`, [companyId, poId]
  );
  return { ...po, items: lines.rows };
}

export async function listPurchaseOrders({ companyId, outletId, status, supplierId, limit = 50 }) {
  const result = await pool.query(
    `SELECT po.id,po.po_number,po.status,po.ordered_at,po.expected_at,po.total_amount,po.currency_code,
            s.id AS supplier_id,s.code AS supplier_code,s.name AS supplier_name,
            COALESCE(received.received_lines,0)::integer AS received_lines
       FROM gcims.purchase_orders po
       JOIN gcims.suppliers s ON s.company_id=po.company_id AND s.id=po.supplier_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS received_lines FROM gcims.goods_receipts gr
          WHERE gr.company_id=po.company_id AND gr.purchase_order_id=po.id AND gr.status='posted'
       ) received ON TRUE
      WHERE po.company_id=$1 AND po.outlet_id=$2
        AND ($3::text IS NULL OR po.status=$3)
        AND ($4::uuid IS NULL OR po.supplier_id=$4)
      ORDER BY po.created_at DESC,po.id DESC LIMIT $5`,
    [companyId, outletId, status ?? null, supplierId ?? null, limit]
  );
  return { data: result.rows };
}

export async function createPurchaseOrder({ companyId, outletId, userId, idempotencyKey, body }) {
  requireIdempotencyKey(idempotencyKey, 'purchase order');
  const hash = requestHash(body);
  const created = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`po:${companyId}:${outletId}:${idempotencyKey}`]);
    const existing = await client.query(
      `SELECT id,idempotency_request_hash FROM gcims.purchase_orders
        WHERE company_id=$1 AND outlet_id=$2 AND idempotency_key=$3`, [companyId,outletId,idempotencyKey]
    );
    if (existing.rowCount) {
      if (existing.rows[0].idempotency_request_hash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key purchase order sudah digunakan untuk payload berbeda.');
      return { id: existing.rows[0].id, replay: true };
    }
    const supplier = await client.query('SELECT id FROM gcims.suppliers WHERE company_id=$1 AND id=$2 AND is_active=TRUE', [companyId, body.supplier_id]);
    if (!supplier.rowCount) throw unprocessable('SUPPLIER_NOT_ACTIVE', 'Supplier tidak ditemukan atau tidak aktif.');

    const normalized = [];
    for (const line of body.lines) {
      const item = await client.query(
        `SELECT i.id,i.sku,i.name,i.base_uom_id,i.is_active,bu.code AS base_uom_code
           FROM gcims.inventory_items i JOIN gcims.uoms bu ON bu.id=i.base_uom_id
          WHERE i.company_id=$1 AND i.id=$2 AND i.is_active=TRUE`, [companyId,line.inventory_item_id]
      );
      if (!item.rowCount) throw unprocessable('INVENTORY_ITEM_NOT_ACTIVE', 'Item inventori tidak ditemukan atau tidak aktif.');
      const catalog = await client.query(
        `SELECT purchase_uom_id,default_unit_price,minimum_order_qty,is_active
           FROM gcims.supplier_inventory_items
          WHERE company_id=$1 AND supplier_id=$2 AND inventory_item_id=$3`,
        [companyId,body.supplier_id,line.inventory_item_id]
      );
      if (!catalog.rowCount || !catalog.rows[0].is_active) throw unprocessable('SUPPLIER_ITEM_NOT_ACTIVE', `Item ${item.rows[0].sku} belum terdaftar aktif pada katalog supplier.`);
      const supplierItem = catalog.rows[0];
      const purchaseUomId = line.purchase_uom_id ?? supplierItem.purchase_uom_id;
      if (purchaseUomId !== supplierItem.purchase_uom_id) throw unprocessable('SUPPLIER_PURCHASE_UOM_MISMATCH', `UOM pembelian untuk ${item.rows[0].sku} harus sesuai katalog supplier.`);
      const factor = await getPurchaseUomFactor(client, { companyId, inventoryItemId: line.inventory_item_id, purchaseUomId, baseUomId: item.rows[0].base_uom_id });
      const price = line.unit_price_purchase_uom ?? supplierItem.default_unit_price;
      if (price === null || price === undefined) throw unprocessable('SUPPLIER_PRICE_REQUIRED', `Harga supplier untuk ${item.rows[0].sku} belum tersedia.`);
      const minQty = supplierItem.minimum_order_qty;
      if (minQty !== null && minQty !== undefined) {
        const qtyUnits = decimalToUnits(line.quantity, 6);
        const minUnits = decimalToUnits(String(minQty), 6);
        if (qtyUnits < minUnits) throw unprocessable('MINIMUM_ORDER_QTY_NOT_MET', `Kuantitas ${item.rows[0].sku} di bawah minimum order supplier.`);
      }
      const baseQty = quantityBaseFromFactor(line.quantity, factor);
      normalized.push({
        ...line, purchase_uom_id: purchaseUomId, unit_price_purchase_uom: parsePositiveInteger(price, 'Harga satuan supplier tidak valid.', true),
        base_qty_per_purchase_unit: factor, quantity_ordered_base: baseQty,
        description_snapshot: item.rows[0].name
      });
    }
    const totals = computePurchaseOrderTotals(normalized, { taxAmount: body.tax_amount ?? 0, shippingAmount: body.shipping_amount ?? 0 });
    const poNumber = makeDocumentNumber('PO');
    const header = await client.query(
      `INSERT INTO gcims.purchase_orders
        (company_id,outlet_id,po_number,supplier_id,status,expected_at,currency_code,
         subtotal_amount,discount_amount,tax_amount,shipping_amount,total_amount,notes,created_by,
         idempotency_key,idempotency_request_hash)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [companyId,outletId,poNumber,body.supplier_id,body.expected_at ?? null,
       body.currency_code ?? 'IDR',totals.subtotal_amount,totals.discount_amount,totals.tax_amount,
       totals.shipping_amount,totals.total_amount,body.notes ?? null,userId,idempotencyKey,hash]
    );
    const poId = header.rows[0].id;
    for (let index = 0; index < totals.lines.length; index += 1) {
      const line = totals.lines[index];
      await client.query(
        `INSERT INTO gcims.purchase_order_items
          (company_id,purchase_order_id,line_no,inventory_item_id,description_snapshot,purchase_uom_id,
           quantity_ordered,base_qty_per_purchase_unit,quantity_ordered_base,unit_price_purchase_uom,
           discount_amount,line_total_amount,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [companyId,poId,index+1,line.inventory_item_id,line.description_snapshot,line.purchase_uom_id,
         line.quantity,line.base_qty_per_purchase_unit,line.quantity_ordered_base,line.unit_price_purchase_uom,
         line.discount_amount,line.line_total_amount,line.notes ?? null]
      );
    }
    await writeAudit(client, { companyId,outletId,userId,action:'procurement.po.created',entityType:'purchase_order',entityId:poId,afterData:{supplier_id:body.supplier_id,po_number:poNumber,total_amount:totals.total_amount,line_count:totals.lines.length} });
    return { id:poId,replay:false };
  });
  return { purchaseOrder: await getPurchaseOrder({ companyId,outletId,poId:created.id }), replay: created.replay };
}

export async function transitionPurchaseOrder({ companyId, outletId, poId, userId, action }) {
  await withTransaction(async (client) => {
    const po = await loadPurchaseOrder(client,{companyId,outletId,poId,forUpdate:true});
    const nextStatus = nextPurchaseOrderStatus(po.status,action);
    if (action === 'approve') assertMakerChecker(po.created_by, userId, 'Purchase order');
    if (action === 'cancel') {
      const receipts = await client.query("SELECT 1 FROM gcims.goods_receipts WHERE company_id=$1 AND purchase_order_id=$2 AND status IN ('draft','submitted','approved','posted') LIMIT 1",[companyId,poId]);
      if (receipts.rowCount) throw conflict('PO_HAS_RECEIVING_ACTIVITY','Purchase order dengan goods receipt draft, submitted, approved, atau posted tidak dapat dibatalkan.');
    }
    const updated = await client.query(
      `UPDATE gcims.purchase_orders
          SET status=$3,
              approved_by=CASE WHEN $4::text='approve' THEN $5::uuid ELSE approved_by END,
              ordered_at=CASE WHEN $4::text='send' THEN COALESCE(ordered_at,now()) ELSE ordered_at END,
              updated_at=now()
        WHERE company_id=$1 AND outlet_id=$2 AND id=$6
        RETURNING status,po_number`,
      [companyId,outletId,nextStatus,action,userId,poId]
    );
    const auditAction = ({ submit:'submitted', approve:'approved', send:'sent', cancel:'cancelled', close:'closed' })[action];
    await writeAudit(client,{companyId,outletId,userId,action:`procurement.po.${auditAction}`,entityType:'purchase_order',entityId:poId,beforeData:{status:po.status},afterData:{status:updated.rows[0].status}});
  });
  return getPurchaseOrder({companyId,outletId,poId});
}

export async function createGoodsReceipt({ companyId,outletId,userId,poId,idempotencyKey,body }) {
  requireIdempotencyKey(idempotencyKey,'goods receipt');
  // The same receipt payload can be valid for different PO lines. Scope the
  // idempotency fingerprint to the parent PO so a retry cannot replay a GR
  // created for another order in the same outlet.
  const hash=requestHash({ poId, body });
  const created=await withTransaction(async(client)=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`gr:${companyId}:${outletId}:${idempotencyKey}`]);
    const existing=await client.query(`SELECT id,idempotency_request_hash FROM gcims.goods_receipts WHERE company_id=$1 AND outlet_id=$2 AND idempotency_key=$3`,[companyId,outletId,idempotencyKey]);
    if(existing.rowCount){
      if(existing.rows[0].idempotency_request_hash!==hash) throw conflict('IDEMPOTENCY_KEY_REUSED','Idempotency-Key goods receipt sudah digunakan untuk payload berbeda.');
      return {id:existing.rows[0].id,replay:true};
    }
    const po=await loadPurchaseOrder(client,{companyId,outletId,poId,forUpdate:true});
    if(!['sent','partially_received'].includes(po.status)) throw conflict('PO_NOT_RECEIVABLE',`Purchase order berstatus '${po.status}' belum dapat menerima barang.`);
    const location=await client.query('SELECT id FROM gcims.stock_locations WHERE company_id=$1 AND outlet_id=$2 AND id=$3 AND is_active=TRUE',[companyId,outletId,body.stock_location_id]);
    if(!location.rowCount) throw unprocessable('INVALID_STOCK_LOCATION','Stock location tidak aktif atau bukan milik outlet ini.');
    const receipt=await client.query(
      `INSERT INTO gcims.goods_receipts
        (company_id,outlet_id,purchase_order_id,receipt_number,status,received_at,supplier_document_no,notes,received_by,idempotency_key,idempotency_request_hash)
       VALUES ($1,$2,$3,$4,'draft',COALESCE($5::timestamptz,now()),$6,$7,$8,$9,$10)
       RETURNING id`,
      [companyId,outletId,poId,makeDocumentNumber('GR'),body.received_at??null,body.supplier_document_no??null,body.notes??null,userId,idempotencyKey,hash]
    );
    const receiptId=receipt.rows[0].id;
    const seen=new Set();
    for(const input of body.lines){
      if(seen.has(input.purchase_order_item_id)) throw badRequest('Satu PO line hanya boleh muncul satu kali dalam satu goods receipt.');
      seen.add(input.purchase_order_item_id);
      const poLine=await client.query(
        `SELECT poi.id,poi.inventory_item_id,poi.quantity_ordered,poi.base_qty_per_purchase_unit::numeric(18,8)::text AS conversion_factor,
                poi.unit_price_purchase_uom,i.sku,i.name,i.track_lot,i.track_expiry
           FROM gcims.purchase_order_items poi
           JOIN gcims.inventory_items i ON i.company_id=poi.company_id AND i.id=poi.inventory_item_id
          WHERE poi.company_id=$1 AND poi.purchase_order_id=$2 AND poi.id=$3`,
        [companyId,poId,input.purchase_order_item_id]
      );
      if(!poLine.rowCount) throw unprocessable('PO_LINE_NOT_IN_ORDER','Baris item tidak termasuk purchase order ini.');
      const line=poLine.rows[0];
      const rejected=input.quantity_rejected??'0';
      const acceptedQty=acceptedPurchaseQuantity(input.quantity_received,rejected);
      if(Number(acceptedQty)>0 && line.track_lot && !input.lot_code) throw unprocessable('RECEIVED_LOT_CODE_REQUIRED',`Kode lot wajib untuk item ${line.sku}.`);
      if(Number(acceptedQty)>0 && line.track_expiry && !input.expiry_date) throw unprocessable('RECEIVED_EXPIRY_REQUIRED',`Tanggal kedaluwarsa wajib untuk item ${line.sku}.`);
      if(!line.track_lot && (input.lot_code || input.expiry_date || input.supplier_lot_code)) throw unprocessable('LOT_NOT_TRACKED',`Item ${line.sku} tidak menggunakan pelacakan lot.`);
      if(Number(rejected)>0 && !input.rejection_reason?.trim()) throw unprocessable('REJECTION_REASON_REQUIRED','Alasan penolakan wajib diisi jika ada kuantitas ditolak.');
      const acceptedBaseStored=acceptedQty==='0.000000'?'0.000000':quantityBaseFromFactor(acceptedQty,line.conversion_factor);
      const baseCost=unitCostBaseAmount(line.unit_price_purchase_uom,line.conversion_factor);
      await client.query(
        `INSERT INTO gcims.goods_receipt_items
          (company_id,goods_receipt_id,outlet_id,purchase_order_id,purchase_order_item_id,stock_location_id,inventory_item_id,
           quantity_received_purchase_uom,quantity_rejected_purchase_uom,base_qty_per_purchase_unit,quantity_accepted_base,
           unit_cost_base_amount,rejection_reason,notes,received_lot_code,supplier_lot_code,manufactured_at,expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [companyId,receiptId,outletId,poId,input.purchase_order_item_id,body.stock_location_id,line.inventory_item_id,
         input.quantity_received,rejected,line.conversion_factor,acceptedBaseStored,baseCost,input.rejection_reason??null,input.notes??null,
         input.lot_code??null,input.supplier_lot_code??null,input.manufactured_at??null,input.expiry_date??null]
      );
    }
    await writeAudit(client,{companyId,outletId,userId,action:'procurement.receipt.created',entityType:'goods_receipt',entityId:receiptId,afterData:{po_id:poId,line_count:body.lines.length}});
    return {id:receiptId,replay:false};
  });
  return {goodsReceipt:await getGoodsReceipt({companyId,outletId,receiptId:created.id}),replay:created.replay};
}

export async function listGoodsReceipts({companyId,outletId,status,poId,limit=50}){
  const result=await pool.query(
    `SELECT gr.id,gr.receipt_number,gr.status,gr.received_at,gr.supplier_document_no,gr.purchase_order_id,po.po_number,
            COUNT(gri.id)::integer AS line_count,COALESCE(SUM(gri.quantity_accepted_base),0)::numeric(18,6)::text AS accepted_base_total
       FROM gcims.goods_receipts gr JOIN gcims.purchase_orders po ON po.company_id=gr.company_id AND po.id=gr.purchase_order_id
       LEFT JOIN gcims.goods_receipt_items gri ON gri.company_id=gr.company_id AND gri.goods_receipt_id=gr.id
      WHERE gr.company_id=$1 AND gr.outlet_id=$2 AND ($3::text IS NULL OR gr.status=$3) AND ($4::uuid IS NULL OR gr.purchase_order_id=$4)
      GROUP BY gr.id,po.po_number ORDER BY gr.received_at DESC,gr.id DESC LIMIT $5`,
    [companyId,outletId,status??null,poId??null,limit]
  );
  return {data:result.rows};
}

export async function getGoodsReceipt({companyId,outletId,receiptId}){
  const header=await pool.query(
    `SELECT gr.*,po.po_number,po.supplier_id,s.name AS supplier_name
       FROM gcims.goods_receipts gr JOIN gcims.purchase_orders po ON po.company_id=gr.company_id AND po.outlet_id=gr.outlet_id AND po.id=gr.purchase_order_id
       JOIN gcims.suppliers s ON s.company_id=po.company_id AND s.id=po.supplier_id
      WHERE gr.company_id=$1 AND gr.outlet_id=$2 AND gr.id=$3`,[companyId,outletId,receiptId]);
  if(!header.rowCount) throw notFound('Goods receipt tidak ditemukan.');
  const lines=await pool.query(
    `SELECT gri.*,i.sku,i.name AS inventory_item_name,poi.line_no,poi.quantity_ordered,poi.purchase_uom_id,u.code AS purchase_uom_code,
            l.lot_code,l.expiry_date AS lot_expiry_date
       FROM gcims.goods_receipt_items gri
       JOIN gcims.inventory_items i ON i.company_id=gri.company_id AND i.id=gri.inventory_item_id
       JOIN gcims.purchase_order_items poi ON poi.company_id=gri.company_id AND poi.purchase_order_id=gri.purchase_order_id AND poi.id=gri.purchase_order_item_id
       JOIN gcims.uoms u ON u.id=poi.purchase_uom_id
       LEFT JOIN gcims.inventory_lots l ON l.company_id=gri.company_id AND l.id=gri.lot_id
      WHERE gri.company_id=$1 AND gri.goods_receipt_id=$2 ORDER BY poi.line_no,gri.id`,[companyId,receiptId]);
  return {...header.rows[0],items:lines.rows};
}

export async function deleteDraftGoodsReceipt({companyId,outletId,receiptId,userId}){
  return withTransaction(async(client)=>{
    const result=await client.query(`SELECT * FROM gcims.goods_receipts WHERE company_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE`,[companyId,outletId,receiptId]);
    if(!result.rowCount)throw notFound('Goods receipt tidak ditemukan.');
    const receipt=result.rows[0];
    if(receipt.status!=='draft')throw conflict('GOODS_RECEIPT_NOT_DRAFT','Hanya penerimaan berstatus draft yang dapat dihapus.');
    const count=await client.query('SELECT COUNT(*)::integer AS line_count FROM gcims.goods_receipt_items WHERE company_id=$1 AND goods_receipt_id=$2',[companyId,receiptId]);
    await client.query('DELETE FROM gcims.goods_receipt_items WHERE company_id=$1 AND goods_receipt_id=$2',[companyId,receiptId]);
    await client.query('DELETE FROM gcims.goods_receipts WHERE company_id=$1 AND outlet_id=$2 AND id=$3',[companyId,outletId,receiptId]);
    await writeAudit(client,{companyId,outletId,userId,action:'procurement.receipt.draft_deleted',entityType:'goods_receipt',entityId:receiptId,beforeData:{receipt_number:receipt.receipt_number,status:receipt.status,line_count:count.rows[0].line_count}});
    return {deleted:true,receipt_number:receipt.receipt_number};
  });
}

export async function transitionGoodsReceipt({companyId,outletId,receiptId,userId,action,reason}){
  const result=await withTransaction(async(client)=>{
    const headerResult=await client.query('SELECT * FROM gcims.goods_receipts WHERE company_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE',[companyId,outletId,receiptId]);
    if(!headerResult.rowCount) throw notFound('Goods receipt tidak ditemukan.');
    const gr=headerResult.rows[0];
    if(action==='post' && gr.status==='posted') return {replay:true};
    const nextStatus=nextGoodsReceiptStatus(gr.status,action);
    if(action==='approve') assertMakerChecker(gr.received_by, userId, 'Goods receipt');
    let postMetadata = null;
    if(action==='submit'){
      const lineCount=await client.query('SELECT COUNT(*)::integer AS count FROM gcims.goods_receipt_items WHERE company_id=$1 AND goods_receipt_id=$2',[companyId,receiptId]);
      if(!lineCount.rows[0].count) throw unprocessable('EMPTY_GOODS_RECEIPT','Goods receipt tidak memiliki baris barang.');
    }
    if(action==='approve'){
      await client.query(`UPDATE gcims.goods_receipts SET status=$3,approved_by=$4 WHERE company_id=$1 AND id=$2`,[companyId,receiptId,nextStatus,userId]);
    } else if(action==='reject'){
      await client.query(`UPDATE gcims.goods_receipts SET status=$3 WHERE company_id=$1 AND id=$2`,[companyId,receiptId,nextStatus]);
    } else if(action==='submit'){
      await client.query(`UPDATE gcims.goods_receipts SET status=$3 WHERE company_id=$1 AND id=$2`,[companyId,receiptId,nextStatus]);
    } else if(action==='post'){
      const po=await loadPurchaseOrder(client,{companyId,outletId,poId:gr.purchase_order_id,forUpdate:true});
      if(!['sent','partially_received'].includes(po.status)) throw conflict('PO_NOT_RECEIVABLE','Purchase order tidak berada pada status yang dapat menerima barang.');
      const items=await client.query(
        `SELECT gri.*,poi.quantity_ordered,poi.unit_price_purchase_uom,ii.track_lot,ii.track_expiry,ii.sku,
                oi.timezone_name
           FROM gcims.goods_receipt_items gri
           JOIN gcims.purchase_order_items poi ON poi.company_id=gri.company_id AND poi.purchase_order_id=gri.purchase_order_id AND poi.id=gri.purchase_order_item_id
           JOIN gcims.inventory_items ii ON ii.company_id=gri.company_id AND ii.id=gri.inventory_item_id
           JOIN gcims.outlets oi ON oi.company_id=gri.company_id AND oi.id=gri.outlet_id
          WHERE gri.company_id=$1 AND gri.goods_receipt_id=$2
          ORDER BY gri.inventory_item_id,gri.id`,[companyId,receiptId]);
      if(!items.rowCount) throw unprocessable('EMPTY_GOODS_RECEIPT','Goods receipt tidak memiliki baris barang.');
      const itemIds=[...new Set(items.rows.map((x)=>x.inventory_item_id))].sort();
      await client.query('SELECT id FROM gcims.inventory_items WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[companyId,itemIds]);
      const grouped=new Map();
      for(const line of items.rows){
        const key=line.purchase_order_item_id;
        grouped.set(key,(grouped.get(key)??0n)+decimalToUnits(line.quantity_received_purchase_uom,6));
      }
      for(const [poLineId,currentQtyUnits] of grouped){
        const ordered=await client.query('SELECT quantity_ordered::numeric(18,6)::text AS quantity_ordered FROM gcims.purchase_order_items WHERE company_id=$1 AND purchase_order_id=$2 AND id=$3 FOR UPDATE',[companyId,gr.purchase_order_id,poLineId]);
        const prior=await client.query(
          `SELECT COALESCE(SUM(gri.quantity_received_purchase_uom),0)::numeric(18,6)::text AS received
             FROM gcims.goods_receipt_items gri JOIN gcims.goods_receipts oldgr ON oldgr.company_id=gri.company_id AND oldgr.id=gri.goods_receipt_id
            WHERE gri.company_id=$1 AND gri.purchase_order_id=$2 AND gri.purchase_order_item_id=$3 AND oldgr.status='posted'`,
          [companyId,gr.purchase_order_id,poLineId]);
        const orderedUnits=decimalToUnits(ordered.rows[0].quantity_ordered,6);
        const alreadyUnits=decimalToUnits(prior.rows[0].received,6,{allowZero:true});
        if(alreadyUnits+currentQtyUnits>orderedUnits) throw conflict('PO_OVER_RECEIVED',`Penerimaan kumulatif melebihi kuantitas PO untuk line ${poLineId}.`);
      }
      for(const line of items.rows){
        let lotId=null;
        if(line.track_lot && Number(line.quantity_accepted_base)>0){
          if(!line.received_lot_code) throw unprocessable('RECEIVED_LOT_CODE_REQUIRED',`Kode lot wajib untuk item ${line.sku}.`);
          if(line.track_expiry && !line.expiry_date) throw unprocessable('RECEIVED_EXPIRY_REQUIRED',`Tanggal kedaluwarsa wajib untuk item ${line.sku}.`);
          if(line.expiry_date){
            const expiry=await client.query(`SELECT $1::date >= (now() AT TIME ZONE $2)::date AS valid`,[line.expiry_date,line.timezone_name]);
            if(!expiry.rows[0].valid) throw unprocessable('RECEIVED_LOT_ALREADY_EXPIRED',`Lot ${line.received_lot_code} sudah kedaluwarsa saat penerimaan.`);
          }
          const existing=await client.query(
            `SELECT id,supplier_id,supplier_lot_code,manufactured_at,expiry_date
               FROM gcims.inventory_lots WHERE company_id=$1 AND inventory_item_id=$2 AND stock_location_id=$3 AND lot_code=$4 FOR UPDATE`,
            [companyId,line.inventory_item_id,line.stock_location_id,line.received_lot_code]);
          if(existing.rowCount){
            const old=existing.rows[0];
            if(old.supplier_id!==po.supplier_id || old.supplier_lot_code!==(line.supplier_lot_code??null) || String(old.manufactured_at??'')!==String(line.manufactured_at??'') || String(old.expiry_date??'')!==String(line.expiry_date??'')){
              throw conflict('LOT_METADATA_MISMATCH','Kode lot sudah ada dengan supplier atau tanggal batch yang berbeda.');
            }
            lotId=old.id;
          }else{
            const createdLot=await client.query(
              `INSERT INTO gcims.inventory_lots
                (company_id,inventory_item_id,stock_location_id,supplier_id,lot_code,supplier_lot_code,received_at,manufactured_at,expiry_date,unit_cost_base_amount,notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
              [companyId,line.inventory_item_id,line.stock_location_id,po.supplier_id,line.received_lot_code,line.supplier_lot_code??null,
               gr.received_at,line.manufactured_at??null,line.expiry_date??null,line.unit_cost_base_amount,line.notes??null]);
            lotId=createdLot.rows[0].id;
          }
        }
        if(Number(line.quantity_accepted_base)>0){
          await client.query(
            `INSERT INTO gcims.stock_ledger
              (company_id,outlet_id,stock_location_id,inventory_item_id,lot_id,movement_type,quantity_delta_base,
               occurred_at,source_type,source_id,source_line_id,source_line_sequence,idempotency_key,reason,actor_user_id)
             VALUES ($1,$2,$3,$4,$5,'goods_receipt',$6,$7,'goods_receipt',$8,$9,1,$10,$11,$12)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [companyId,outletId,line.stock_location_id,line.inventory_item_id,lotId,line.quantity_accepted_base,gr.received_at,
             receiptId,line.id,`goods-receipt:${receiptId}:${line.id}`,`Penerimaan PO ${po.po_number}`,userId]);
        }
        if (line.lot_id && line.lot_id !== lotId) {
          throw conflict('RECEIPT_LOT_LINK_MISMATCH', 'Lot pada baris goods receipt tidak sesuai dengan lot hasil posting.');
        }
        if (!line.lot_id && lotId) {
          await client.query("SELECT set_config('gcims.allow_goods_receipt_lot_link','on',true)");
          await client.query('UPDATE gcims.goods_receipt_items SET lot_id=$3 WHERE company_id=$1 AND id=$2',[companyId,line.id,lotId]);
        }
      }
      await client.query("SELECT set_config('gcims.allow_goods_receipt_lot_link','off',true)");
      await client.query(`UPDATE gcims.goods_receipts SET status='posted',posted_at=now() WHERE company_id=$1 AND id=$2`,[companyId,receiptId]);
      const summary=await client.query(
        `SELECT COALESCE(SUM(poi.quantity_ordered),0)::numeric(18,6)::text AS ordered,
                COALESCE(SUM(received.received_qty),0)::numeric(18,6)::text AS received
           FROM gcims.purchase_order_items poi
           LEFT JOIN LATERAL (
             SELECT SUM(gri.quantity_received_purchase_uom) AS received_qty
               FROM gcims.goods_receipt_items gri JOIN gcims.goods_receipts gr2 ON gr2.company_id=gri.company_id AND gr2.id=gri.goods_receipt_id
              WHERE gri.company_id=poi.company_id AND gri.purchase_order_id=poi.purchase_order_id AND gri.purchase_order_item_id=poi.id AND gr2.status='posted'
           ) received ON TRUE
          WHERE poi.company_id=$1 AND poi.purchase_order_id=$2`,[companyId,gr.purchase_order_id]);
      const receivedUnits=decimalToUnits(summary.rows[0].received,6,{allowZero:true});
      const orderedUnits=decimalToUnits(summary.rows[0].ordered,6,{allowZero:true});
      const poStatus=receivedUnits>=orderedUnits?'fully_received':'partially_received';
      await client.query('UPDATE gcims.purchase_orders SET status=$3,updated_at=now() WHERE company_id=$1 AND id=$2',[companyId,gr.purchase_order_id,poStatus]);
      await writeAudit(client,{companyId,outletId,userId,action:'procurement.po.receiving_progress',entityType:'purchase_order',entityId:gr.purchase_order_id,beforeData:{status:po.status},afterData:{status:poStatus,received_quantity:summary.rows[0].received,ordered_quantity:summary.rows[0].ordered}});
      postMetadata={stock_ledger_movements:items.rows.filter((x)=>Number(x.quantity_accepted_base)>0).length,po_status:poStatus};
    }
    const receiptAuditAction = ({ submit:'submitted', approve:'approved', reject:'rejected', post:'posted' })[action];
    await writeAudit(client,{companyId,outletId,userId,action:`procurement.receipt.${receiptAuditAction}`,entityType:'goods_receipt',entityId:receiptId,beforeData:{status:gr.status},afterData:{status:nextStatus,...(postMetadata??{})},reason:reason??null});
    return {replay:false};
  });
  return {goodsReceipt:await getGoodsReceipt({companyId,outletId,receiptId}),replay:result.replay};
}

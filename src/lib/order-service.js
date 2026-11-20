import { withTransaction, pool } from './db.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from './errors.js';
import { makeDocumentNumber, requestHash } from './ids.js';
import { formatMilli, lineGrossAmount, quantityToMilli, taxAmount, safeInteger } from './money.js';

async function resolveTaxRate(client, companyId, outletId) {
  const result = await client.query(
    `SELECT setting_value
       FROM gcims.system_settings
      WHERE company_id = $1 AND setting_key = 'pos.tax_rate'
        AND (outlet_id = $2 OR outlet_id IS NULL)
      ORDER BY (outlet_id IS NOT NULL) DESC
      LIMIT 1`, [companyId, outletId]
  );
  if (!result.rowCount) return 0;
  const raw = result.rows[0].setting_value;
  const value = typeof raw === 'number' ? raw : Number(raw?.rate ?? raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw unprocessable('INVALID_TAX_CONFIGURATION', 'Konfigurasi pos.tax_rate harus berupa rasio 0 sampai 1, misalnya 0.1 untuk 10%.');
  }
  return value;
}

async function getVariantForOutlet(client, companyId, outletId, variantId) {
  const result = await client.query(
    `SELECT mv.id, mv.code, mv.name AS variant_name,
            m.id AS menu_id, m.name AS menu_name, m.description, m.image_url,
            mv.product_type,mv.retail_inventory_item_id,mv.retail_quantity_base::text AS retail_quantity_base,
            retail_item.name AS retail_item_name,retail_item.sku AS retail_item_sku,
            retail_uom.code AS retail_item_uom_code,retail_item.is_active AS retail_item_active,
            COALESCE(omv.price_amount, mv.price_amount) AS price_amount,
            COALESCE(omv.is_available, TRUE) AS is_available,
            r.id AS recipe_id, rv.id AS recipe_version_id
       FROM gcims.menu_variants mv
       JOIN gcims.menus m ON m.id = mv.menu_id AND m.company_id = mv.company_id
       LEFT JOIN gcims.outlet_menu_variants omv
         ON omv.company_id = mv.company_id AND omv.outlet_id = $2 AND omv.menu_variant_id = mv.id
       LEFT JOIN gcims.inventory_items retail_item
         ON retail_item.company_id=mv.company_id AND retail_item.id=mv.retail_inventory_item_id
       LEFT JOIN gcims.uoms retail_uom ON retail_uom.id=retail_item.base_uom_id
       LEFT JOIN gcims.recipes r ON r.company_id = mv.company_id AND r.menu_variant_id = mv.id
       LEFT JOIN LATERAL (
         SELECT rv2.id
           FROM gcims.recipe_versions rv2
          WHERE rv2.company_id = r.company_id AND rv2.recipe_id = r.id
            AND rv2.status = 'active'
            AND rv2.effective_from <= now()
            AND (rv2.effective_to IS NULL OR rv2.effective_to > now())
          ORDER BY rv2.effective_from DESC
          LIMIT 1
       ) rv ON TRUE
      WHERE mv.company_id = $1 AND mv.id = $3
        AND mv.is_active = TRUE AND m.is_active = TRUE`,
    [companyId, outletId, variantId]
  );
  if (!result.rowCount) throw unprocessable('MENU_VARIANT_UNAVAILABLE', 'Varian menu tidak ditemukan atau tidak aktif.');
  const row = result.rows[0];
  if (!row.is_available) throw unprocessable('MENU_NOT_AVAILABLE_AT_OUTLET', 'Menu sedang tidak tersedia di outlet ini.');
  if (row.product_type === 'retail') {
    if (!row.retail_inventory_item_id || !row.retail_item_active) throw unprocessable('RETAIL_INVENTORY_ITEM_REQUIRED', 'Produk retail harus terhubung ke SKU inventori yang aktif.');
  } else {
    if (!row.recipe_id) throw unprocessable('RECIPE_REQUIRED', 'Setiap produk kafe wajib memiliki resep/BOM sebelum dapat dijual.');
    if (!row.recipe_version_id) throw unprocessable('ACTIVE_RECIPE_NOT_FOUND', 'Produk kafe belum mempunyai versi resep aktif pada waktu transaksi.');
  }
  return row;
}

async function insertOrderLines(client, { companyId, outletId, orderId, lines, taxRate }) {
  let subtotal = 0;
  let taxTotal = 0;
  const normalizedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const input = lines[index];
    const milli = quantityToMilli(input.quantity);
    const quantity = formatMilli(milli);
    const variant = await getVariantForOutlet(client, companyId, outletId, input.menu_variant_id);
    const unitPrice = safeInteger(variant.price_amount, 'Harga varian melebihi batas integer aman.');
    const gross = lineGrossAmount(unitPrice, quantity);
    const discount = 0;
    const tax = taxAmount(gross - discount, taxRate);
    const total = gross - discount + tax;

    const inserted = await client.query(
      `INSERT INTO gcims.sales_order_items
        (company_id, order_id, line_no, menu_variant_id, recipe_version_id,
         menu_name_snapshot, variant_name_snapshot, sku_snapshot, quantity,
         unit_price_amount, gross_amount, discount_amount, tax_rate, tax_amount,
         total_amount, item_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [companyId, orderId, index + 1, variant.id, variant.recipe_version_id,
       variant.menu_name, variant.variant_name, variant.code, quantity,
       unitPrice, gross, discount, taxRate, tax, total, input.item_note ?? null]
    );
    const orderItemId = inserted.rows[0].id;

    if (variant.recipe_version_id) {
      const recipeLines = await client.query(
        `SELECT ri.inventory_item_id, i.name AS item_name, i.sku,
                u.code AS base_uom_code,
                round(ri.quantity_base * $2::numeric, 6)::numeric(18,6) AS total_quantity_base
           FROM gcims.recipe_items ri
           JOIN gcims.inventory_items i
             ON i.company_id = ri.company_id AND i.id = ri.inventory_item_id
           JOIN gcims.uoms u ON u.id = i.base_uom_id
          WHERE ri.company_id = $1 AND ri.recipe_version_id = $3
          ORDER BY ri.line_no`,
        [companyId, quantity, variant.recipe_version_id]
      );
      if (!recipeLines.rowCount) throw unprocessable('EMPTY_ACTIVE_RECIPE', 'Versi resep aktif belum memiliki baris bahan (BOM).');
      for (let lineNo = 0; lineNo < recipeLines.rows.length; lineNo += 1) {
        const recipeLine = recipeLines.rows[lineNo];
        await client.query(
          `INSERT INTO gcims.sales_order_item_recipe_lines
            (company_id, sales_order_item_id, line_no, inventory_item_id,
             item_name_snapshot, sku_snapshot, base_uom_code_snapshot, quantity_base)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [companyId, orderItemId, lineNo + 1, recipeLine.inventory_item_id,
           recipeLine.item_name, recipeLine.sku, recipeLine.base_uom_code,
           recipeLine.total_quantity_base]
        );
      }
    } else if (variant.product_type === 'retail') {
      await client.query(
        `INSERT INTO gcims.sales_order_item_recipe_lines
          (company_id,sales_order_item_id,line_no,inventory_item_id,
           item_name_snapshot,sku_snapshot,base_uom_code_snapshot,quantity_base)
         VALUES ($1,$2,1,$3,$4,$5,$6,round($7::numeric*$8::numeric,6))`,
        [companyId,orderItemId,variant.retail_inventory_item_id,variant.retail_item_name,
         variant.retail_item_sku,variant.retail_item_uom_code,variant.retail_quantity_base,quantity]
      );
    }

    subtotal += gross;
    taxTotal += tax;
    normalizedLines.push({
      id: orderItemId,
      menu_name: variant.menu_name,
      variant_name: variant.variant_name,
      quantity,
      unit_price_amount: unitPrice,
      gross_amount: gross,
      discount_amount: discount,
      tax_amount: tax,
      total_amount: total,
      item_note: input.item_note ?? null
    });
  }
  return { subtotal, taxTotal, lines: normalizedLines };
}

export async function createDraftOrder({ companyId, outletId, userId, idempotencyKey, body }) {
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 120) {
    throw badRequest('Header Idempotency-Key wajib diisi (16–120 karakter).');
  }
  const hash = requestHash(body);
  const result = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`order:${outletId}:${idempotencyKey}`]);
    const existing = await client.query(
      `SELECT id, idempotency_request_hash FROM gcims.sales_orders
        WHERE outlet_id = $1 AND idempotency_key = $2`, [outletId, idempotencyKey]
    );
    if (existing.rowCount) {
      if (existing.rows[0].idempotency_request_hash !== hash) {
        throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key sudah dipakai dengan isi request berbeda.');
      }
      return { id: existing.rows[0].id, replay: true };
    }

    const outlet = await client.query(
      `SELECT id FROM gcims.outlets WHERE company_id = $1 AND id = $2 AND is_active`,
      [companyId, outletId]
    );
    if (!outlet.rowCount) throw notFound('Outlet tidak ditemukan atau tidak aktif.');
    const location = await client.query(
      `SELECT id FROM gcims.stock_locations
        WHERE company_id = $1 AND outlet_id = $2 AND id = $3 AND is_active`,
      [companyId, outletId, body.stock_location_id]
    );
    if (!location.rowCount) throw unprocessable('INVALID_STOCK_LOCATION', 'Lokasi stok tidak termasuk outlet aktif ini.');

    const shift = await client.query(
      `SELECT id FROM gcims.cashier_shifts
        WHERE company_id=$1 AND outlet_id=$2 AND cashier_user_id=$3 AND status='open'
        FOR UPDATE`, [companyId, outletId, userId]
    );
    if (!shift.rowCount) throw conflict('OPEN_SHIFT_REQUIRED', 'Buka shift kasir sebelum membuat pesanan.');

    const taxRate = await resolveTaxRate(client, companyId, outletId);
    const orderId = (await client.query(
      `INSERT INTO gcims.sales_orders
        (company_id, outlet_id, stock_location_id, order_number, order_type,
         table_label, queue_name, status, currency_code, customer_note,
         created_by, cashier_user_id, cashier_shift_id, idempotency_key, idempotency_request_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','IDR',$8,$9,$9,$10,$11,$12)
       RETURNING id`,
      [companyId, outletId, body.stock_location_id, makeDocumentNumber('GC'), body.order_type,
       body.table_label ?? null, body.queue_name ?? null, body.customer_note ?? null,
       userId, shift.rows[0].id, idempotencyKey, hash]
    )).rows[0].id;

    const calculated = await insertOrderLines(client, { companyId, outletId, orderId, lines: body.lines, taxRate });
    await client.query(
      `UPDATE gcims.sales_orders
          SET gross_subtotal_amount = $2, discount_amount = 0,
              tax_amount = $3, grand_total_amount = $2::bigint + $3::bigint,
              placed_at = now(), updated_at = now()
        WHERE id = $1`, [orderId, calculated.subtotal, calculated.taxTotal]
    );
    return { id: orderId, replay: false };
  });
  return { order: await getOrder({ companyId, outletId, orderId: result.id }), replay: result.replay };
}

export async function replaceDraftOrderItems({ companyId, outletId, orderId, userId, expectedVersion, body }) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw badRequest('If-Match harus berisi version_no positif.');
  await withTransaction(async (client) => {
    const lock = await client.query(
      `SELECT * FROM gcims.sales_orders
        WHERE company_id = $1 AND outlet_id = $2 AND id = $3
        FOR UPDATE`, [companyId, outletId, orderId]
    );
    if (!lock.rowCount) throw notFound('Pesanan tidak ditemukan.');
    const order = lock.rows[0];
    if (order.status !== 'draft') throw conflict('ORDER_NOT_EDITABLE', 'Pesanan tidak lagi berstatus draft.');
    if (order.version_no !== expectedVersion) throw conflict('STALE_ORDER_VERSION', 'Keranjang sudah berubah. Muat ulang pesanan sebelum mengedit.');

    const itemIds = await client.query('SELECT id FROM gcims.sales_order_items WHERE order_id = $1', [orderId]);
    if (itemIds.rowCount) {
      await client.query('DELETE FROM gcims.sales_order_item_recipe_lines WHERE sales_order_item_id = ANY($1::uuid[])', [itemIds.rows.map((r) => r.id)]);
      await client.query('DELETE FROM gcims.sales_order_items WHERE order_id = $1', [orderId]);
    }
    const taxRate = await resolveTaxRate(client, companyId, outletId);
    const calculated = await insertOrderLines(client, { companyId, outletId, orderId, lines: body.lines, taxRate });
    await client.query(
      `UPDATE gcims.sales_orders
          SET gross_subtotal_amount = $2, discount_amount = 0,
              tax_amount = $3, grand_total_amount = $2::bigint + $3::bigint,
              customer_note = $4, version_no = version_no + 1,
              updated_at = now()
        WHERE id = $1`,
      [orderId, calculated.subtotal, calculated.taxTotal, Object.hasOwn(body, 'customer_note') ? body.customer_note : order.customer_note]
    );
    await client.query(
      `INSERT INTO gcims.audit_logs
        (company_id, outlet_id, actor_user_id, actor_type, action, entity_type, entity_id, reason, after_data)
       VALUES ($1,$2,$3,'user','order.items.replaced','sales_order',$4,'Draft order updated',jsonb_build_object('version_no',$5::integer))`,
      [companyId, outletId, userId, orderId, expectedVersion + 1]
    );
  });
  return getOrder({ companyId, outletId, orderId });
}

export async function getOrder({ companyId, outletId, orderId }) {
  const header = await pool.query(
    `SELECT o.*, p.status AS payment_status, kt.status AS production_status
       FROM gcims.sales_orders o
       LEFT JOIN LATERAL (
         SELECT status FROM gcims.payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) p ON TRUE
       LEFT JOIN gcims.kitchen_tickets kt ON kt.company_id = o.company_id AND kt.order_id = o.id
      WHERE o.company_id = $1 AND o.outlet_id = $2 AND o.id = $3`,
    [companyId, outletId, orderId]
  );
  if (!header.rowCount) throw notFound('Pesanan tidak ditemukan.');
  const order = header.rows[0];
  const itemRows = await pool.query(
    `SELECT soi.id,soi.menu_name_snapshot AS menu_name,soi.variant_name_snapshot AS variant_name,
            soi.quantity::text,soi.unit_price_amount,soi.gross_amount,soi.discount_amount,
            soi.tax_amount,soi.total_amount,soi.item_note,mv.product_type
       FROM gcims.sales_order_items soi
       JOIN gcims.menu_variants mv ON mv.company_id=soi.company_id AND mv.id=soi.menu_variant_id
      WHERE soi.order_id = $1 ORDER BY soi.line_no`, [orderId]
  );
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    table_label: order.table_label,
    queue_name: order.queue_name,
    currency: order.currency_code,
    gross_subtotal_amount: safeInteger(order.gross_subtotal_amount),
    discount_amount: safeInteger(order.discount_amount),
    tax_amount: safeInteger(order.tax_amount),
    grand_total_amount: safeInteger(order.grand_total_amount),
    version_no: order.version_no,
    customer_note: order.customer_note,
    lines: itemRows.rows.map((r) => ({ ...r,
      unit_price_amount: safeInteger(r.unit_price_amount), gross_amount: safeInteger(r.gross_amount),
      discount_amount: safeInteger(r.discount_amount), tax_amount: safeInteger(r.tax_amount),
      total_amount: safeInteger(r.total_amount)
    })),
    payment_status: order.payment_status,
    production_status: order.production_status,
    created_at: order.created_at
  };
}

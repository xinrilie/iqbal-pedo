import { z } from 'zod';
import { pool, withTransaction } from '../lib/db.js';
import { badRequest, conflict, notFound, unprocessable } from '../lib/errors.js';

const SafeAmount = z.number().int().nonnegative().refine(Number.isSafeInteger);
const OpenShift = z.object({ opening_cash_amount: SafeAmount });
const CloseShift = z.object({ closing_cash_amount: SafeAmount, closing_note: z.string().trim().max(500).nullable().optional() });
const DrawerEvent = z.object({
  event_type: z.enum(['no_sale_open', 'cash_in', 'cash_out']),
  amount: SafeAmount.default(0),
  reason: z.string().trim().min(2).max(240)
}).superRefine((value, ctx) => {
  if (value.event_type === 'no_sale_open' && value.amount !== 0) ctx.addIssue({ code: 'custom', message: 'Buka laci tanpa transaksi tidak boleh memiliki nominal.', path: ['amount'] });
  if (value.event_type !== 'no_sale_open' && value.amount < 1) ctx.addIssue({ code: 'custom', message: 'Kas masuk/keluar harus lebih dari Rp0.', path: ['amount'] });
});
const CashierStockQuery = z.object({ q: z.string().trim().max(120).optional() });

export async function cashierRoutes(app) {
  app.get('/cashier/stock', { preHandler: [app.authenticate, app.requirePermission('pos.catalog.read')] }, async (request) => {
    const parsed = CashierStockQuery.safeParse(request.query);
    if (!parsed.success) throw badRequest('Parameter stok tidak valid.', parsed.error.issues);
    const { companyId, outletId } = request.gcims;
    const result = await pool.query(
      `SELECT ii.id AS inventory_item_id,ii.sku,ii.name,ic.name AS category_name,u.code AS base_uom_code,ii.track_expiry,
              sl.id AS stock_location_id,sl.code AS stock_location_code,sl.name AS stock_location_name,
              COALESCE(SUM(CASE WHEN
                ((ii.track_lot AND sa.lot_id IS NOT NULL) OR (NOT ii.track_lot AND sa.lot_id IS NULL))
                THEN COALESCE(soh.on_hand_qty_base,0) ELSE 0 END),0)::numeric(18,6)::text AS on_hand_qty_base,
              COALESCE(SUM(CASE WHEN NOT ii.allow_negative_stock AND (
                (ii.track_lot AND sa.lot_id IS NOT NULL AND (
                  (ii.track_expiry AND lot.expiry_date >= (now() AT TIME ZONE o.timezone_name)::date)
                  OR (NOT ii.track_expiry AND (lot.expiry_date IS NULL OR lot.expiry_date >= (now() AT TIME ZONE o.timezone_name)::date))
                )) OR (NOT ii.track_lot AND sa.lot_id IS NULL)
              ) THEN GREATEST(COALESCE(sa.available_qty_base,0),0) ELSE 0 END),0)::numeric(18,6)::text AS available_qty_base,
              expiry.earliest_stock_expiry_date::text,expiry.next_expiry_date::text,
              COALESCE(expiry.expired_stock_qty,0)::numeric(18,6)::text AS expired_stock_qty,
              COALESCE(expiry.expiring_soon_stock_qty,0)::numeric(18,6)::text AS expiring_soon_stock_qty
         FROM gcims.inventory_items ii
         JOIN gcims.stock_locations sl ON sl.company_id=ii.company_id AND sl.outlet_id=$2 AND sl.is_active
         JOIN gcims.outlets o ON o.company_id=sl.company_id AND o.id=sl.outlet_id
         JOIN gcims.uoms u ON u.id=ii.base_uom_id
         LEFT JOIN gcims.inventory_categories ic ON ic.company_id=ii.company_id AND ic.id=ii.category_id
         LEFT JOIN gcims.v_stock_available sa
           ON sa.company_id=ii.company_id AND sa.outlet_id=sl.outlet_id
          AND sa.stock_location_id=sl.id AND sa.inventory_item_id=ii.id
         LEFT JOIN gcims.v_stock_on_hand soh
           ON soh.company_id=sa.company_id AND soh.outlet_id=sa.outlet_id
          AND soh.stock_location_id=sa.stock_location_id AND soh.inventory_item_id=sa.inventory_item_id
          AND soh.lot_id IS NOT DISTINCT FROM sa.lot_id
         LEFT JOIN gcims.inventory_lots lot
           ON lot.company_id=sa.company_id AND lot.inventory_item_id=sa.inventory_item_id
          AND lot.stock_location_id=sa.stock_location_id AND lot.id=sa.lot_id
         LEFT JOIN LATERAL (
           SELECT MIN(il.expiry_date) FILTER (WHERE COALESCE(lot_balance.on_hand_qty_base,0)>0) AS earliest_stock_expiry_date,
                  MIN(il.expiry_date) FILTER (WHERE COALESCE(lot_balance.on_hand_qty_base,0)>0
                    AND il.expiry_date >= (now() AT TIME ZONE o.timezone_name)::date) AS next_expiry_date,
                  SUM(COALESCE(lot_balance.on_hand_qty_base,0)) FILTER (WHERE il.expiry_date < (now() AT TIME ZONE o.timezone_name)::date) AS expired_stock_qty,
                  SUM(COALESCE(lot_balance.on_hand_qty_base,0)) FILTER (WHERE il.expiry_date BETWEEN (now() AT TIME ZONE o.timezone_name)::date
                    AND (now() AT TIME ZONE o.timezone_name)::date + 30) AS expiring_soon_stock_qty
             FROM gcims.inventory_lots il
             LEFT JOIN gcims.v_stock_on_hand lot_balance
               ON lot_balance.company_id=il.company_id AND lot_balance.outlet_id=sl.outlet_id
              AND lot_balance.stock_location_id=il.stock_location_id AND lot_balance.inventory_item_id=il.inventory_item_id
              AND lot_balance.lot_id=il.id
            WHERE ii.track_expiry AND il.company_id=ii.company_id AND il.inventory_item_id=ii.id AND il.stock_location_id=sl.id
         ) expiry ON TRUE
        WHERE ii.company_id=$1 AND ii.is_active
          AND ($3::text IS NULL OR ii.name ILIKE '%'||$3||'%' OR ii.sku ILIKE '%'||$3||'%' OR ic.name ILIKE '%'||$3||'%')
        GROUP BY ii.id,ic.name,u.code,sl.id,expiry.earliest_stock_expiry_date,expiry.next_expiry_date,expiry.expired_stock_qty,expiry.expiring_soon_stock_qty
        ORDER BY ii.name,sl.name
        LIMIT 500`,
      [companyId, outletId, parsed.data.q || null]
    );
    return { data: result.rows };
  });

  app.get('/cashier/shift', { preHandler: [app.authenticate, app.requirePermission('pos.shift.read')] }, async (request) => {
    const { companyId, outletId, userId } = request.gcims;
    const result = await pool.query(
      `SELECT s.id, s.status, s.opened_at, s.opening_cash_amount,
              COALESCE(ev.cash_in,0)::bigint AS cash_in_amount,
              COALESCE(ev.cash_out,0)::bigint AS cash_out_amount,
              COALESCE(pay.cash_sales,0)::bigint AS cash_sales_amount,
              s.opening_cash_amount + COALESCE(ev.cash_in,0) - COALESCE(ev.cash_out,0)
                + COALESCE(pay.cash_sales,0) AS expected_cash_amount
         FROM gcims.cashier_shifts s
         LEFT JOIN LATERAL (
           SELECT SUM(amount) FILTER (WHERE event_type='cash_in') AS cash_in,
                  SUM(amount) FILTER (WHERE event_type='cash_out') AS cash_out
             FROM gcims.cash_drawer_events WHERE company_id=s.company_id AND cashier_shift_id=s.id
         ) ev ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(p.amount) AS cash_sales
             FROM gcims.sales_orders o JOIN gcims.payments p ON p.company_id=o.company_id AND p.order_id=o.id
            WHERE o.company_id=s.company_id AND o.cashier_shift_id=s.id
              AND p.method='cash' AND p.status='succeeded'
         ) pay ON TRUE
        WHERE s.company_id=$1 AND s.outlet_id=$2 AND s.cashier_user_id=$3 AND s.status='open'`,
      [companyId, outletId, userId]
    );
    return { shift: result.rows[0] ?? null };
  });

  app.post('/cashier/shifts', { preHandler: [app.authenticate, app.requirePermission('pos.shift.write')] }, async (request, reply) => {
    const parsed = OpenShift.safeParse(request.body);
    if (!parsed.success) throw badRequest('Nominal kas awal tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    const result = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT id FROM gcims.cashier_shifts
          WHERE company_id=$1 AND outlet_id=$2 AND cashier_user_id=$3 AND status='open' FOR UPDATE`,
        [companyId, outletId, userId]
      );
      if (current.rowCount) throw conflict('SHIFT_ALREADY_OPEN', 'Shift kasir masih aktif. Tutup shift tersebut sebelum membuka shift baru.');
      const shift = await client.query(
        `INSERT INTO gcims.cashier_shifts (company_id,outlet_id,cashier_user_id,opening_cash_amount)
         VALUES ($1,$2,$3,$4) RETURNING id,status,opened_at,opening_cash_amount`,
        [companyId, outletId, userId, parsed.data.opening_cash_amount]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data)
         VALUES ($1,$2,$3,'pos.shift.opened','cashier_shift',$4,jsonb_build_object('opening_cash_amount',$5::bigint))`,
        [companyId, outletId, userId, shift.rows[0].id, parsed.data.opening_cash_amount]
      );
      return shift.rows[0];
    });
    return reply.code(201).send({ shift: result });
  });

  app.post('/cashier/shifts/:shiftId/close', { preHandler: [app.authenticate, app.requirePermission('pos.shift.write')] }, async (request) => {
    if (!z.string().uuid().safeParse(request.params.shiftId).success) throw notFound('Shift aktif tidak ditemukan.');
    const parsed = CloseShift.safeParse(request.body);
    if (!parsed.success) throw badRequest('Nominal kas akhir tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    return withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT * FROM gcims.cashier_shifts
          WHERE company_id=$1 AND outlet_id=$2 AND cashier_user_id=$3 AND id=$4 AND status='open'
          FOR UPDATE`, [companyId, outletId, userId, request.params.shiftId]
      );
      if (!locked.rowCount) throw notFound('Shift aktif tidak ditemukan.');
      const activeDrafts = await client.query(
        `SELECT 1 FROM gcims.sales_orders WHERE company_id=$1 AND cashier_shift_id=$2
          AND status IN ('draft','pending_payment') LIMIT 1`, [companyId, request.params.shiftId]
      );
      if (activeDrafts.rowCount) throw conflict('SHIFT_HAS_OPEN_ORDERS', 'Selesaikan atau batalkan semua pesanan draft sebelum menutup shift.');
      const totals = await client.query(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE event_type='cash_in'),0)::bigint AS cash_in,
                COALESCE(SUM(amount) FILTER (WHERE event_type='cash_out'),0)::bigint AS cash_out
           FROM gcims.cash_drawer_events WHERE company_id=$1 AND cashier_shift_id=$2`,
        [companyId, request.params.shiftId]
      );
      const sales = await client.query(
        `SELECT COALESCE(SUM(p.amount),0)::bigint AS cash_sales
           FROM gcims.sales_orders o JOIN gcims.payments p ON p.company_id=o.company_id AND p.order_id=o.id
          WHERE o.company_id=$1 AND o.cashier_shift_id=$2 AND p.method='cash' AND p.status='succeeded'`,
        [companyId, request.params.shiftId]
      );
      const shift = locked.rows[0];
      const expected = Number(shift.opening_cash_amount) + Number(totals.rows[0].cash_in) - Number(totals.rows[0].cash_out) + Number(sales.rows[0].cash_sales);
      const variance = parsed.data.closing_cash_amount - expected;
      const result = await client.query(
        `UPDATE gcims.cashier_shifts SET status='closed',closed_at=now(),closing_cash_amount=$3,
          expected_cash_amount=$4,variance_amount=$5,closing_note=$6,updated_at=now()
          WHERE company_id=$1 AND id=$2
          RETURNING id,status,opened_at,closed_at,opening_cash_amount,closing_cash_amount,expected_cash_amount,variance_amount,closing_note`,
        [companyId, request.params.shiftId, parsed.data.closing_cash_amount, expected, variance, parsed.data.closing_note ?? null]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
         VALUES ($1,$2,$3,'pos.shift.closed','cashier_shift',$4,jsonb_build_object('status','open'),
           jsonb_build_object('status','closed','expected_cash_amount',$5::bigint,'closing_cash_amount',$6::bigint,'variance_amount',$7::bigint),$8)`,
        [companyId, outletId, userId, request.params.shiftId, expected, parsed.data.closing_cash_amount, variance, parsed.data.closing_note ?? null]
      );
      return { shift: result.rows[0] };
    });
  });

  app.post('/cashier/drawer-events', { preHandler: [app.authenticate, app.requirePermission('pos.cash_drawer.write')] }, async (request, reply) => {
    const parsed = DrawerEvent.safeParse(request.body);
    if (!parsed.success) throw badRequest('Aktivitas laci kas tidak valid.', parsed.error.issues);
    const { companyId, outletId, userId } = request.gcims;
    const result = await withTransaction(async (client) => {
      const shift = await client.query(
        `SELECT id FROM gcims.cashier_shifts WHERE company_id=$1 AND outlet_id=$2 AND cashier_user_id=$3 AND status='open' FOR UPDATE`,
        [companyId, outletId, userId]
      );
      if (!shift.rowCount) throw conflict('OPEN_SHIFT_REQUIRED', 'Buka shift kasir sebelum mencatat aktivitas laci.');
      if (parsed.data.event_type === 'cash_out') {
        const balance = await client.query(
          `SELECT s.opening_cash_amount
             + COALESCE(ev.cash_in,0) - COALESCE(ev.cash_out,0) + COALESCE(pay.cash_sales,0) AS amount
             FROM gcims.cashier_shifts s
             LEFT JOIN LATERAL (
               SELECT SUM(amount) FILTER (WHERE event_type='cash_in') AS cash_in,
                      SUM(amount) FILTER (WHERE event_type='cash_out') AS cash_out
                 FROM gcims.cash_drawer_events WHERE company_id=s.company_id AND cashier_shift_id=s.id
             ) ev ON TRUE
             LEFT JOIN LATERAL (
               SELECT SUM(p.amount) AS cash_sales FROM gcims.sales_orders o
                 JOIN gcims.payments p ON p.company_id=o.company_id AND p.order_id=o.id
                WHERE o.company_id=s.company_id AND o.cashier_shift_id=s.id AND p.method='cash' AND p.status='succeeded'
             ) pay ON TRUE WHERE s.company_id=$1 AND s.id=$2`, [companyId, shift.rows[0].id]
        );
        if (parsed.data.amount > Number(balance.rows[0].amount)) throw unprocessable('INSUFFICIENT_DRAWER_CASH', 'Kas keluar melebihi perkiraan saldo laci.');
      }
      const event = await client.query(
        `INSERT INTO gcims.cash_drawer_events (company_id,outlet_id,cashier_shift_id,actor_user_id,event_type,amount,reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,event_type,amount,reason,occurred_at`,
        [companyId, outletId, shift.rows[0].id, userId, parsed.data.event_type, parsed.data.amount, parsed.data.reason]
      );
      await client.query(
        `INSERT INTO gcims.audit_logs (company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
         VALUES ($1,$2,$3,$4,'cash_drawer_event',$5,jsonb_build_object('amount',$6::bigint),$7)`,
        [companyId, outletId, userId, `pos.drawer.${parsed.data.event_type}`, event.rows[0].id, parsed.data.amount, parsed.data.reason]
      );
      return event.rows[0];
    });
    return reply.code(201).send({ event: result });
  });

  app.get('/cashier/transactions', { preHandler: [app.authenticate, app.requirePermission('pos.order.read')] }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    if (!query.success) throw badRequest('Parameter riwayat transaksi tidak valid.', query.error.issues);
    const result = await pool.query(
      `SELECT o.id AS order_id,o.order_number,o.order_type,o.table_label,o.status AS order_status,
              o.grand_total_amount,p.id AS payment_id,p.payment_number,p.method,p.confirmed_at,
              p.cash_received_amount,p.cash_change_amount,
              COALESCE((SELECT SUM(soi.quantity)::text FROM gcims.sales_order_items soi WHERE soi.company_id=o.company_id AND soi.order_id=o.id),'0') AS item_quantity
         FROM gcims.sales_orders o JOIN gcims.payments p ON p.company_id=o.company_id AND p.order_id=o.id
        WHERE o.company_id=$1 AND o.outlet_id=$2 AND o.cashier_user_id=$3 AND p.status='succeeded'
        ORDER BY p.confirmed_at DESC,p.id DESC LIMIT $4`,
      [request.gcims.companyId, request.gcims.outletId, request.gcims.userId, query.data.limit]
    );
    return { data: result.rows.map((row) => ({ ...row,
      grand_total_amount: Number(row.grand_total_amount),
      cash_received_amount: row.cash_received_amount == null ? null : Number(row.cash_received_amount),
      cash_change_amount: row.cash_change_amount == null ? null : Number(row.cash_change_amount)
    })) };
  });
}

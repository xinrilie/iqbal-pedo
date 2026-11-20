import { pool, withTransaction } from './db.js';
import { badRequest, conflict, notFound, unprocessable } from './errors.js';
import { decodeQueueCursor, encodeQueueCursor } from './ids.js';
import { deriveTicketStatus } from './kds-rules.js';

const allowedTransitions = {
  queued: ['in_preparation', 'cancelled'],
  in_preparation: ['ready', 'cancelled'],
  ready: ['served'],
  served: [],
  cancelled: []
};

function validateTransition(from, to) {
  if (from === to) return false;
  if (!allowedTransitions[from]?.includes(to)) {
    throw unprocessable('INVALID_KDS_TRANSITION', `Transisi status tiket dari ${from} ke ${to} tidak diizinkan.`);
  }
  return true;
}

export async function listTickets({ companyId, outletId, status, stationCode, limit, cursor }) {
  const after = decodeQueueCursor(cursor);
  if (cursor && !after) throw badRequest('Cursor KDS tidak valid.');
  const result = await pool.query(
    `WITH page AS (
       SELECT id
         FROM gcims.kitchen_tickets
        WHERE company_id = $1 AND outlet_id = $2
          AND ($3::text IS NULL OR status = $3)
          AND ($4::text IS NULL OR station_code = $4)
          AND ($5::smallint IS NULL OR (priority, queued_at, id) > ($5::smallint, $6::timestamptz, $7::uuid))
        ORDER BY priority, queued_at, id
        LIMIT $8
     )
     SELECT kt.id, kt.ticket_number, kt.order_id, o.order_number, kt.status,
            kt.priority, kt.queued_at, kt.station_code,
            item.id AS item_id, item.menu_name_snapshot AS item_menu_name,
            item.variant_name_snapshot AS item_variant_name,
            item.quantity::text AS item_quantity, item.status AS item_status,
            item.item_note
       FROM page p
       JOIN gcims.kitchen_tickets kt ON kt.id = p.id
       JOIN gcims.sales_orders o ON o.company_id = kt.company_id AND o.id = kt.order_id
       LEFT JOIN gcims.kitchen_ticket_items item
         ON item.company_id = kt.company_id AND item.kitchen_ticket_id = kt.id
      ORDER BY kt.priority, kt.queued_at, kt.id, item.line_no`,
    [companyId, outletId, status ?? null, stationCode ?? null,
      after?.priority ?? null, after?.queuedAt ?? null, after?.id ?? null, limit + 1]
  );

  const byId = new Map();
  for (const row of result.rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id, ticket_number: row.ticket_number, order_number: row.order_number,
        status: row.status, priority: row.priority, queued_at: row.queued_at,
        station_code: row.station_code, items: []
      });
    }
    if (row.item_id) {
      byId.get(row.id).items.push({
        id: row.item_id, menu_name: row.item_menu_name,
        variant_name: row.item_variant_name, quantity: row.item_quantity,
        status: row.item_status, item_note: row.item_note
      });
    }
  }
  const allTickets = [...byId.values()];
  const hasMore = allTickets.length > limit;
  const data = allTickets.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    page: {
      limit,
      next_cursor: hasMore && last
        ? encodeQueueCursor({ priority: last.priority, queuedAt: last.queued_at, id: last.id })
        : null
    }
  };
}

export async function getTicket({ companyId, outletId, ticketId }) {
  const header = await pool.query(
    `SELECT kt.*, o.order_number
       FROM gcims.kitchen_tickets kt
       JOIN gcims.sales_orders o ON o.company_id = kt.company_id AND o.id = kt.order_id
      WHERE kt.company_id = $1 AND kt.outlet_id = $2 AND kt.id = $3`,
    [companyId, outletId, ticketId]
  );
  if (!header.rowCount) throw notFound('Tiket barista tidak ditemukan.');
  const itemRows = await pool.query(
    `SELECT id, menu_name_snapshot AS menu_name, variant_name_snapshot AS variant_name,
            quantity::text, status, item_note
       FROM gcims.kitchen_ticket_items
      WHERE company_id = $1 AND kitchen_ticket_id = $2 ORDER BY line_no`,
    [companyId, ticketId]
  );
  const t = header.rows[0];
  return {
    id: t.id, ticket_number: t.ticket_number, order_number: t.order_number,
    status: t.status, priority: t.priority, queued_at: t.queued_at,
    station_code: t.station_code,
    items: itemRows.rows
  };
}

function timestampColumn(status) {
  if (status === 'in_preparation') return 'started_at';
  if (status === 'ready') return 'ready_at';
  if (status === 'served') return 'served_at';
  if (status === 'cancelled') return 'cancelled_at';
  throw new Error('Unexpected KDS target status');
}

export async function updateTicketStatus({ companyId, outletId, ticketId, userId, status, reason }) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT * FROM gcims.kitchen_tickets
        WHERE company_id = $1 AND outlet_id = $2 AND id = $3 FOR UPDATE`,
      [companyId, outletId, ticketId]
    );
    if (!result.rowCount) throw notFound('Tiket barista tidak ditemukan.');
    const ticket = result.rows[0];
    const changed = validateTransition(ticket.status, status);
    if (!changed) return;
    if (status === 'cancelled' && !reason?.trim()) throw unprocessable('CANCEL_REASON_REQUIRED', 'Alasan pembatalan wajib diisi.');
    const stamp = timestampColumn(status);
    await client.query(
      `UPDATE gcims.kitchen_tickets
          SET status = $2, ${stamp} = now(), updated_at = now(),
              cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END
        WHERE id = $1`, [ticketId, status, reason ?? null]
    );
    // Ticket-level transitions are propagated to all non-cancelled items.
    const itemUpdate = await client.query(
      `UPDATE gcims.kitchen_ticket_items
          SET status = $2, ${stamp} = now(),
              updated_at = now()
        WHERE kitchen_ticket_id = $1 AND status <> 'cancelled'
        RETURNING id`, [ticketId, status]
    );
    await client.query(
      `INSERT INTO gcims.kitchen_ticket_events
        (company_id, outlet_id, kitchen_ticket_id, event_type, from_status, to_status, actor_user_id, reason, metadata)
       VALUES ($1,$2,$3,'ticket_status_changed',$4,$5,$6,$7,jsonb_build_object('updated_item_count',$8::integer))`,
      [companyId, outletId, ticketId, ticket.status, status, userId, reason ?? null, itemUpdate.rowCount]
    );
    await client.query(
      `INSERT INTO gcims.audit_logs
        (company_id, outlet_id, actor_user_id, actor_type, action, entity_type, entity_id, reason, before_data, after_data)
       VALUES ($1,$2,$3,'user','kds.ticket.status_changed','kitchen_ticket',$4,$5,
               jsonb_build_object('status',$6::text),jsonb_build_object('status',$7::text))`,
      [companyId, outletId, userId, ticketId, reason ?? null, ticket.status, status]
    );
  });
  return getTicket({ companyId, outletId, ticketId });
}

export async function updateTicketItemStatus({ companyId, outletId, ticketId, ticketItemId, userId, status, reason }) {
  await withTransaction(async (client) => {
    const ticketResult = await client.query(
      `SELECT * FROM gcims.kitchen_tickets
        WHERE company_id = $1 AND outlet_id = $2 AND id = $3 FOR UPDATE`,
      [companyId, outletId, ticketId]
    );
    if (!ticketResult.rowCount) throw notFound('Tiket barista tidak ditemukan.');
    const itemResult = await client.query(
      `SELECT * FROM gcims.kitchen_ticket_items
        WHERE company_id = $1 AND kitchen_ticket_id = $2 AND id = $3 FOR UPDATE`,
      [companyId, ticketId, ticketItemId]
    );
    if (!itemResult.rowCount) throw notFound('Item tiket tidak ditemukan.');
    const item = itemResult.rows[0];
    if (!validateTransition(item.status, status)) return;
    if (status === 'cancelled' && !reason?.trim()) throw unprocessable('CANCEL_REASON_REQUIRED', 'Alasan pembatalan item wajib diisi.');
    const stamp = timestampColumn(status);
    await client.query(
      `UPDATE gcims.kitchen_ticket_items
          SET status = $2, ${stamp} = now(), updated_at = now()
        WHERE id = $1`, [ticketItemId, status]
    );
    await client.query(
      `INSERT INTO gcims.kitchen_ticket_events
        (company_id, outlet_id, kitchen_ticket_id, kitchen_ticket_item_id,
         event_type, from_status, to_status, actor_user_id, reason)
       VALUES ($1,$2,$3,$4,'item_status_changed',$5,$6,$7,$8)`,
      [companyId, outletId, ticketId, ticketItemId, item.status, status, userId, reason ?? null]
    );

    const aggregate = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status <> 'cancelled') AS active_count,
         COUNT(*) FILTER (WHERE status = 'served') AS served_count,
         COUNT(*) FILTER (WHERE status IN ('ready','served')) AS ready_count,
         COUNT(*) FILTER (WHERE status = 'in_preparation') AS preparing_count
       FROM gcims.kitchen_ticket_items WHERE kitchen_ticket_id = $1`, [ticketId]
    );
    const a = aggregate.rows[0];
    const derivedStatus = deriveTicketStatus(ticketResult.rows[0].status, {
      activeCount: a.active_count,
      servedCount: a.served_count,
      readyCount: a.ready_count,
      preparingCount: a.preparing_count
    });
    if (derivedStatus !== ticketResult.rows[0].status) {
      const aggregateStamp = timestampColumn(derivedStatus);
      await client.query(
        `UPDATE gcims.kitchen_tickets SET status = $2, ${aggregateStamp} = now(), updated_at = now(),
                cancel_reason = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancel_reason, 'All ticket items cancelled') ELSE cancel_reason END
          WHERE id = $1`,
        [ticketId, derivedStatus]
      );
      await client.query(
        `INSERT INTO gcims.kitchen_ticket_events
          (company_id, outlet_id, kitchen_ticket_id, event_type, from_status, to_status, actor_user_id, reason, metadata)
         VALUES ($1,$2,$3,'ticket_status_derived_from_items',$4,$5,$6,$7,jsonb_build_object('source_item_id',$8::uuid))`,
        [companyId, outletId, ticketId, ticketResult.rows[0].status, derivedStatus, userId, reason ?? null, ticketItemId]
      );
    }
    await client.query(
      `INSERT INTO gcims.audit_logs
        (company_id, outlet_id, actor_user_id, actor_type, action, entity_type, entity_id, reason, before_data, after_data)
       VALUES ($1,$2,$3,'user','kds.item.status_changed','kitchen_ticket_item',$4,$5,
               jsonb_build_object('status',$6::text),jsonb_build_object('status',$7::text))`,
      [companyId, outletId, userId, ticketItemId, reason ?? null, item.status, status]
    );
  });
  return getTicket({ companyId, outletId, ticketId });
}

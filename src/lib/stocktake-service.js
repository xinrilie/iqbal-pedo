import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { assertMakerChecker } from './procurement-rules.js';

async function writeAudit(client, { companyId, outletId, userId, action, stocktakeId, afterData, reason = null }) {
  await client.query(
    `INSERT INTO gcims.audit_logs
      (company_id,outlet_id,actor_user_id,actor_type,action,entity_type,entity_id,after_data,reason)
     VALUES ($1,$2,$3,'user',$4,'stocktake',$5,$6::jsonb,$7)`,
    [companyId, outletId, userId, action, stocktakeId, JSON.stringify(afterData ?? {}), reason]
  );
}

async function lockStocktake(client, { companyId, outletId, stocktakeId }) {
  const result = await client.query(
    `SELECT * FROM gcims.stocktakes
      WHERE company_id=$1 AND outlet_id=$2 AND id=$3 FOR UPDATE`,
    [companyId, outletId, stocktakeId]
  );
  if (!result.rowCount) throw notFound('Stok opname tidak ditemukan.');
  return result.rows[0];
}

export async function listStocktakes({ companyId, outletId, limit = 50 }) {
  const result = await pool.query(
    `SELECT st.id,st.stocktake_number,st.status,st.cutoff_at,st.created_at,st.completed_at,st.posted_at,
            sl.name AS stock_location_name,creator.full_name AS created_by_name,
            COUNT(si.id)::integer AS line_count,
            COUNT(si.id) FILTER (WHERE si.counted_qty_base IS NOT NULL)::integer AS counted_line_count
       FROM gcims.stocktakes st
       JOIN gcims.stock_locations sl ON sl.company_id=st.company_id AND sl.id=st.stock_location_id
       LEFT JOIN gcims.users creator ON creator.id=st.created_by
       LEFT JOIN gcims.stocktake_items si ON si.company_id=st.company_id AND si.stocktake_id=st.id
      WHERE st.company_id=$1 AND st.outlet_id=$2
      GROUP BY st.id,sl.name,creator.full_name
      ORDER BY st.created_at DESC,st.id DESC LIMIT $3`,
    [companyId, outletId, limit]
  );
  return { data: result.rows };
}

export async function createStocktake({ companyId, outletId, stockLocationId, userId, notes = null }) {
  return withTransaction(async (client) => {
    const location = await client.query(
      `SELECT id FROM gcims.stock_locations
        WHERE company_id=$1 AND outlet_id=$2 AND id=$3 AND is_active FOR UPDATE`,
      [companyId, outletId, stockLocationId]
    );
    if (!location.rowCount) throw notFound('Lokasi stok tidak ditemukan atau tidak aktif.');
    const active = await client.query(
      `SELECT stocktake_number FROM gcims.stocktakes
        WHERE company_id=$1 AND outlet_id=$2 AND stock_location_id=$3
          AND status IN ('draft','counting','pending_review','approved') LIMIT 1`,
      [companyId,outletId,stockLocationId]
    );
    if(active.rowCount) throw conflict('STOCKTAKE_ALREADY_OPEN',`Opname ${active.rows[0].stocktake_number} masih berjalan di lokasi ini.`);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const inserted = await client.query(
      `INSERT INTO gcims.stocktakes
        (company_id,outlet_id,stock_location_id,stocktake_number,status,cutoff_at,started_at,created_by,notes)
       VALUES ($1,$2,$3,'ST-'||to_char(now(),'YYMMDD')||'-'||$4,'counting',now(),now(),$5,$6)
       RETURNING *`,
      [companyId, outletId, stockLocationId, suffix, userId, notes]
    );
    const stocktake = inserted.rows[0];

    await client.query(
      `SELECT id FROM gcims.inventory_items WHERE company_id=$1 AND is_active ORDER BY id FOR UPDATE`,
      [companyId]
    );
    const negative = await client.query(
      `SELECT ii.sku FROM gcims.v_stock_on_hand soh
         JOIN gcims.inventory_items ii ON ii.company_id=soh.company_id AND ii.id=soh.inventory_item_id
        WHERE soh.company_id=$1 AND soh.outlet_id=$2 AND soh.stock_location_id=$3
          AND soh.on_hand_qty_base < 0 LIMIT 1`,
      [companyId, outletId, stockLocationId]
    );
    if (negative.rowCount) throw conflict('NEGATIVE_STOCK_REQUIRES_REVIEW', `Saldo ledger negatif untuk ${negative.rows[0].sku}; perbaiki sumber data sebelum opname.`);

    await client.query('UPDATE gcims.stocktakes SET cutoff_at=clock_timestamp() WHERE company_id=$1 AND id=$2', [companyId, stocktake.id]);
    const snapshot = await client.query(
      `INSERT INTO gcims.stocktake_items
        (company_id,stocktake_id,stock_location_id,inventory_item_id,lot_id,system_qty_base)
       SELECT ii.company_id,$1,$3,ii.id,soh.lot_id,COALESCE(soh.on_hand_qty_base,0)
         FROM gcims.inventory_items ii
         LEFT JOIN gcims.v_stock_on_hand soh
           ON soh.company_id=ii.company_id AND soh.outlet_id=$2
          AND soh.stock_location_id=$3 AND soh.inventory_item_id=ii.id
        WHERE ii.company_id=$4 AND ii.is_active
          AND ((ii.track_lot AND soh.lot_id IS NOT NULL AND soh.on_hand_qty_base>0)
            OR (NOT ii.track_lot AND soh.lot_id IS NULL))
       RETURNING id`,
      [stocktake.id, outletId, stockLocationId, companyId]
    );
    if (!snapshot.rowCount) throw conflict('EMPTY_STOCKTAKE', 'Tidak ada item aktif untuk dihitung di lokasi ini.');
    await writeAudit(client, {
      companyId, outletId, userId, action: 'inventory.stocktake.started', stocktakeId: stocktake.id,
      afterData: { stocktake_number: stocktake.stocktake_number, stock_location_id: stockLocationId, line_count: snapshot.rowCount }
    });
    return getStocktakeWithClient(client, { companyId, outletId, stocktakeId: stocktake.id });
  });
}

async function getStocktakeWithClient(client, { companyId, outletId, stocktakeId }) {
  const header = await client.query(
    `SELECT st.*,sl.name AS stock_location_name,creator.full_name AS created_by_name,
            reviewer.full_name AS reviewed_by_name,approver.full_name AS approved_by_name
       FROM gcims.stocktakes st
       JOIN gcims.stock_locations sl ON sl.company_id=st.company_id AND sl.id=st.stock_location_id
       LEFT JOIN gcims.users creator ON creator.id=st.created_by
       LEFT JOIN gcims.users reviewer ON reviewer.id=st.reviewed_by
       LEFT JOIN gcims.users approver ON approver.id=st.approved_by
      WHERE st.company_id=$1 AND st.outlet_id=$2 AND st.id=$3`, [companyId,outletId,stocktakeId]
  );
  if (!header.rowCount) throw notFound('Stok opname tidak ditemukan.');
  const lines = await client.query(
    `SELECT si.id,si.inventory_item_id,ii.sku,ii.name AS item_name,u.code AS base_uom_code,
            si.lot_id,lot.lot_code,lot.expiry_date::text AS expiry_date,
            si.system_qty_base::numeric(18,6)::text AS system_qty_base,
            si.counted_qty_base::numeric(18,6)::text AS counted_qty_base,
            si.variance_qty_base::numeric(18,6)::text AS variance_qty_base,
            si.reason_code,si.notes,si.counted_at,counted.full_name AS counted_by_name
       FROM gcims.stocktake_items si
       JOIN gcims.inventory_items ii ON ii.company_id=si.company_id AND ii.id=si.inventory_item_id
       JOIN gcims.uoms u ON u.id=ii.base_uom_id
       LEFT JOIN gcims.inventory_lots lot
         ON lot.company_id=si.company_id AND lot.inventory_item_id=si.inventory_item_id AND lot.id=si.lot_id
       LEFT JOIN gcims.users counted ON counted.id=si.counted_by
      WHERE si.company_id=$1 AND si.stocktake_id=$2
      ORDER BY ii.name,ii.sku,lot.expiry_date NULLS LAST,lot.lot_code NULLS LAST,si.id`,
    [companyId,stocktakeId]
  );
  return { ...header.rows[0], lines: lines.rows };
}

export async function getStocktake({ companyId, outletId, stocktakeId }) {
  return getStocktakeWithClient(pool, { companyId, outletId, stocktakeId });
}

export async function countStocktakeLine({ companyId, outletId, stocktakeId, lineId, userId, countedQty, reasonCode, notes }) {
  return withTransaction(async (client) => {
    const header = await lockStocktake(client, { companyId, outletId, stocktakeId });
    if (header.status !== 'counting') throw conflict('STOCKTAKE_NOT_COUNTING', 'Item hanya bisa dicatat saat stok opname berstatus menghitung.');
    const updated = await client.query(
      `UPDATE gcims.stocktake_items
          SET counted_qty_base=$5::numeric,reason_code=$6,notes=$7,counted_by=$8,counted_at=now()
        WHERE company_id=$1 AND stocktake_id=$2 AND stock_location_id=$3 AND id=$4
        RETURNING id,inventory_item_id,counted_qty_base::numeric(18,6)::text,variance_qty_base::numeric(18,6)::text`,
      [companyId,stocktakeId,header.stock_location_id,lineId,countedQty,reasonCode??null,notes??null,userId]
    );
    if (!updated.rowCount) throw notFound('Baris stok opname tidak ditemukan.');
    await writeAudit(client, {
      companyId,outletId,userId,action:'inventory.stocktake.line_counted',stocktakeId,
      afterData:{ stocktake_item_id:lineId,inventory_item_id:updated.rows[0].inventory_item_id,counted_qty_base:updated.rows[0].counted_qty_base,variance_qty_base:updated.rows[0].variance_qty_base,reason_code:reasonCode??null }
    });
    return getStocktakeWithClient(client,{companyId,outletId,stocktakeId});
  });
}

export async function submitStocktake({ companyId, outletId, stocktakeId, userId }) {
  return withTransaction(async (client) => {
    const header = await lockStocktake(client,{companyId,outletId,stocktakeId});
    if (header.status !== 'counting') throw conflict('INVALID_STOCKTAKE_TRANSITION','Stok opname hanya bisa dikirim saat status menghitung.');
    const incomplete = await client.query(
      `SELECT COUNT(*) FILTER (WHERE counted_qty_base IS NULL)::integer AS uncounted,
              COUNT(*) FILTER (WHERE variance_qty_base<>0 AND NULLIF(btrim(reason_code),'') IS NULL)::integer AS missing_reason
         FROM gcims.stocktake_items WHERE company_id=$1 AND stocktake_id=$2`,[companyId,stocktakeId]
    );
    if (incomplete.rows[0].uncounted) throw conflict('STOCKTAKE_LINES_UNCOUNTED',`${incomplete.rows[0].uncounted} item belum dihitung.`);
    if (incomplete.rows[0].missing_reason) throw conflict('STOCKTAKE_VARIANCE_REASON_REQUIRED',`${incomplete.rows[0].missing_reason} selisih belum memiliki alasan.`);
    if (!header.created_by) throw conflict('STOCKTAKE_MAKER_REQUIRED','Identitas pembuat stok opname tidak tersedia.');
    await client.query(
      `UPDATE gcims.stocktakes SET status='pending_review',completed_at=now(),reviewed_by=$3
        WHERE company_id=$1 AND id=$2`,[companyId,stocktakeId,userId]
    );
    await writeAudit(client,{companyId,outletId,userId,action:'inventory.stocktake.submitted',stocktakeId,afterData:{status:'pending_review'}});
    return getStocktakeWithClient(client,{companyId,outletId,stocktakeId});
  });
}

export async function approveStocktake({ companyId, outletId, stocktakeId, userId }) {
  return withTransaction(async (client) => {
    const header=await lockStocktake(client,{companyId,outletId,stocktakeId});
    if(header.status!=='pending_review') throw conflict('INVALID_STOCKTAKE_TRANSITION','Stok opname belum siap disetujui.');
    assertMakerChecker(header.created_by,userId,'Stok opname');
    await client.query(`UPDATE gcims.stocktakes SET status='approved',approved_by=$3 WHERE company_id=$1 AND id=$2`,[companyId,stocktakeId,userId]);
    await writeAudit(client,{companyId,outletId,userId,action:'inventory.stocktake.approved',stocktakeId,afterData:{status:'approved'}});
    return getStocktakeWithClient(client,{companyId,outletId,stocktakeId});
  });
}

export async function postStocktake({ companyId, outletId, stocktakeId, userId }) {
  return withTransaction(async (client) => {
    const header=await lockStocktake(client,{companyId,outletId,stocktakeId});
    if(header.status!=='approved') throw conflict('INVALID_STOCKTAKE_TRANSITION','Stok opname harus disetujui sebelum diposting.');
    if(header.approved_by!==userId) throw forbidden('Hanya penyetuju yang boleh memposting stok opname ini.');
    const lines=await client.query(
      `SELECT id,inventory_item_id,lot_id,system_qty_base::numeric(18,6)::text,
              counted_qty_base::numeric(18,6)::text,variance_qty_base::numeric(18,6)::text,reason_code,notes
         FROM gcims.stocktake_items WHERE company_id=$1 AND stocktake_id=$2 ORDER BY inventory_item_id,id`,[companyId,stocktakeId]
    );
    if(!lines.rowCount||lines.rows.some((line)=>line.counted_qty_base===null)) throw conflict('STOCKTAKE_LINES_UNCOUNTED','Stok opname memiliki item yang belum dihitung.');
    const itemIds=[...new Set(lines.rows.map((line)=>line.inventory_item_id))];
    await client.query(`SELECT id FROM gcims.inventory_items WHERE company_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,[companyId,itemIds]);

    let movements=0;
    for(const line of lines.rows){
      const variance=Number(line.variance_qty_base);
      if(!Number.isFinite(variance)) throw conflict('STOCKTAKE_VARIANCE_INVALID','Selisih stok opname tidak valid.');
      if(variance===0) continue;
      const type=variance>0?'stocktake_in':'stocktake_out';
      const reason=[`Opname ${header.stocktake_number}`,line.reason_code,line.notes].filter(Boolean).join(': ').slice(0,1000);
      await client.query(
        `INSERT INTO gcims.stock_ledger
          (company_id,outlet_id,stock_location_id,inventory_item_id,lot_id,movement_type,quantity_delta_base,
           occurred_at,source_type,source_id,source_line_id,idempotency_key,reason,actor_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7::numeric,now(),'stocktake',$8,$9,$10,$11,$12)
         ON CONFLICT(idempotency_key) DO NOTHING`,
        [companyId,outletId,header.stock_location_id,line.inventory_item_id,line.lot_id,type,line.variance_qty_base,
         stocktakeId,line.id,`stocktake:${stocktakeId}:${line.id}`,reason,userId]
      );
      movements++;
    }
    await client.query(`UPDATE gcims.stocktakes SET status='posted',posted_at=now() WHERE company_id=$1 AND id=$2`,[companyId,stocktakeId]);
    await writeAudit(client,{companyId,outletId,userId,action:'inventory.stocktake.posted',stocktakeId,afterData:{status:'posted',ledger_movement_count:movements}});
    return getStocktakeWithClient(client,{companyId,outletId,stocktakeId});
  });
}

export async function cancelStocktake({ companyId, outletId, stocktakeId, userId, reason }) {
  return withTransaction(async (client) => {
    const header=await lockStocktake(client,{companyId,outletId,stocktakeId});
    if(!['draft','counting','pending_review'].includes(header.status)) throw conflict('INVALID_STOCKTAKE_TRANSITION','Stok opname tidak dapat dibatalkan pada status ini.');
    if(header.created_by!==userId) throw forbidden('Hanya pembuat yang dapat membatalkan stok opname ini.');
    await client.query(`UPDATE gcims.stocktakes SET status='cancelled' WHERE company_id=$1 AND id=$2`,[companyId,stocktakeId]);
    await writeAudit(client,{companyId,outletId,userId,action:'inventory.stocktake.cancelled',stocktakeId,afterData:{status:'cancelled'},reason});
    return getStocktakeWithClient(client,{companyId,outletId,stocktakeId});
  });
}

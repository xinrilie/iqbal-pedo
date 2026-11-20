import { z } from 'zod';
import { pool } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { decodeCursor, encodeCursor } from '../lib/ids.js';

const CatalogQuery = z.object({
  q: z.string().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  stockLocationId: z.string().uuid().optional(),
  includeUnavailable: z.enum(['true', 'false']).optional().default('false'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional()
});

export async function posRoutes(app) {
  app.get('/outlets/:outletId/catalog', {
    preHandler: [app.authenticate, app.requirePermission('pos.catalog.read')]
  }, async (request) => {
    if (request.params.outletId !== request.gcims.outletId) throw notFound('Outlet tidak ditemukan.');
    const parsed = CatalogQuery.safeParse(request.query);
    if (!parsed.success) throw badRequest('Parameter katalog tidak valid.', parsed.error.issues);
    const q = parsed.data;
    if (q.stockLocationId) {
      const location = await pool.query(
        `SELECT 1 FROM gcims.stock_locations
          WHERE company_id=$1 AND outlet_id=$2 AND id=$3 AND is_active=TRUE`,
        [request.gcims.companyId, request.gcims.outletId, q.stockLocationId]
      );
      if (!location.rowCount) throw notFound('Lokasi stok tidak ditemukan atau tidak aktif.');
    }
    if (q.includeUnavailable === 'true') {
      await app.requirePermission('admin.menu.read')(request);
    }
    const cursor = decodeCursor(q.cursor);
    if (q.cursor && !cursor) throw badRequest('Cursor tidak valid.');
    const result = await pool.query(
      `WITH menu_page AS (
         SELECT m.id
           FROM gcims.menus m
           LEFT JOIN gcims.menu_categories mc ON mc.company_id = m.company_id AND mc.id = m.category_id
          WHERE m.company_id = $1 AND ($6::boolean OR m.is_active = TRUE)
            AND ($2::uuid IS NULL OR m.category_id = $2)
            AND ($3::text IS NULL OR m.name ILIKE '%' || $3 || '%' OR m.code ILIKE '%' || $3 || '%')
            AND ($4::uuid IS NULL OR m.id > $4)
            AND EXISTS (
              SELECT 1 FROM gcims.menu_variants mv
              LEFT JOIN gcims.outlet_menu_variants omv
                ON omv.company_id = mv.company_id AND omv.outlet_id = $5 AND omv.menu_variant_id = mv.id
              WHERE mv.company_id = m.company_id AND mv.menu_id = m.id AND ($6::boolean OR mv.is_active = TRUE)
                AND ($6::boolean OR COALESCE(omv.is_available, TRUE) = TRUE)
            )
          ORDER BY m.id LIMIT $7
       )
       SELECT m.id AS menu_id, m.name AS menu_name, m.description, m.image_url,
              mc.id AS category_id, mc.name AS category_name,
              mv.id AS menu_variant_id, mv.code AS variant_code, mv.name AS variant_name,
              mv.product_type,mv.retail_inventory_item_id,
              (retail_item.id IS NOT NULL AND retail_item.is_active) AS retail_item_active,
              COALESCE(omv.price_amount, mv.price_amount) AS price_amount,
              mv.is_test_price,
              (m.is_active AND mv.is_active AND COALESCE(omv.is_available, TRUE)) AS is_available,
              r.id AS recipe_id, rv.id AS active_recipe_version_id,
              stock_check.available_quantity
         FROM menu_page mp
         JOIN gcims.menus m ON m.id = mp.id
         LEFT JOIN gcims.menu_categories mc ON mc.company_id = m.company_id AND mc.id = m.category_id
         JOIN gcims.menu_variants mv ON mv.company_id = m.company_id AND mv.menu_id = m.id AND ($6::boolean OR mv.is_active = TRUE)
         LEFT JOIN gcims.outlet_menu_variants omv
           ON omv.company_id = mv.company_id AND omv.outlet_id = $5 AND omv.menu_variant_id = mv.id
         LEFT JOIN gcims.recipes r ON r.company_id = mv.company_id AND r.menu_variant_id = mv.id
         LEFT JOIN gcims.inventory_items retail_item
           ON retail_item.company_id=mv.company_id AND retail_item.id=mv.retail_inventory_item_id
         LEFT JOIN LATERAL (
           SELECT rv2.id FROM gcims.recipe_versions rv2
            WHERE rv2.company_id = r.company_id AND rv2.recipe_id = r.id
              AND rv2.status = 'active' AND rv2.effective_from <= now()
              AND (rv2.effective_to IS NULL OR rv2.effective_to > now())
            ORDER BY rv2.effective_from DESC LIMIT 1
         ) rv ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(LEAST(FLOOR(MIN(
                    CASE WHEN ii.is_active AND NOT ii.allow_negative_stock
                      THEN GREATEST(COALESCE(stock.available_qty_base, 0), 0) / NULLIF(req.required_qty_base, 0)
                      ELSE 0 END
                  )), 2147483647), 0)::integer AS available_quantity
             FROM (
               SELECT ri.inventory_item_id, SUM(ri.quantity_base) AS required_qty_base
                 FROM gcims.recipe_items ri
                WHERE ri.company_id = mv.company_id AND ri.recipe_version_id = rv.id
                GROUP BY ri.inventory_item_id
               UNION ALL
               SELECT mv.retail_inventory_item_id, mv.retail_quantity_base
                WHERE mv.product_type='retail' AND mv.retail_inventory_item_id IS NOT NULL
             ) req
             JOIN gcims.inventory_items ii
               ON ii.company_id = mv.company_id AND ii.id = req.inventory_item_id
             LEFT JOIN LATERAL (
               SELECT SUM(sa.available_qty_base) AS available_qty_base
                 FROM gcims.v_stock_available sa
                 JOIN gcims.outlets stock_outlet
                   ON stock_outlet.company_id = sa.company_id AND stock_outlet.id = $5
                 LEFT JOIN gcims.inventory_lots lot
                   ON lot.company_id = sa.company_id AND lot.inventory_item_id = sa.inventory_item_id
                  AND lot.stock_location_id = sa.stock_location_id AND lot.id = sa.lot_id
                WHERE sa.company_id = $1 AND sa.outlet_id = $5
                  AND sa.stock_location_id = $8 AND sa.inventory_item_id = req.inventory_item_id
                  AND (
                    (ii.track_lot AND sa.lot_id IS NOT NULL AND (
                      (ii.track_expiry AND lot.expiry_date >= (now() AT TIME ZONE stock_outlet.timezone_name)::date)
                      OR (NOT ii.track_expiry AND (lot.expiry_date IS NULL OR lot.expiry_date >= (now() AT TIME ZONE stock_outlet.timezone_name)::date))
                    ))
                    OR (NOT ii.track_lot AND sa.lot_id IS NULL)
                  )
             ) stock ON TRUE
         ) stock_check ON $8::uuid IS NOT NULL
        WHERE ($6::boolean OR COALESCE(omv.is_available, TRUE) = TRUE)
        ORDER BY m.id, mv.id`,
      [request.gcims.companyId, q.categoryId ?? null, q.q ?? null, cursor,
       request.gcims.outletId, q.includeUnavailable === 'true', q.limit + 1,
       q.stockLocationId ?? null]
    );
    const menuIds = [...new Set(result.rows.map((r) => r.menu_id))];
    const hasMore = menuIds.length > q.limit;
    const visibleIds = new Set(menuIds.slice(0, q.limit));
    const grouped = new Map();
    for (const row of result.rows) {
      if (!visibleIds.has(row.menu_id)) continue;
      if (!grouped.has(row.menu_id)) {
        grouped.set(row.menu_id, {
          menu_id: row.menu_id, menu_name: row.menu_name,
          description: row.description, image_url: row.image_url,
          category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
          variants: []
        });
      }
      grouped.get(row.menu_id).variants.push({
        menu_variant_id: row.menu_variant_id, code: row.variant_code,
        name: row.variant_name, price_amount: Number(row.price_amount),
        is_test_price: row.is_test_price,
        currency: 'IDR', is_available: row.is_available,
        available_quantity: q.stockLocationId ? row.available_quantity : null,
        is_in_stock: q.stockLocationId ? Number(row.available_quantity) > 0 : null,
        is_sellable: row.is_available && (row.product_type === 'retail'
          ? Boolean(row.retail_item_active)
          : Boolean(row.active_recipe_version_id))
          && (!q.stockLocationId || Number(row.available_quantity) > 0),
        sellability_reason: !row.is_available ? 'not_available'
          : row.product_type === 'retail' && !row.retail_item_active ? 'retail_item_required'
            : row.product_type !== 'retail' && !row.active_recipe_version_id ? (row.recipe_id ? 'active_recipe_required' : 'recipe_required')
              : q.stockLocationId && Number(row.available_quantity) <= 0 ? 'insufficient_stock' : null,
        product_type: row.product_type,
        active_recipe_version_id: row.active_recipe_version_id
      });
    }
    return {
      data: [...grouped.values()],
      page: { limit: q.limit, next_cursor: hasMore ? encodeCursor(menuIds[q.limit - 1]) : null }
    };
  });
}

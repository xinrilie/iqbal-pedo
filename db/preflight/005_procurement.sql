-- Read-only preflight for db/migrations/0005_procurement_mvp.sql.
-- Run with psql -X -v ON_ERROR_STOP=1 before applying migration 005.
-- This script does not repair or modify user data.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  required_table TEXT;
  missing_tables TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'GCIMS Procurement requires PostgreSQL 15 or newer.';
  END IF;

  FOREACH required_table IN ARRAY ARRAY[
    'gcims.goods_receipts',
    'gcims.goods_receipt_items',
    'gcims.purchase_orders',
    'gcims.purchase_order_items',
    'gcims.supplier_inventory_items',
    'gcims.inventory_lots',
    'gcims.permissions',
    'gcims.role_permissions',
    'gcims.roles'
  ] LOOP
    IF to_regclass(required_table) IS NULL THEN
      missing_tables := array_append(missing_tables, required_table);
    END IF;
  END LOOP;

  IF cardinality(missing_tables) > 0 THEN
    RAISE EXCEPTION 'Prerequisite schema missing: %. Apply schema Sesi 1 and migrations Sesi 2–4 first.', array_to_string(missing_tables, ', ');
  END IF;
END $$;

WITH checks AS (
  SELECT
    'receipt_line_unresolvable'::TEXT AS check_name,
    COUNT(*)::BIGINT AS affected_rows,
    'Receipt line tidak dapat dipetakan ke header GR atau PO line; backfill migration 005 tidak aman.'::TEXT AS explanation
  FROM gcims.goods_receipt_items gri
  LEFT JOIN gcims.goods_receipts gr
    ON gr.company_id = gri.company_id
   AND gr.outlet_id = gri.outlet_id
   AND gr.id = gri.goods_receipt_id
  LEFT JOIN gcims.purchase_order_items poi
    ON poi.company_id = gri.company_id
   AND poi.id = gri.purchase_order_item_id
  WHERE gr.id IS NULL OR poi.id IS NULL

  UNION ALL

  SELECT
    'receipt_line_po_mismatch',
    COUNT(*)::BIGINT,
    'PO line yang dirujuk bukan bagian dari PO pada header Goods Receipt.'
  FROM gcims.goods_receipt_items gri
  JOIN gcims.goods_receipts gr
    ON gr.company_id = gri.company_id
   AND gr.outlet_id = gri.outlet_id
   AND gr.id = gri.goods_receipt_id
  JOIN gcims.purchase_order_items poi
    ON poi.company_id = gri.company_id
   AND poi.id = gri.purchase_order_item_id
  WHERE poi.purchase_order_id <> gr.purchase_order_id

  UNION ALL

  SELECT
    'duplicate_preferred_supplier_item',
    COUNT(*)::BIGINT,
    'Lebih dari satu supplier preferred aktif untuk item yang sama dalam satu company.'
  FROM (
    SELECT company_id, inventory_item_id
    FROM gcims.supplier_inventory_items
    WHERE is_preferred = TRUE AND is_active = TRUE
    GROUP BY company_id, inventory_item_id
    HAVING COUNT(*) > 1
  ) duplicates

  UNION ALL

  SELECT
    'negative_accepted_quantity',
    COUNT(*)::BIGINT,
    'Receipt line memiliki quantity_accepted_base negatif; constraint 005 akan menolaknya.'
  FROM gcims.goods_receipt_items
  WHERE quantity_accepted_base < 0

  UNION ALL

  SELECT
    'rejected_quantity_without_reason',
    COUNT(*)::BIGINT,
    'Receipt line memiliki kuantitas ditolak tanpa alasan; constraint 005 akan menolaknya.'
  FROM gcims.goods_receipt_items
  WHERE quantity_rejected_purchase_uom > 0
    AND NULLIF(BTRIM(rejection_reason), '') IS NULL
)
SELECT
  check_name,
  affected_rows,
  CASE WHEN affected_rows = 0 THEN 'OK' ELSE 'BLOCK' END AS status,
  explanation
FROM checks
ORDER BY check_name;

ROLLBACK;

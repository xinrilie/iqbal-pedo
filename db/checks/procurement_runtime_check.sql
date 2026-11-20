-- GCIMS Procurement Sesi 4 — READ-ONLY runtime schema audit
-- Target: db_gcims_test, schema gcims
-- This script makes no changes. Safe to run with psql -v ON_ERROR_STOP=1 -f.

\echo '1) Required procurement tables'
SELECT x.table_name,
       CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM (VALUES
  ('suppliers'),
  ('supplier_inventory_items'),
  ('item_uom_conversions'),
  ('inventory_lots'),
  ('purchase_orders'),
  ('purchase_order_items'),
  ('goods_receipts'),
  ('goods_receipt_items'),
  ('stock_ledger'),
  ('audit_logs')
) AS x(table_name)
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'gcims'
 AND t.table_name = x.table_name
 AND t.table_type = 'BASE TABLE'
ORDER BY x.table_name;

\echo '2) Columns and defaults for procurement tables'
SELECT table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'gcims'
  AND table_name IN (
    'suppliers', 'supplier_inventory_items', 'item_uom_conversions',
    'purchase_orders', 'purchase_order_items',
    'goods_receipts', 'goods_receipt_items', 'inventory_lots'
  )
ORDER BY table_name, ordinal_position;

\echo '3) Constraints and foreign keys'
SELECT con.conrelid::regclass AS table_name,
       con.conname,
       con.contype,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'gcims'
  AND c.relname IN (
    'suppliers', 'supplier_inventory_items', 'purchase_orders',
    'purchase_order_items', 'goods_receipts', 'goods_receipt_items',
    'inventory_lots', 'stock_ledger'
  )
ORDER BY table_name, conname;

\echo '4) Indexes'
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'gcims'
  AND tablename IN (
    'suppliers', 'supplier_inventory_items',
    'purchase_orders', 'purchase_order_items',
    'goods_receipts', 'goods_receipt_items', 'inventory_lots', 'stock_ledger'
  )
ORDER BY tablename, indexname;

\echo '5) Procurement permissions currently seeded'
SELECT code, module, description
FROM gcims.permissions
WHERE module IN ('supplier', 'procurement', 'purchasing', 'receiving')
   OR code ILIKE '%supplier%'
   OR code ILIKE '%procurement%'
   OR code ILIKE '%purchase%'
   OR code ILIKE '%receipt%'
ORDER BY code;

\echo '6) Existing procurement data counts (read-only)'
SELECT format(
         'SELECT %L AS entity, count(*)::bigint AS rows FROM %I.%I;',
         x.table_name, 'gcims', x.table_name
       ) AS sql_to_run
FROM (VALUES
  ('suppliers'), ('supplier_inventory_items'), ('purchase_orders'),
  ('purchase_order_items'), ('goods_receipts'), ('goods_receipt_items')
) AS x(table_name)
JOIN information_schema.tables t
  ON t.table_schema = 'gcims' AND t.table_name = x.table_name
 AND t.table_type = 'BASE TABLE'
ORDER BY x.table_name
\gexec

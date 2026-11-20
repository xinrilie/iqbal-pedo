-- Read-only preflight for db/migrations/0006_maker_checker_hardening.sql.
-- Run with psql -X -v ON_ERROR_STOP=1 before applying migration 006.
-- Existing self-approved/unknown-maker documents require explicit review.
BEGIN TRANSACTION READ ONLY;

DO $$
DECLARE
  required_table TEXT;
  missing_tables TEXT[] := ARRAY[]::TEXT[];
  missing_columns TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF current_setting('server_version_num')::INTEGER < 150000 THEN
    RAISE EXCEPTION 'GCIMS Procurement requires PostgreSQL 15 or newer.';
  END IF;

  FOREACH required_table IN ARRAY ARRAY[
    'gcims.purchase_orders',
    'gcims.purchase_order_items',
    'gcims.goods_receipts',
    'gcims.goods_receipt_items'
  ] LOOP
    IF to_regclass(required_table) IS NULL THEN
      missing_tables := array_append(missing_tables, required_table);
    END IF;
  END LOOP;

  IF cardinality(missing_tables) > 0 THEN
    RAISE EXCEPTION 'Prerequisite schema missing: %. Apply migration 005 first.', array_to_string(missing_tables, ', ');
  END IF;

  FOREACH required_table IN ARRAY ARRAY[
    'gcims.purchase_orders.idempotency_key',
    'gcims.purchase_orders.idempotency_request_hash',
    'gcims.goods_receipts.idempotency_key',
    'gcims.goods_receipts.idempotency_request_hash',
    'gcims.goods_receipt_items.purchase_order_id',
    'gcims.goods_receipt_items.received_lot_code',
    'gcims.goods_receipt_items.expiry_date'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = split_part(required_table, '.', 1)
        AND c.table_name = split_part(required_table, '.', 2)
        AND c.column_name = split_part(required_table, '.', 3)
    ) THEN
      missing_columns := array_append(missing_columns, required_table);
    END IF;
  END LOOP;

  IF cardinality(missing_columns) > 0 THEN
    RAISE EXCEPTION 'Migration 005 columns missing: %. Apply/verify migration 005 before migration 006.', array_to_string(missing_columns, ', ');
  END IF;
END $$;

WITH checks AS (
  SELECT
    'po_approved_without_distinct_maker'::TEXT AS check_name,
    COUNT(*)::BIGINT AS affected_rows,
    'PO sudah disetujui tetapi pembuat tidak tercatat atau sama dengan approver.'::TEXT AS explanation
  FROM gcims.purchase_orders
  WHERE approved_by IS NOT NULL
    AND (created_by IS NULL OR approved_by = created_by)

  UNION ALL

  SELECT
    'gr_approved_without_distinct_receiver',
    COUNT(*)::BIGINT,
    'Goods Receipt sudah disetujui tetapi penerima tidak tercatat atau sama dengan approver.'
  FROM gcims.goods_receipts
  WHERE approved_by IS NOT NULL
    AND (received_by IS NULL OR approved_by = received_by)
)
SELECT
  check_name,
  affected_rows,
  CASE WHEN affected_rows = 0 THEN 'OK' ELSE 'BLOCK' END AS status,
  explanation
FROM checks
ORDER BY check_name;

ROLLBACK;

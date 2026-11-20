-- GCIMS v0.3.x — Corrective hardening after Procurement migration 005.
-- Keep migration 005 immutable; this migration scopes its constraint guards,
-- enforces maker-checker at the database boundary, and adds the GR lookup index.
-- Run db/preflight/006_maker_checker.sql first. Take a backup before deployment.
BEGIN;

-- Repair/verify the target-table scoping of constraints introduced in 005.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.purchase_orders'::regclass
      AND conname = 'ck_purchase_order_idempotency_pair'
  ) THEN
    ALTER TABLE gcims.purchase_orders
      ADD CONSTRAINT ck_purchase_order_idempotency_pair
      CHECK (
        (idempotency_key IS NULL AND idempotency_request_hash IS NULL) OR
        (idempotency_key IS NOT NULL
         AND length(idempotency_key) BETWEEN 16 AND 120
         AND idempotency_request_hash IS NOT NULL
         AND idempotency_request_hash ~ '^[0-9a-f]{64}$')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.goods_receipts'::regclass
      AND conname = 'ck_goods_receipt_idempotency_pair'
  ) THEN
    ALTER TABLE gcims.goods_receipts
      ADD CONSTRAINT ck_goods_receipt_idempotency_pair
      CHECK (
        (idempotency_key IS NULL AND idempotency_request_hash IS NULL) OR
        (idempotency_key IS NOT NULL
         AND length(idempotency_key) BETWEEN 16 AND 120
         AND idempotency_request_hash IS NOT NULL
         AND idempotency_request_hash ~ '^[0-9a-f]{64}$')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.purchase_order_items'::regclass
      AND conname = 'uq_po_item_company_po_id_inventory'
  ) THEN
    ALTER TABLE gcims.purchase_order_items
      ADD CONSTRAINT uq_po_item_company_po_id_inventory
      UNIQUE (company_id, purchase_order_id, id, inventory_item_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.goods_receipts'::regclass
      AND conname = 'uq_goods_receipt_company_id_outlet_po'
  ) THEN
    ALTER TABLE gcims.goods_receipts
      ADD CONSTRAINT uq_goods_receipt_company_id_outlet_po
      UNIQUE (company_id, id, outlet_id, purchase_order_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.goods_receipt_items'::regclass
      AND conname = 'fk_receipt_item_header_po'
  ) THEN
    ALTER TABLE gcims.goods_receipt_items
      ADD CONSTRAINT fk_receipt_item_header_po
      FOREIGN KEY (company_id, goods_receipt_id, outlet_id, purchase_order_id)
      REFERENCES gcims.goods_receipts(company_id, id, outlet_id, purchase_order_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.goods_receipt_items'::regclass
      AND conname = 'fk_receipt_item_po_line_same_po'
  ) THEN
    ALTER TABLE gcims.goods_receipt_items
      ADD CONSTRAINT fk_receipt_item_po_line_same_po
      FOREIGN KEY (company_id, purchase_order_id, purchase_order_item_id, inventory_item_id)
      REFERENCES gcims.purchase_order_items(company_id, purchase_order_id, id, inventory_item_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Fail-closed database constraints: an approved document must retain a maker
-- and that maker must be different from the approving user.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.purchase_orders'::regclass
      AND conname = 'ck_po_maker_checker'
  ) THEN
    ALTER TABLE gcims.purchase_orders
      ADD CONSTRAINT ck_po_maker_checker
      CHECK (
        approved_by IS NULL OR
        (created_by IS NOT NULL AND approved_by IS DISTINCT FROM created_by)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'gcims.goods_receipts'::regclass
      AND conname = 'ck_gr_maker_checker'
  ) THEN
    ALTER TABLE gcims.goods_receipts
      ADD CONSTRAINT ck_gr_maker_checker
      CHECK (
        approved_by IS NULL OR
        (received_by IS NOT NULL AND approved_by IS DISTINCT FROM received_by)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE gcims.purchase_orders VALIDATE CONSTRAINT ck_po_maker_checker;
ALTER TABLE gcims.goods_receipts VALIDATE CONSTRAINT ck_gr_maker_checker;

-- getGoodsReceipt/list/submit/post filter lines by company + receipt ID.
CREATE INDEX IF NOT EXISTS ix_goods_receipt_items_company_receipt_id
  ON gcims.goods_receipt_items (company_id, goods_receipt_id, id);

COMMIT;

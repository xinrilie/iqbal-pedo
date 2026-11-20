-- GCIMS v0.3.0 — Procurement MVP schema hardening.
-- Apply after db/migrations/0001_schema_sesi1.sql through db/migrations/0004_inventory_engine_s3.sql.
-- Additive/backfill-safe migration. Always take a backup before production use.
BEGIN;

-- Idempotency at document creation boundaries.
ALTER TABLE gcims.purchase_orders
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS idempotency_request_hash CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_idempotency
  ON gcims.purchase_orders (company_id, outlet_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE gcims.goods_receipts
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS idempotency_request_hash CHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_goods_receipts_idempotency
  ON gcims.goods_receipts (company_id, outlet_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_purchase_order_idempotency_pair') THEN
    ALTER TABLE gcims.purchase_orders ADD CONSTRAINT ck_purchase_order_idempotency_pair
      CHECK ((idempotency_key IS NULL AND idempotency_request_hash IS NULL) OR
             (idempotency_key IS NOT NULL AND length(idempotency_key) BETWEEN 16 AND 120 AND idempotency_request_hash IS NOT NULL AND idempotency_request_hash ~ '^[0-9a-f]{64}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_goods_receipt_idempotency_pair') THEN
    ALTER TABLE gcims.goods_receipts ADD CONSTRAINT ck_goods_receipt_idempotency_pair
      CHECK ((idempotency_key IS NULL AND idempotency_request_hash IS NULL) OR
             (idempotency_key IS NOT NULL AND length(idempotency_key) BETWEEN 16 AND 120 AND idempotency_request_hash IS NOT NULL AND idempotency_request_hash ~ '^[0-9a-f]{64}$'));
  END IF;
END $$;

-- Persist the PO identity on each receipt line. This lets PostgreSQL enforce
-- that a receipt line can only reference an item belonging to its header PO.
ALTER TABLE gcims.goods_receipt_items
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID,
  ADD COLUMN IF NOT EXISTS received_lot_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS supplier_lot_code VARCHAR(100),
  ADD COLUMN IF NOT EXISTS manufactured_at DATE,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

UPDATE gcims.goods_receipt_items gri
   SET purchase_order_id = gr.purchase_order_id
  FROM gcims.goods_receipts gr
 WHERE gri.goods_receipt_id = gr.id
   AND gri.company_id = gr.company_id
   AND gri.outlet_id = gr.outlet_id
   AND gri.purchase_order_id IS NULL;

UPDATE gcims.goods_receipt_items gri
   SET received_lot_code = COALESCE(gri.received_lot_code, l.lot_code),
       supplier_lot_code = COALESCE(gri.supplier_lot_code, l.supplier_lot_code),
       manufactured_at = COALESCE(gri.manufactured_at, l.manufactured_at),
       expiry_date = COALESCE(gri.expiry_date, l.expiry_date)
  FROM gcims.inventory_lots l
 WHERE gri.lot_id = l.id AND gri.company_id = l.company_id;

ALTER TABLE gcims.goods_receipt_items
  ALTER COLUMN purchase_order_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_po_item_company_po_id_inventory') THEN
    ALTER TABLE gcims.purchase_order_items
      ADD CONSTRAINT uq_po_item_company_po_id_inventory
      UNIQUE (company_id, purchase_order_id, id, inventory_item_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_goods_receipt_company_id_outlet_po') THEN
    ALTER TABLE gcims.goods_receipts
      ADD CONSTRAINT uq_goods_receipt_company_id_outlet_po
      UNIQUE (company_id, id, outlet_id, purchase_order_id);
  END IF;
END $$;

ALTER TABLE gcims.goods_receipt_items
  DROP CONSTRAINT IF EXISTS fk_receipt_item_header,
  DROP CONSTRAINT IF EXISTS fk_receipt_item_po_line;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_receipt_item_header_po') THEN
    ALTER TABLE gcims.goods_receipt_items
      ADD CONSTRAINT fk_receipt_item_header_po
      FOREIGN KEY (company_id, goods_receipt_id, outlet_id, purchase_order_id)
      REFERENCES gcims.goods_receipts(company_id, id, outlet_id, purchase_order_id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_receipt_item_po_line_same_po') THEN
    ALTER TABLE gcims.goods_receipt_items
      ADD CONSTRAINT fk_receipt_item_po_line_same_po
      FOREIGN KEY (company_id, purchase_order_id, purchase_order_item_id, inventory_item_id)
      REFERENCES gcims.purchase_order_items(company_id, purchase_order_id, id, inventory_item_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- A completely rejected delivery is still a valid receiving event. It must be
-- recorded for audit, but it must not create a positive stock ledger movement.
ALTER TABLE gcims.goods_receipt_items
  DROP CONSTRAINT IF EXISTS goods_receipt_items_quantity_accepted_base_check;
ALTER TABLE gcims.goods_receipt_items
  DROP CONSTRAINT IF EXISTS ck_receipt_item_accepted_nonnegative;
ALTER TABLE gcims.goods_receipt_items
  ADD CONSTRAINT ck_receipt_item_accepted_nonnegative
  CHECK (quantity_accepted_base >= 0);

ALTER TABLE gcims.goods_receipt_items
  DROP CONSTRAINT IF EXISTS ck_receipt_item_rejection_reason;
ALTER TABLE gcims.goods_receipt_items
  ADD CONSTRAINT ck_receipt_item_rejection_reason
  CHECK (quantity_rejected_purchase_uom = 0 OR NULLIF(BTRIM(rejection_reason), '') IS NOT NULL);

ALTER TABLE gcims.goods_receipt_items
  DROP CONSTRAINT IF EXISTS ck_receipt_item_lot_metadata;
ALTER TABLE gcims.goods_receipt_items
  ADD CONSTRAINT ck_receipt_item_lot_metadata
  CHECK (expiry_date IS NULL OR received_lot_code IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_inventory_preferred_item
  ON gcims.supplier_inventory_items (company_id, inventory_item_id)
  WHERE is_preferred = TRUE AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_goods_receipt_items_po_line_header
  ON gcims.goods_receipt_items (company_id, purchase_order_id, purchase_order_item_id);
CREATE INDEX IF NOT EXISTS ix_goods_receipts_outlet_received
  ON gcims.goods_receipts (company_id, outlet_id, received_at DESC, id DESC);

-- Procurement RBAC. Existing company-scoped ADMIN roles receive these permissions.
INSERT INTO gcims.permissions (code, module, description) VALUES
  ('procurement.supplier.read', 'procurement', 'Melihat data supplier'),
  ('procurement.supplier.write', 'procurement', 'Membuat dan mengubah data supplier'),
  ('procurement.catalog.read', 'procurement', 'Melihat katalog item supplier'),
  ('procurement.catalog.write', 'procurement', 'Mengelola katalog item supplier'),
  ('procurement.po.read', 'procurement', 'Melihat purchase order'),
  ('procurement.po.create', 'procurement', 'Membuat purchase order'),
  ('procurement.po.submit', 'procurement', 'Mengirim purchase order untuk approval'),
  ('procurement.po.approve', 'procurement', 'Menyetujui purchase order'),
  ('procurement.po.send', 'procurement', 'Menandai purchase order telah dikirim ke supplier'),
  ('procurement.po.cancel', 'procurement', 'Membatalkan purchase order'),
  ('procurement.po.close', 'procurement', 'Menutup purchase order yang telah diterima penuh'),
  ('procurement.receipt.read', 'procurement', 'Melihat goods receipt'),
  ('procurement.receipt.create', 'procurement', 'Mencatat penerimaan barang'),
  ('procurement.receipt.submit', 'procurement', 'Mengirim goods receipt untuk approval'),
  ('procurement.receipt.approve', 'procurement', 'Menyetujui goods receipt'),
  ('procurement.receipt.post', 'procurement', 'Memposting barang diterima ke inventory ledger')
ON CONFLICT (code) DO UPDATE
  SET module = EXCLUDED.module, description = EXCLUDED.description;

INSERT INTO gcims.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM gcims.roles r
  JOIN gcims.permissions p ON p.module = 'procurement'
 WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

COMMIT;

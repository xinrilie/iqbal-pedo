-- Allow inventory-backed retail products in the shared POS catalog.
BEGIN;
SET LOCAL search_path = gcims, public;

ALTER TABLE gcims.menu_variants
  ADD COLUMN product_type VARCHAR(20) NOT NULL DEFAULT 'prepared'
    CHECK (product_type IN ('prepared','retail')),
  ADD COLUMN retail_inventory_item_id UUID,
  ADD COLUMN retail_quantity_base NUMERIC(18,6) NOT NULL DEFAULT 1
    CHECK (retail_quantity_base > 0);

ALTER TABLE gcims.menu_variants
  ADD CONSTRAINT fk_menu_variant_retail_inventory
    FOREIGN KEY (company_id, retail_inventory_item_id)
    REFERENCES gcims.inventory_items(company_id, id),
  ADD CONSTRAINT ck_menu_variant_retail_mapping CHECK (
    (product_type = 'prepared' AND retail_inventory_item_id IS NULL)
    OR (product_type = 'retail' AND retail_inventory_item_id IS NOT NULL)
  );

CREATE INDEX ix_menu_variants_retail_inventory
  ON gcims.menu_variants(company_id, retail_inventory_item_id)
  WHERE product_type = 'retail';

INSERT INTO gcims.menu_categories(company_id,code,name,sort_order,is_active)
SELECT company.id,category.code,category.name,category.sort_order,TRUE
  FROM gcims.companies company
 CROSS JOIN (VALUES ('MART','Mart',900),('STATIONERY','Alat Tulis',910),('DAILY_NEEDS','Kebutuhan Harian',920))
      AS category(code,name,sort_order)
ON CONFLICT (company_id,code) DO NOTHING;

COMMIT;

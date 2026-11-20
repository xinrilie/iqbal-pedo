-- Align catalog metadata and governed package-content conversions with the
-- READY + Operational Master reference workbooks.
BEGIN;
SET LOCAL search_path = gcims, public;

ALTER TABLE gcims.inventory_items
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS division VARCHAR(40),
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(60),
  ADD COLUMN IF NOT EXISTS subcategory VARCHAR(120),
  ADD COLUMN IF NOT EXISTS specification VARCHAR(160),
  ADD COLUMN IF NOT EXISTS canonical_name VARCHAR(240),
  ADD COLUMN IF NOT EXISTS reference_status VARCHAR(12)
    CHECK (reference_status IS NULL OR reference_status IN ('YES','NO'));

ALTER TABLE gcims.menus
  ADD COLUMN IF NOT EXISTS canonical_name VARCHAR(240);

ALTER TABLE gcims.menu_variants
  ADD COLUMN IF NOT EXISTS is_test_price BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE gcims.item_uom_conversions
  ADD COLUMN IF NOT EXISTS conversion_basis VARCHAR(24) NOT NULL DEFAULT 'same_dimension',
  ADD COLUMN IF NOT EXISTS conversion_note TEXT;

ALTER TABLE gcims.item_uom_conversions
  ADD CONSTRAINT ck_conversion_basis
    CHECK (conversion_basis IN ('same_dimension','package_content')),
  ADD CONSTRAINT ck_package_conversion_has_note
    CHECK (conversion_basis <> 'package_content' OR NULLIF(BTRIM(conversion_note),'') IS NOT NULL);

CREATE OR REPLACE FUNCTION gcims.validate_item_uom_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_dimension VARCHAR(20);
    v_base_dimension VARCHAR(20);
    v_base_uom_id UUID;
BEGIN
    SELECT dimension INTO v_from_dimension
      FROM gcims.uoms WHERE id = NEW.from_uom_id;
    SELECT i.base_uom_id, u.dimension
      INTO v_base_uom_id, v_base_dimension
      FROM gcims.inventory_items i
      JOIN gcims.uoms u ON u.id = i.base_uom_id
     WHERE i.id = NEW.inventory_item_id AND i.company_id = NEW.company_id;

    IF v_from_dimension IS NULL OR v_base_dimension IS NULL THEN
        RAISE EXCEPTION 'UOM or inventory item was not found';
    END IF;
    IF NEW.from_uom_id = v_base_uom_id THEN
        RAISE EXCEPTION 'A conversion row cannot convert the base UOM to itself';
    END IF;
    IF v_from_dimension <> v_base_dimension AND (
        NEW.conversion_basis <> 'package_content'
        OR NULLIF(BTRIM(NEW.conversion_note),'') IS NULL
    ) THEN
        RAISE EXCEPTION 'Cross-dimension conversion requires a documented package_content rule';
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;

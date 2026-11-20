-- GCIMS FEFO integration-test fixture
-- SAFE SCOPE: db_gcims_test only. Adds a dedicated item/menu/lots; does not alter live demo item balances.
-- Run once. The append-only opening-balance ledger rows are intentionally retained as test history.

BEGIN;

DO $$
DECLARE
    v_company_id UUID;
    v_outlet_id UUID;
    v_stock_location_id UUID;
    v_admin_user_id UUID;
    v_ml_uom_id UUID;
    v_inventory_item_id UUID;
    v_menu_id UUID;
    v_variant_id UUID;
    v_recipe_id UUID;
    v_recipe_version_id UUID;
    v_batch_id UUID := gen_random_uuid();
    v_lot_near_id UUID;
    v_lot_mid_id UUID;
    v_lot_far_id UUID;
    v_today DATE;
BEGIN
    IF current_database() <> 'db_gcims_test' THEN
        RAISE EXCEPTION 'Refusing to create FEFO fixture outside db_gcims_test (current database: %)', current_database();
    END IF;

    SELECT c.id
      INTO v_company_id
      FROM gcims.companies c
     WHERE c.code = 'GOURMET-COFFEE';
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Company GOURMET-COFFEE not found';
    END IF;

    SELECT o.id, sl.id, (now() AT TIME ZONE o.timezone_name)::date
      INTO v_outlet_id, v_stock_location_id, v_today
      FROM gcims.outlets o
      JOIN gcims.stock_locations sl
        ON sl.company_id = o.company_id
       AND sl.outlet_id = o.id
       AND sl.code = 'MAIN'
     WHERE o.company_id = v_company_id
       AND o.code = 'MAIN'
       AND o.is_active
       AND sl.is_active;
    IF v_outlet_id IS NULL OR v_stock_location_id IS NULL THEN
        RAISE EXCEPTION 'Active MAIN outlet/stock location not found';
    END IF;

    SELECT u.id
      INTO v_admin_user_id
      FROM gcims.users u
      JOIN gcims.company_memberships cm
        ON cm.user_id = u.id
       AND cm.company_id = v_company_id
     WHERE u.is_active
       AND cm.membership_status = 'active'
     ORDER BY u.created_at, u.id
     LIMIT 1;
    IF v_admin_user_id IS NULL THEN
        RAISE EXCEPTION 'No active company user found to attribute FEFO test ledger entries';
    END IF;

    SELECT id INTO v_ml_uom_id
      FROM gcims.uoms
     WHERE code = 'ml' AND is_active;
    IF v_ml_uom_id IS NULL THEN
        RAISE EXCEPTION 'Active ml UOM not found';
    END IF;

    IF EXISTS (
        SELECT 1 FROM gcims.inventory_items
         WHERE company_id = v_company_id AND sku = 'ZZ-FEFO-TEST-001'
    ) OR EXISTS (
        SELECT 1 FROM gcims.menus
         WHERE company_id = v_company_id AND code = 'ZZ-FEFO-TEST-MENU'
    ) THEN
        RAISE EXCEPTION 'FEFO test fixture already exists. Do not rerun setup; inspect the existing ZZ-FEFO test fixture instead.';
    END IF;

    -- Dedicated lot/expiry-tracked test ingredient; regular Fresh Milk remains untouched.
    INSERT INTO gcims.inventory_items
        (company_id, sku, name, base_uom_id, track_lot, track_expiry,
         allow_negative_stock, is_active)
    VALUES
        (v_company_id, 'ZZ-FEFO-TEST-001', 'FEFO Test Ingredient', v_ml_uom_id,
         TRUE, TRUE, FALSE, TRUE)
    RETURNING id INTO v_inventory_item_id;

    -- Insert lots in deliberately non-FEFO order (far, middle, near).
    -- The inventory service must choose by expiry_date, not insertion order.
    INSERT INTO gcims.inventory_lots
        (company_id, inventory_item_id, stock_location_id, lot_code,
         received_at, expiry_date, notes)
    VALUES
        (v_company_id, v_inventory_item_id, v_stock_location_id, 'FEFO-FAR',
         now() - interval '3 days', v_today + 30, 'FEFO integration test: far expiry')
    RETURNING id INTO v_lot_far_id;

    INSERT INTO gcims.inventory_lots
        (company_id, inventory_item_id, stock_location_id, lot_code,
         received_at, expiry_date, notes)
    VALUES
        (v_company_id, v_inventory_item_id, v_stock_location_id, 'FEFO-MID',
         now() - interval '2 days', v_today + 14, 'FEFO integration test: middle expiry')
    RETURNING id INTO v_lot_mid_id;

    INSERT INTO gcims.inventory_lots
        (company_id, inventory_item_id, stock_location_id, lot_code,
         received_at, expiry_date, notes)
    VALUES
        (v_company_id, v_inventory_item_id, v_stock_location_id, 'FEFO-NEAR',
         now() - interval '1 day', v_today + 7, 'FEFO integration test: nearest expiry')
    RETURNING id INTO v_lot_near_id;

    -- Opening balances by lot: NEAR=5 ml, MID=10 ml, FAR=20 ml.
    -- Total test-only stock = 35 ml; one test sale consumes 8 ml.
    INSERT INTO gcims.stock_ledger
        (company_id, outlet_id, stock_location_id, inventory_item_id, lot_id,
         movement_type, quantity_delta_base, occurred_at, source_type, source_id,
         idempotency_key, reason, actor_user_id)
    VALUES
        (v_company_id, v_outlet_id, v_stock_location_id, v_inventory_item_id, v_lot_far_id,
         'opening_balance', 20.000000, now(), 'opening', v_batch_id,
         'gcims-fefo-test-opening:FEFO-FAR', 'FEFO test fixture opening balance', v_admin_user_id),
        (v_company_id, v_outlet_id, v_stock_location_id, v_inventory_item_id, v_lot_mid_id,
         'opening_balance', 10.000000, now(), 'opening', v_batch_id,
         'gcims-fefo-test-opening:FEFO-MID', 'FEFO test fixture opening balance', v_admin_user_id),
        (v_company_id, v_outlet_id, v_stock_location_id, v_inventory_item_id, v_lot_near_id,
         'opening_balance', 5.000000, now(), 'opening', v_batch_id,
         'gcims-fefo-test-opening:FEFO-NEAR', 'FEFO test fixture opening balance', v_admin_user_id);

    -- Dedicated POS test menu whose BOM consumes 8 ml of the lot-tracked ingredient.
    INSERT INTO gcims.menus (company_id, code, name, description, is_active)
    VALUES
        (v_company_id, 'ZZ-FEFO-TEST-MENU', 'ZZ FEFO Test Menu',
         'Internal-only FEFO integration test item; deactivate after the test.', TRUE)
    RETURNING id INTO v_menu_id;

    INSERT INTO gcims.menu_variants
        (company_id, menu_id, code, name, price_amount, is_default, is_active)
    VALUES
        (v_company_id, v_menu_id, 'TEST', 'FEFO Test', 10000, TRUE, TRUE)
    RETURNING id INTO v_variant_id;

    INSERT INTO gcims.outlet_menu_variants
        (company_id, outlet_id, menu_variant_id, price_amount, is_available)
    VALUES
        (v_company_id, v_outlet_id, v_variant_id, 10000, TRUE);

    INSERT INTO gcims.recipes (company_id, menu_variant_id, name)
    VALUES (v_company_id, v_variant_id, 'FEFO Test Recipe')
    RETURNING id INTO v_recipe_id;

    -- Insert recipe lines while version is draft; then activate the immutable version.
    INSERT INTO gcims.recipe_versions
        (company_id, recipe_id, version_no, status, effective_from, notes, created_by, approved_by)
    VALUES
        (v_company_id, v_recipe_id, 1, 'draft', now(),
         'FEFO integration test only: 8 ml from lot-tracked test ingredient',
         v_admin_user_id, v_admin_user_id)
    RETURNING id INTO v_recipe_version_id;

    INSERT INTO gcims.recipe_items
        (company_id, recipe_version_id, line_no, inventory_item_id, quantity_base, preparation_note)
    VALUES
        (v_company_id, v_recipe_version_id, 1, v_inventory_item_id, 8.000000,
         'FEFO test: expected 5 ml from nearest-expiry lot and 3 ml from next lot');

    UPDATE gcims.recipe_versions
       SET status = 'active'
     WHERE company_id = v_company_id
       AND id = v_recipe_version_id
       AND status = 'draft';

    RAISE NOTICE 'FEFO fixture created. Variant ID: %, inventory item ID: %, lot balances: NEAR 5 ml / MID 10 ml / FAR 20 ml.',
        v_variant_id, v_inventory_item_id;
END;
$$;

COMMIT;

-- Show the variant ID needed for the POS API request and confirm lots are seeded.
SELECT m.code AS menu_code,
       mv.id AS menu_variant_id,
       i.sku AS inventory_sku,
       l.lot_code,
       l.expiry_date,
       v.on_hand_qty_base
  FROM gcims.menus m
  JOIN gcims.menu_variants mv
    ON mv.company_id = m.company_id AND mv.menu_id = m.id
  JOIN gcims.recipes r
    ON r.company_id = mv.company_id AND r.menu_variant_id = mv.id
  JOIN gcims.recipe_versions rv
    ON rv.company_id = r.company_id AND rv.recipe_id = r.id
   AND rv.status = 'active'
  JOIN gcims.recipe_items ri
    ON ri.company_id = rv.company_id AND ri.recipe_version_id = rv.id
  JOIN gcims.inventory_items i
    ON i.company_id = ri.company_id AND i.id = ri.inventory_item_id
  JOIN gcims.inventory_lots l
    ON l.company_id = i.company_id AND l.inventory_item_id = i.id
  JOIN gcims.v_stock_on_hand v
    ON v.company_id = l.company_id
   AND v.inventory_item_id = l.inventory_item_id
   AND v.stock_location_id = l.stock_location_id
   AND v.lot_id = l.id
 WHERE m.company_id = (SELECT id FROM gcims.companies WHERE code = 'GOURMET-COFFEE')
   AND m.code = 'ZZ-FEFO-TEST-MENU'
 ORDER BY l.expiry_date, l.lot_code;

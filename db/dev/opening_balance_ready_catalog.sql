-- Simulated opening balances for the READY reference catalog in db_gcims_test only.
-- Quantity per SKU covers 10 servings of every currently active READY menu.
-- This is test stock, not a physical count; never run on a production database.
-- Idempotent: a matching prior batch is a no-op; partial/mismatched batches abort.
BEGIN;
SET LOCAL search_path = gcims, public;

CREATE TEMP TABLE _test_catalog_scope ON COMMIT DROP AS
SELECT c.id AS company_id, o.id AS outlet_id, sl.id AS stock_location_id,
       (SELECT u.id
          FROM gcims.users u
          JOIN gcims.company_memberships cm ON cm.user_id=u.id AND cm.company_id=c.id AND cm.membership_status='active'
          JOIN gcims.user_role_assignments ura ON ura.company_id=c.id AND ura.user_id=u.id
          JOIN gcims.roles r ON r.id=ura.role_id AND r.company_id=ura.company_id AND r.code='ADMIN'
         WHERE u.is_active
         ORDER BY u.created_at,u.id LIMIT 1) AS actor_user_id
  FROM gcims.companies c
  JOIN gcims.outlets o ON o.company_id=c.id AND o.code='MAIN' AND o.is_active
  JOIN gcims.stock_locations sl ON sl.company_id=o.company_id AND sl.outlet_id=o.id AND sl.code='MAIN' AND sl.is_active
 WHERE c.code='GOURMET-COFFEE' AND c.is_active;

CREATE TEMP TABLE _test_catalog_opening_expected ON COMMIT DROP AS
SELECT s.company_id, s.outlet_id, s.stock_location_id, s.actor_user_id,
       ii.id AS inventory_item_id, ii.sku,
       (SUM(ri.quantity_base) * 10)::NUMERIC(18,6) AS quantity_base
  FROM _test_catalog_scope s
  JOIN gcims.menus m ON m.company_id=s.company_id AND m.code ~ '^CAF-MNU-[0-9]{3}$' AND m.is_active
  JOIN gcims.menu_variants mv ON mv.company_id=m.company_id AND mv.menu_id=m.id AND mv.is_active
  JOIN gcims.recipes r ON r.company_id=mv.company_id AND r.menu_variant_id=mv.id
  JOIN gcims.recipe_versions rv ON rv.company_id=r.company_id AND rv.recipe_id=r.id
       AND rv.status='active' AND rv.effective_from<=now() AND (rv.effective_to IS NULL OR rv.effective_to>now())
  JOIN gcims.recipe_items ri ON ri.company_id=rv.company_id AND ri.recipe_version_id=rv.id
  JOIN gcims.inventory_items ii ON ii.company_id=ri.company_id AND ii.id=ri.inventory_item_id
 WHERE ii.reference_status IS NOT NULL AND ii.is_active AND NOT ii.track_lot
 GROUP BY s.company_id,s.outlet_id,s.stock_location_id,s.actor_user_id,ii.id,ii.sku;

DO $test_stock$
DECLARE
    v_company_id UUID;
    v_outlet_id UUID;
    v_location_id UUID;
    v_actor_user_id UUID;
    v_batch_id UUID := gen_random_uuid();
    v_expected_count INTEGER;
    v_existing_count INTEGER;
    v_valid_count INTEGER;
    v_other_ledger_count INTEGER;
    v_inserted_count INTEGER;
    v_active_menu_count INTEGER;
    v_bom_line_count INTEGER;
BEGIN
    IF current_database() <> 'db_gcims_test' THEN
        RAISE EXCEPTION 'Safety stop: simulated catalog stock is only allowed on db_gcims_test';
    END IF;

    IF (SELECT COUNT(*) FROM _test_catalog_scope) <> 1
       OR (SELECT actor_user_id FROM _test_catalog_scope) IS NULL THEN
        RAISE EXCEPTION 'Expected one active GOURMET-COFFEE / MAIN / MAIN scope with an active Admin';
    END IF;
    SELECT company_id,outlet_id,stock_location_id,actor_user_id
      INTO v_company_id,v_outlet_id,v_location_id,v_actor_user_id
      FROM _test_catalog_scope;

    SELECT COUNT(*) INTO v_active_menu_count
      FROM gcims.menus m JOIN gcims.menu_variants mv ON mv.company_id=m.company_id AND mv.menu_id=m.id AND mv.is_active
     WHERE m.company_id=v_company_id AND m.code ~ '^CAF-MNU-[0-9]{3}$' AND m.is_active;
    SELECT COUNT(*) INTO v_bom_line_count
      FROM gcims.recipe_items ri
      JOIN gcims.recipe_versions rv ON rv.company_id=ri.company_id AND rv.id=ri.recipe_version_id AND rv.status='active'
      JOIN gcims.recipes r ON r.company_id=rv.company_id AND r.id=rv.recipe_id
      JOIN gcims.menu_variants mv ON mv.company_id=r.company_id AND mv.id=r.menu_variant_id AND mv.is_active
      JOIN gcims.menus m ON m.company_id=mv.company_id AND m.id=mv.menu_id AND m.is_active
     WHERE ri.company_id=v_company_id AND m.code ~ '^CAF-MNU-[0-9]{3}$';
    SELECT COUNT(*) INTO v_expected_count FROM _test_catalog_opening_expected;
    IF v_active_menu_count <> 49 OR v_bom_line_count <> 401 OR v_expected_count <> 43 THEN
        RAISE EXCEPTION 'Catalog changed: expected 49 active menus, 401 BOM lines and 43 stock items; found %, %, %',
            v_active_menu_count,v_bom_line_count,v_expected_count;
    END IF;

    SELECT COUNT(*) INTO v_existing_count
      FROM gcims.stock_ledger
     WHERE company_id=v_company_id AND outlet_id=v_outlet_id AND stock_location_id=v_location_id
       AND idempotency_key LIKE 'gcims-test-reference-opening-v1:%';
    IF v_existing_count = v_expected_count THEN
        SELECT COUNT(*) INTO v_valid_count
          FROM _test_catalog_opening_expected e
          JOIN gcims.stock_ledger l ON l.company_id=e.company_id
             AND l.inventory_item_id=e.inventory_item_id
             AND l.idempotency_key='gcims-test-reference-opening-v1:'||e.sku
             AND l.outlet_id=e.outlet_id AND l.stock_location_id=e.stock_location_id
             AND l.movement_type='opening_balance' AND l.source_type='opening'
             AND l.quantity_delta_base=e.quantity_base AND l.lot_id IS NULL;
        IF v_valid_count <> v_expected_count THEN
            RAISE EXCEPTION 'Existing simulated opening balances do not match the current READY BOM; no changes made';
        END IF;
        RAISE NOTICE 'Matching READY test stock already exists; no duplicate movement posted.';
        RETURN;
    ELSIF v_existing_count > 0 THEN
        RAISE EXCEPTION 'Only % of % expected simulated opening movements exist; manual review required',
            v_existing_count,v_expected_count;
    END IF;

    SELECT COUNT(*) INTO v_other_ledger_count
      FROM gcims.stock_ledger l
      JOIN _test_catalog_opening_expected e ON e.company_id=l.company_id AND e.inventory_item_id=l.inventory_item_id
     WHERE l.outlet_id=v_outlet_id AND l.stock_location_id=v_location_id;
    IF v_other_ledger_count > 0 THEN
        RAISE EXCEPTION 'READY catalog items already have % stock movements; opening balance stopped to avoid double-counting',
            v_other_ledger_count;
    END IF;

    INSERT INTO gcims.stock_ledger
        (company_id,outlet_id,stock_location_id,inventory_item_id,lot_id,
         movement_type,quantity_delta_base,occurred_at,source_type,source_id,
         source_line_id,source_line_sequence,idempotency_key,reason,actor_user_id)
    SELECT e.company_id,e.outlet_id,e.stock_location_id,e.inventory_item_id,NULL,
           'opening_balance',e.quantity_base,now(),'opening',v_batch_id,
           e.inventory_item_id,1,'gcims-test-reference-opening-v1:'||e.sku,
           'Simulated test stock: enough for 10 servings of every active READY menu; not a physical count.',
           v_actor_user_id
      FROM _test_catalog_opening_expected e
     ORDER BY e.inventory_item_id
    ON CONFLICT(idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    IF v_inserted_count <> v_expected_count THEN
        RAISE EXCEPTION 'Expected % opening movements but inserted %; transaction rolled back',v_expected_count,v_inserted_count;
    END IF;

    INSERT INTO gcims.audit_logs
        (company_id,outlet_id,actor_user_id,actor_type,action,entity_type,entity_id,after_data,reason)
    SELECT v_company_id,v_outlet_id,v_actor_user_id,'user','inventory.opening_balance.posted',
           'stock_ledger_batch',v_batch_id,
           jsonb_build_object('source_type','opening','test_only',TRUE,'servings_per_each_menu',10,
                              'inventory_items',v_inserted_count,'quantity_basis','active READY BOM × 10'),
           'Test-only simulated stock for POS order trials; replace with verified quantities before real operation.';

    RAISE NOTICE 'Posted % simulated READY catalog opening movements for 10 servings per active menu.',v_inserted_count;
END
$test_stock$;

COMMIT;

SELECT ii.sku,ii.name,u.code AS base_uom,soh.on_hand_qty_base::NUMERIC(18,6) AS test_on_hand
  FROM gcims.inventory_items ii
  JOIN gcims.uoms u ON u.id=ii.base_uom_id
  JOIN gcims.v_stock_on_hand soh ON soh.company_id=ii.company_id AND soh.inventory_item_id=ii.id
  JOIN gcims.stock_locations sl ON sl.company_id=soh.company_id AND sl.outlet_id=soh.outlet_id AND sl.id=soh.stock_location_id
 WHERE ii.reference_status IS NOT NULL AND sl.code='MAIN' AND EXISTS (
    SELECT 1 FROM gcims.stock_ledger l WHERE l.company_id=ii.company_id
      AND l.inventory_item_id=ii.id AND l.idempotency_key LIKE 'gcims-test-reference-opening-v1:%'
 )
 ORDER BY ii.sku;

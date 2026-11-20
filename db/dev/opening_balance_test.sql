-- GCIMS v0.2.0 - simulated opening balances for db_gcims_test ONLY.
-- Uses append-only stock_ledger; does not update a stock balance table.
-- Re-running is safe only when the exact four opening entries already exist.

BEGIN;

DO $gcims$
DECLARE
    v_company_id UUID;
    v_outlet_id UUID;
    v_stock_location_id UUID;
    v_actor_user_id UUID;
    v_batch_id UUID := gen_random_uuid();
    v_catalog_count INTEGER;
    v_existing_opening_count INTEGER;
    v_valid_opening_count INTEGER;
    v_other_ledger_count INTEGER;
    v_inserted_count INTEGER;
BEGIN
    IF current_database() <> 'db_gcims_test' THEN
        RAISE EXCEPTION 'Safety stop: this script is only allowed on db_gcims_test. Current database: %', current_database();
    END IF;

    SELECT id INTO v_company_id
      FROM gcims.companies
     WHERE code = 'GOURMET-COFFEE' AND is_active = TRUE;
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Active company GOURMET-COFFEE was not found.';
    END IF;

    SELECT id INTO v_outlet_id
      FROM gcims.outlets
     WHERE company_id = v_company_id AND code = 'MAIN' AND is_active = TRUE;
    IF v_outlet_id IS NULL THEN
        RAISE EXCEPTION 'Active outlet MAIN was not found.';
    END IF;

    SELECT id INTO v_stock_location_id
      FROM gcims.stock_locations
     WHERE company_id = v_company_id
       AND outlet_id = v_outlet_id
       AND code = 'MAIN'
       AND is_active = TRUE;
    IF v_stock_location_id IS NULL THEN
        RAISE EXCEPTION 'Active stock location MAIN was not found.';
    END IF;

    SELECT u.id INTO v_actor_user_id
      FROM gcims.users u
      JOIN gcims.company_memberships cm
        ON cm.user_id = u.id
       AND cm.membership_status = 'active'
      JOIN gcims.user_role_assignments ura
        ON ura.company_id = cm.company_id
       AND ura.user_id = cm.user_id
      JOIN gcims.roles r
        ON r.company_id = ura.company_id
       AND r.id = ura.role_id
       AND r.code = 'ADMIN'
     WHERE cm.company_id = v_company_id
       AND u.is_active = TRUE
     ORDER BY u.created_at, u.id
     LIMIT 1;
    IF v_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'An active ADMIN user was not found for GOURMET-COFFEE.';
    END IF;

    -- Validate all four SKU and their base UOM before writing anything.
    SELECT COUNT(*) INTO v_catalog_count
      FROM (VALUES
          ('MILK-001', 'ml'),
          ('ESPRESSO-001', 'g'),
          ('CUP-001', 'pcs'),
          ('SYRUP-001', 'ml')
      ) AS expected(sku, uom_code)
      JOIN gcims.inventory_items i
        ON i.company_id = v_company_id
       AND i.sku = expected.sku
       AND i.is_active = TRUE
      JOIN gcims.uoms u
        ON u.id = i.base_uom_id
       AND u.code = expected.uom_code;

    IF v_catalog_count <> 4 THEN
        RAISE EXCEPTION 'Expected four active inventory items with base UOM ml/g/pcs; found %.', v_catalog_count;
    END IF;

    -- Required lock protocol: lock inventory items in ascending UUID order.
    PERFORM i.id
      FROM gcims.inventory_items i
     WHERE i.company_id = v_company_id
       AND i.sku IN ('MILK-001', 'ESPRESSO-001', 'CUP-001', 'SYRUP-001')
     ORDER BY i.id
     FOR UPDATE;

    -- Idempotent replay: accept only the exact same four opening entries.
    SELECT COUNT(*) INTO v_existing_opening_count
      FROM gcims.stock_ledger
     WHERE company_id = v_company_id
       AND idempotency_key IN (
           'gcims-test-opening-v1:MILK-001',
           'gcims-test-opening-v1:ESPRESSO-001',
           'gcims-test-opening-v1:CUP-001',
           'gcims-test-opening-v1:SYRUP-001'
       );

    IF v_existing_opening_count = 4 THEN
        SELECT COUNT(*) INTO v_valid_opening_count
          FROM (VALUES
              ('MILK-001', 5000::NUMERIC, 'gcims-test-opening-v1:MILK-001'),
              ('ESPRESSO-001', 1000::NUMERIC, 'gcims-test-opening-v1:ESPRESSO-001'),
              ('CUP-001', 100::NUMERIC, 'gcims-test-opening-v1:CUP-001'),
              ('SYRUP-001', 1000::NUMERIC, 'gcims-test-opening-v1:SYRUP-001')
          ) AS expected(sku, qty, idem_key)
          JOIN gcims.inventory_items i
            ON i.company_id = v_company_id AND i.sku = expected.sku
          JOIN gcims.stock_ledger l
            ON l.company_id = v_company_id
           AND l.inventory_item_id = i.id
           AND l.idempotency_key = expected.idem_key
           AND l.outlet_id = v_outlet_id
           AND l.stock_location_id = v_stock_location_id
           AND l.movement_type = 'opening_balance'
           AND l.source_type = 'opening'
           AND l.quantity_delta_base = expected.qty;

        IF v_valid_opening_count <> 4 THEN
            RAISE EXCEPTION 'Opening idempotency keys exist, but their contents do not match the expected test balances. No changes made.';
        END IF;

        RAISE NOTICE 'Opening balances already exist and match exactly; no duplicate movements were posted.';
        RETURN;
    ELSIF v_existing_opening_count > 0 THEN
        RAISE EXCEPTION 'Only % of the four expected opening entries exist. Manual review required; no changes made.', v_existing_opening_count;
    END IF;

    -- Do not establish an opening balance on top of any previous movement.
    SELECT COUNT(*) INTO v_other_ledger_count
      FROM gcims.stock_ledger l
      JOIN gcims.inventory_items i
        ON i.company_id = l.company_id
       AND i.id = l.inventory_item_id
     WHERE l.company_id = v_company_id
       AND l.outlet_id = v_outlet_id
       AND l.stock_location_id = v_stock_location_id
       AND i.sku IN ('MILK-001', 'ESPRESSO-001', 'CUP-001', 'SYRUP-001');

    IF v_other_ledger_count > 0 THEN
        RAISE EXCEPTION 'These items already have % ledger movements. Opening balance was not posted to avoid double-counting.', v_other_ledger_count;
    END IF;

    INSERT INTO gcims.stock_ledger
        (company_id, outlet_id, stock_location_id, inventory_item_id, lot_id,
         movement_type, quantity_delta_base, occurred_at, source_type, source_id,
         source_line_id, source_line_sequence, idempotency_key, reason, actor_user_id)
    SELECT v_company_id,
           v_outlet_id,
           v_stock_location_id,
           i.id,
           NULL,
           'opening_balance',
           expected.qty,
           now(),
           'opening',
           v_batch_id,
           NULL,
           1,
           expected.idem_key,
           'Simulated opening balance for GCIMS test database; not real physical stock.',
           v_actor_user_id
      FROM (VALUES
          ('MILK-001', 5000::NUMERIC, 'gcims-test-opening-v1:MILK-001'),
          ('ESPRESSO-001', 1000::NUMERIC, 'gcims-test-opening-v1:ESPRESSO-001'),
          ('CUP-001', 100::NUMERIC, 'gcims-test-opening-v1:CUP-001'),
          ('SYRUP-001', 1000::NUMERIC, 'gcims-test-opening-v1:SYRUP-001')
      ) AS expected(sku, qty, idem_key)
      JOIN gcims.inventory_items i
        ON i.company_id = v_company_id
       AND i.sku = expected.sku
       AND i.is_active = TRUE
     ORDER BY i.id
    ON CONFLICT (idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    IF v_inserted_count <> 4 THEN
        RAISE EXCEPTION 'Expected to insert four opening movements, but inserted %. Transaction will roll back.', v_inserted_count;
    END IF;

    INSERT INTO gcims.audit_logs
        (company_id, outlet_id, actor_user_id, actor_type, action,
         entity_type, entity_id, after_data, reason)
    VALUES
        (v_company_id, v_outlet_id, v_actor_user_id, 'user', 'inventory.opening_balance.posted',
         'stock_ledger_batch', v_batch_id,
         jsonb_build_object(
             'source_type', 'opening',
             'movement_type', 'opening_balance',
             'simulated', TRUE,
             'ledger_entries', v_inserted_count,
             'quantities', jsonb_build_object(
                 'MILK-001', jsonb_build_object('quantity', 5000, 'uom', 'ml'),
                 'ESPRESSO-001', jsonb_build_object('quantity', 1000, 'uom', 'g'),
                 'CUP-001', jsonb_build_object('quantity', 100, 'uom', 'pcs'),
                 'SYRUP-001', jsonb_build_object('quantity', 1000, 'uom', 'ml')
             )
         ),
         'Opening balances for test transactions only; replace with verified physical counts before any real operation.');

    RAISE NOTICE 'Posted % simulated opening balance movements. Batch ID: %', v_inserted_count, v_batch_id;
END
$gcims$;

COMMIT;

-- Verify on-hand balances derived from the append-only ledger.
SELECT i.sku,
       i.name AS inventory_item,
       u.code AS base_uom,
       COALESCE(soh.on_hand_qty_base, 0)::NUMERIC(18,6) AS on_hand_qty_base
  FROM gcims.companies c
  JOIN gcims.inventory_items i ON i.company_id = c.id
  JOIN gcims.uoms u ON u.id = i.base_uom_id
  LEFT JOIN gcims.v_stock_on_hand soh
    ON soh.company_id = i.company_id
   AND soh.inventory_item_id = i.id
   AND soh.outlet_id = (SELECT o.id FROM gcims.outlets o WHERE o.company_id = c.id AND o.code = 'MAIN')
   AND soh.stock_location_id = (SELECT sl.id FROM gcims.stock_locations sl WHERE sl.company_id = c.id AND sl.code = 'MAIN')
   AND soh.lot_id IS NULL
 WHERE c.code = 'GOURMET-COFFEE'
   AND i.sku IN ('MILK-001', 'ESPRESSO-001', 'CUP-001', 'SYRUP-001')
 ORDER BY i.sku;

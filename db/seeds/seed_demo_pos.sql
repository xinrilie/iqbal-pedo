-- Demo catalog GCIMS untuk menguji GET catalog dan create draft order di db_gcims_test.
-- Prasyarat: scripts/bootstrap-admin.js sudah membuat company GOURMET-COFFEE dan outlet MAIN.
-- Idempotent: aman dijalankan ulang; tidak mengubah versi BOM yang sudah aktif.
-- Tidak membuat saldo stok dan tidak mengaktifkan pembayaran.

BEGIN;
SET search_path = gcims, public;

DO $$
DECLARE
  v_company UUID;
  v_outlet UUID;
  v_menu_category UUID;
  v_inventory_category UUID;
  v_ml UUID;
  v_g UUID;
  v_pcs UUID;
  v_milk UUID;
  v_espresso UUID;
  v_cup UUID;
  v_syrup UUID;
  v_menu UUID;
  v_variant UUID;
  v_recipe UUID;
  v_recipe_version UUID;
BEGIN
  SELECT id INTO v_company FROM gcims.companies WHERE code = 'GOURMET-COFFEE';
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Company GOURMET-COFFEE tidak ditemukan. Jalankan bootstrap-admin terlebih dahulu.';
  END IF;
  SELECT id INTO v_outlet FROM gcims.outlets WHERE company_id = v_company AND code = 'MAIN';
  IF v_outlet IS NULL THEN
    RAISE EXCEPTION 'Outlet MAIN tidak ditemukan. Jalankan bootstrap-admin terlebih dahulu.';
  END IF;

  SELECT id INTO v_ml FROM gcims.uoms WHERE code = 'ml';
  SELECT id INTO v_g FROM gcims.uoms WHERE code = 'g';
  SELECT id INTO v_pcs FROM gcims.uoms WHERE code = 'pcs';
  IF v_ml IS NULL OR v_g IS NULL OR v_pcs IS NULL THEN
    RAISE EXCEPTION 'UOM dasar ml, g, pcs tidak tersedia; pastikan DDL Sesi 1 selesai.';
  END IF;

  INSERT INTO gcims.menu_categories (company_id, code, name)
  VALUES (v_company, 'COFFEE', 'Coffee')
  ON CONFLICT (company_id, code) DO NOTHING;
  SELECT id INTO v_menu_category FROM gcims.menu_categories
   WHERE company_id = v_company AND code = 'COFFEE';

  INSERT INTO gcims.inventory_categories (company_id, code, name)
  VALUES (v_company, 'RAW-MATERIAL', 'Bahan Baku')
  ON CONFLICT (company_id, code) DO NOTHING;
  SELECT id INTO v_inventory_category FROM gcims.inventory_categories
   WHERE company_id = v_company AND code = 'RAW-MATERIAL';

  INSERT INTO gcims.inventory_items (company_id, category_id, sku, name, base_uom_id, track_lot, track_expiry)
  VALUES
    (v_company, v_inventory_category, 'MILK-001', 'Fresh Milk', v_ml, FALSE, FALSE),
    (v_company, v_inventory_category, 'ESPRESSO-001', 'Espresso', v_g, FALSE, FALSE),
    (v_company, v_inventory_category, 'CUP-001', 'Cup', v_pcs, FALSE, FALSE),
    (v_company, v_inventory_category, 'SYRUP-001', 'Caramel Syrup', v_ml, FALSE, FALSE)
  ON CONFLICT (company_id, sku) DO NOTHING;

  SELECT id INTO v_milk FROM gcims.inventory_items WHERE company_id = v_company AND sku = 'MILK-001';
  SELECT id INTO v_espresso FROM gcims.inventory_items WHERE company_id = v_company AND sku = 'ESPRESSO-001';
  SELECT id INTO v_cup FROM gcims.inventory_items WHERE company_id = v_company AND sku = 'CUP-001';
  SELECT id INTO v_syrup FROM gcims.inventory_items WHERE company_id = v_company AND sku = 'SYRUP-001';

  INSERT INTO gcims.menus (company_id, category_id, code, name, description, is_active)
  VALUES (v_company, v_menu_category, 'CARAMEL-MACCHIATO', 'Caramel Macchiato', 'Demo item untuk uji API GCIMS.', TRUE)
  ON CONFLICT (company_id, code) DO NOTHING;
  SELECT id INTO v_menu FROM gcims.menus WHERE company_id = v_company AND code = 'CARAMEL-MACCHIATO';

  INSERT INTO gcims.menu_variants (company_id, menu_id, code, name, price_amount, is_default, is_active)
  VALUES (v_company, v_menu, 'REGULAR', 'Regular', 38000, TRUE, TRUE)
  ON CONFLICT (menu_id, code) DO NOTHING;
  SELECT id INTO v_variant FROM gcims.menu_variants WHERE menu_id = v_menu AND code = 'REGULAR';

  INSERT INTO gcims.recipes (company_id, menu_variant_id, name)
  VALUES (v_company, v_variant, 'Caramel Macchiato Regular')
  ON CONFLICT (menu_variant_id) DO NOTHING;
  SELECT id INTO v_recipe FROM gcims.recipes WHERE menu_variant_id = v_variant;

  INSERT INTO gcims.recipe_versions (company_id, recipe_id, version_no, status, effective_from, notes)
  VALUES (v_company, v_recipe, 1, 'draft', now(), 'Demo BOM baseline; satu porsi.')
  ON CONFLICT (recipe_id, version_no) DO NOTHING;
  SELECT id INTO v_recipe_version FROM gcims.recipe_versions
   WHERE recipe_id = v_recipe AND version_no = 1;

  IF EXISTS (SELECT 1 FROM gcims.recipe_versions WHERE id = v_recipe_version AND status = 'draft') THEN
    INSERT INTO gcims.recipe_items
      (company_id, recipe_version_id, line_no, inventory_item_id, quantity_base, preparation_note)
    VALUES
      (v_company, v_recipe_version, 1, v_milk, 150, 'Satu porsi: 150 ml'),
      (v_company, v_recipe_version, 2, v_espresso, 18, 'Satu porsi: 18 g'),
      (v_company, v_recipe_version, 3, v_cup, 1, 'Satu porsi: 1 pcs'),
      (v_company, v_recipe_version, 4, v_syrup, 10, 'Satu porsi: 10 ml')
    ON CONFLICT (recipe_version_id, line_no) DO NOTHING;
    UPDATE gcims.recipe_versions SET status = 'active'
     WHERE id = v_recipe_version AND status = 'draft';
  END IF;
END $$;

COMMIT;

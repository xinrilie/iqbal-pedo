"""Build the static test catalog seed from the two GCIMS reference workbooks.

Requires openpyxl. The workbooks stay outside the repository; the generated SQL
is reviewed and committed under db/seeds/.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from pathlib import Path
import argparse
import random
import re
import unicodedata

import openpyxl


UNIT_DEFS = {
    "gr": ("Gram", "mass", 6), "g": ("Gram", "mass", 6), "kg": ("Kilogram", "mass", 6),
    "ml": ("Mililiter", "volume", 6), "l": ("Liter", "volume", 6),
    "pcs": ("Pieces", "count", 6), "pc": ("Piece", "count", 6),
    "UNT": ("Unit stok", "count", 6), "PK": ("Paket", "count", 6),
    "EA": ("Each", "count", 6), "STRIP": ("Strip", "count", 6),
    "PCS": ("Pieces", "count", 6), "SACHET": ("Sachet", "count", 6),
    "BUNCH": ("Bunch", "count", 6), "BTL": ("Botol", "count", 6),
    "BOX": ("Kotak", "count", 6), "BAG": ("Kantong", "count", 6),
    "CAN": ("Kaleng", "count", 6), "ROLL": ("Gulungan", "count", 6),
    "SLICE": ("Iris", "count", 6), "LEAF": ("Lembar", "count", 6),
    "SACH": ("Sachet", "count", 6), "slice": ("Slice", "count", 6),
    "leaf": ("Leaf", "count", 6),
    "SERVING": ("Porsi", "count", 6),
}


def clean(value):
    if value is None:
        return None
    value = str(value).strip()
    return None if not value or value.casefold() in {"-", "n/a"} else value


def sql(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def number(value):
    return "NULL" if value is None else str(Decimal(str(value)))


def boolean(value):
    return "TRUE" if value else "FALSE"


def slug(value):
    ascii_value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", "_", ascii_value).strip("_")[:40] or "OTHER"


def category_codes(values):
    result = {}
    for value in sorted(set(values), key=lambda x: (slug(x), str(x).casefold(), str(x))):
        code = slug(value)
        if code in result and result[code].casefold() != value.casefold():
            raise ValueError(f"Category slug collision: {result[code]} / {value}")
        result.setdefault(code, value)
    return result


def normalize_unit(value):
    value = clean(value)
    if value in UNIT_DEFS:
        return value
    matches = [code for code in UNIT_DEFS if code.casefold() == value.casefold()]
    if len(matches) == 1:
        return matches[0]
    raise ValueError(f"Unknown or ambiguous UOM code: {value}")


def rows_with_headers(sheet):
    rows = [tuple(row) for row in sheet.iter_rows(values_only=True) if any(x is not None for x in row)]
    headers = rows[0]
    return [
        {str(key): row[i] if i < len(row) else None for i, key in enumerate(headers) if key is not None}
        for row in rows[1:]
    ]


def values_sql(values):
    return ",\n".join("(" + ",".join(map(str, row)) + ")" for row in values)


def build(ready_path: Path, operational_path: Path, output_path: Path):
    ready = openpyxl.load_workbook(ready_path, data_only=True, read_only=True)
    master = rows_with_headers(ready["02 MASTER ITEM"])
    menu_master = rows_with_headers(ready["03 MENU MASTER"])
    bom = rows_with_headers(ready["04 BOM DETAIL"])
    inventory = [r for r in master if str(r.get("TYPE", "")).upper() != "MENU" and clean(r.get("STOCK UOM"))]
    by_sku = {r["SKU"]: r for r in inventory if clean(r.get("SKU"))}
    menus_by_sku = {r["SKU"]: r for r in master if str(r.get("TYPE", "")).upper() == "MENU"}
    recipes_by_sku = {r["MENU SKU"]: r for r in menu_master}
    if len(by_sku) != len(inventory) or set(menus_by_sku) != set(recipes_by_sku):
        raise ValueError("Duplicate or unmatched source SKU")

    bom_rows, prep_count, prep_notes = [], defaultdict(int), defaultdict(list)
    for row in bom:
        sku, status = clean(row.get("COMPONENT SKU")), clean(row.get("MAPPING STATUS"))
        if sku and status in {"OK", "OK - SAME UOM"}:
            quantity = Decimal(str(row.get("STOCK QTY / SALE") or 0))
            if quantity <= 0 or sku not in by_sku:
                raise ValueError(f"Invalid BOM mapping: {row.get('MENU SKU')} {sku}")
            bom_rows.append((row, sku, quantity))
        elif not sku and str(row.get("MAPPING STATUS", "")).startswith("REVIEW"):
            prep_count[row["MENU SKU"]] += 1
            prep_notes[row["MENU SKU"]].append(
                f"{clean(row.get('COMPONENT NAME')) or 'Preparation'}: "
                f"{row.get('RECIPE QTY / SALE')} {clean(row.get('RECIPE UOM')) or ''}; "
                f"{clean(row.get('NOTE')) or 'no inventory SKU'}"
            )
    if len(bom_rows) != 401 or len(prep_count) != 2 or sum(prep_count.values()) != 2:
        raise ValueError("Source BOM coverage changed; review before generating the seed")
    if len({(r["MENU SKU"], int(float(r["LINE"]))) for r, _, _ in bom_rows}) != len(bom_rows):
        raise ValueError("Duplicate recipe line number")

    inventory_categories = [clean(r.get("CATEGORY")) or "Lainnya" for r in inventory]
    inventory_category_names = category_codes(inventory_categories)
    menu_categories = [clean(r.get("CATEGORY")) or "Lainnya" for r in menus_by_sku.values()]
    menu_category_names = category_codes(menu_categories)
    inventory_category_code = {name: slug(name) for name in inventory_categories}
    menu_category_code = {name: slug(name) for name in menu_categories}

    operational = openpyxl.load_workbook(operational_path, data_only=True, read_only=True)
    conversion_rows = [tuple(r) for r in operational["16. UOM CONVERSION"].iter_rows(values_only=True)
                       if any(x is not None for x in r)]
    conversions = []
    for row in conversion_rows[1:]:
        if len(row) < 7 or clean(row[6]) != "OK":
            continue
        _, sku, from_uom, to_uom, factor, note, *_ = row
        sku, note = clean(sku), clean(note)
        from_uom, to_uom = normalize_unit(from_uom), normalize_unit(to_uom)
        if sku not in by_sku or normalize_unit(by_sku[sku].get("STOCK UOM")) != to_uom:
            raise ValueError(f"Conversion target does not match master item: {sku}")
        if from_uom not in UNIT_DEFS or to_uom not in UNIT_DEFS or from_uom == to_uom or not note or Decimal(str(factor)) <= 0:
            raise ValueError(f"Invalid conversion row: {sku} {from_uom}->{to_uom}")
        conversions.append((sku, from_uom, to_uom, Decimal(str(factor)), note))
    if len(conversions) != 46 or len({(r[0], r[1]) for r in conversions}) != 46:
        raise ValueError("Expected 46 unique approved UOM conversions")

    suppliers = []
    for row in list(operational["03. Supplier"].iter_rows(values_only=True))[1:]:
        row = list(row)
        if len(row) < 2 or not clean(row[0]) or not str(row[0]).startswith("SUP-"):
            continue
        # Keep vendor contact and commercial terms out of the tracked seed.
        suppliers.append((clean(row[0]), clean(row[1])))
    if len(suppliers) != 8:
        raise ValueError(f"Expected 8 suppliers, found {len(suppliers)}")

    rng, menu_values = random.Random(20261116), []
    for sku, item in menus_by_sku.items():
        source = recipes_by_sku[sku]
        category = clean(item.get("CATEGORY")) or "Lainnya"
        status = str(source.get("BOM STATUS", ""))
        price = (rng.randint(12, 30) if any(t in category.lower() for t in ("pastry", "bread", "roti"))
                 else rng.randint(18, 45)) * 1000
        menu_values.append((sku, clean(item.get("ITEM NAME")), clean(item.get("CANONICAL NAME | POS")),
                            menu_category_code[category], category, price, status.startswith("READY"), status,
                            prep_count.get(sku, 0), " | ".join(prep_notes.get(sku, []))))

    units = sorted({clean(r.get("STOCK UOM")) for r in inventory} |
                   {uom for row in conversions for uom in (row[1], row[2])})
    inventory_category_values = [(code, name) for code, name in inventory_category_names.items()]
    menu_category_values = [(code, name, i) for i, (code, name) in enumerate(menu_category_names.items(), 1)]
    parts = [
        "-- Catalog import generated from GCIMS READY_TO_USE + Operational Master references.",
        "-- Imports 220 inventory masters, 55 menus with flagged pseudorandom test prices, 401 converted BOM lines, 46 UOM rules, and 8 suppliers.",
        "-- 2 preparation-only BOM rows lack a SKU; notes are retained on recipe versions. No opening stock or purchase/receipt transactions are imported.",
        "-- Existing test menus without sales references are removed. Menus with sales remain archived so transaction history is intact.",
        "BEGIN;", "SET LOCAL search_path = gcims, public;",
        "DO $$ BEGIN IF current_database()<>'db_gcims_test' THEN RAISE EXCEPTION 'Catalog import is restricted to db_gcims_test'; END IF; IF (SELECT count(*) FROM gcims.companies)<>1 OR (SELECT count(*) FROM gcims.outlets)<>1 THEN RAISE EXCEPTION 'Expected exactly one demo company and outlet'; END IF; END $$;",
        "CREATE TEMP TABLE _ref_scope ON COMMIT DROP AS SELECT c.id company_id,o.id outlet_id,(SELECT ura.user_id FROM gcims.user_role_assignments ura JOIN gcims.roles r ON r.id=ura.role_id AND r.company_id=ura.company_id WHERE ura.company_id=c.id AND r.code='ADMIN' ORDER BY ura.user_id LIMIT 1) admin_user_id FROM gcims.companies c JOIN gcims.outlets o ON o.company_id=c.id;",
        "DO $$ BEGIN IF (SELECT count(*) FROM _ref_scope)<>1 OR (SELECT admin_user_id FROM _ref_scope) IS NULL THEN RAISE EXCEPTION 'Demo scope or admin account is missing'; END IF; END $$;",
        "CREATE TEMP TABLE _ref_uoms(code text PRIMARY KEY,name text NOT NULL,dimension text NOT NULL,decimal_scale smallint NOT NULL) ON COMMIT DROP;",
        "INSERT INTO _ref_uoms VALUES\n" + values_sql((sql(code), sql(UNIT_DEFS[code][0]), sql(UNIT_DEFS[code][1]), UNIT_DEFS[code][2]) for code in units) + ";",
        "INSERT INTO gcims.uoms(code,name,dimension,decimal_scale,is_active) SELECT code,name,dimension,decimal_scale,TRUE FROM _ref_uoms ON CONFLICT(code) DO NOTHING;",
        "DO $$ BEGIN IF EXISTS(SELECT 1 FROM _ref_uoms x JOIN gcims.uoms u USING(code) WHERE u.dimension<>x.dimension) THEN RAISE EXCEPTION 'Source UOM dimension conflicts with the database'; END IF; END $$;",
        "CREATE TEMP TABLE _ref_categories(code text PRIMARY KEY,name text NOT NULL) ON COMMIT DROP;",
        "INSERT INTO _ref_categories VALUES\n" + values_sql((sql(c), sql(name)) for c, name in inventory_category_values) + ";",
        "INSERT INTO gcims.inventory_categories(company_id,code,name,is_active) SELECT s.company_id,c.code,c.name,TRUE FROM _ref_scope s CROSS JOIN _ref_categories c ON CONFLICT(company_id,code) DO UPDATE SET name=EXCLUDED.name,is_active=TRUE;",
        "CREATE TEMP TABLE _ref_inventory(sku text PRIMARY KEY,item_name text NOT NULL,brand text,division text,item_type text,category_code text NOT NULL,subcategory text,specification text,stock_uom text NOT NULL,source_status text NOT NULL,canonical_name text) ON COMMIT DROP;",
        "INSERT INTO _ref_inventory VALUES\n" + values_sql((sql(r["SKU"]), sql(r["ITEM NAME"]), sql(clean(r.get("BRAND"))), sql(clean(r.get("DIVISION"))), sql(clean(r.get("TYPE"))), sql(inventory_category_code[clean(r.get("CATEGORY")) or "Lainnya"]), sql(clean(r.get("SUBCATEGORY"))), sql(clean(r.get("SPECIFICATION"))), sql(clean(r.get("STOCK UOM"))), sql(str(r.get("STATUS", "NO")).strip().upper()), sql(clean(r.get("CANONICAL NAME | POS")))) for r in inventory) + ";",
        "CREATE TEMP TABLE _ref_bom(sku text NOT NULL,menu_code text NOT NULL,line_no smallint NOT NULL,quantity_base numeric(18,6) NOT NULL,preparation_note text) ON COMMIT DROP;",
        "INSERT INTO _ref_bom VALUES\n" + values_sql((sql(sku), sql(r["MENU SKU"]), int(float(r["LINE"])), number(qty), sql(clean(r.get("NOTE")))) for r, sku, qty in bom_rows) + ";",
        "CREATE TEMP TABLE _ref_menus(code text PRIMARY KEY,name text NOT NULL,canonical_name text,category_code text NOT NULL,category_name text NOT NULL,test_price bigint NOT NULL,can_sell boolean NOT NULL,bom_status text NOT NULL,prep_line_count smallint NOT NULL,prep_notes text NOT NULL) ON COMMIT DROP;",
        "INSERT INTO _ref_menus VALUES\n" + values_sql((sql(code), sql(name), sql(canonical), sql(cat_code), sql(cat_name), price, boolean(active), sql(status), prep, sql(prep_note)) for code, name, canonical, cat_code, cat_name, price, active, status, prep, prep_note in menu_values) + ";",
        "CREATE TEMP TABLE _ref_menu_categories(code text PRIMARY KEY,name text NOT NULL,sort_order integer NOT NULL) ON COMMIT DROP;",
        "INSERT INTO _ref_menu_categories VALUES\n" + values_sql((sql(code), sql(name), order) for code, name, order in menu_category_values) + ";",
        "INSERT INTO gcims.menu_categories(company_id,code,name,sort_order,is_active) SELECT s.company_id,c.code,c.name,c.sort_order,TRUE FROM _ref_scope s CROSS JOIN _ref_menu_categories c ON CONFLICT(company_id,code) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,is_active=TRUE;",
        "CREATE TEMP TABLE _ref_conversions(sku text NOT NULL,from_uom text NOT NULL,to_uom text NOT NULL,factor numeric(18,8) NOT NULL,note text NOT NULL,PRIMARY KEY(sku,from_uom)) ON COMMIT DROP;",
        "INSERT INTO _ref_conversions VALUES\n" + values_sql((sql(sku), sql(frm), sql(to), number(factor), sql(note)) for sku, frm, to, factor, note in conversions) + ";",
        "CREATE TEMP TABLE _ref_suppliers(code text PRIMARY KEY,name text NOT NULL) ON COMMIT DROP;",
        "INSERT INTO _ref_suppliers VALUES\n" + values_sql((sql(code), sql(name)) for code, name in suppliers) + ";",
        "DO $$ BEGIN IF (SELECT count(*) FROM _ref_inventory)<>220 OR (SELECT count(*) FROM _ref_menus)<>55 OR (SELECT count(*) FROM _ref_bom)<>401 OR (SELECT count(*) FROM _ref_conversions)<>46 OR (SELECT count(*) FROM _ref_suppliers)<>8 THEN RAISE EXCEPTION 'Reference counts changed; stop and inspect source'; END IF; IF EXISTS(SELECT 1 FROM _ref_bom b LEFT JOIN _ref_inventory i USING(sku) WHERE i.sku IS NULL) THEN RAISE EXCEPTION 'BOM references missing inventory'; END IF; END $$;",
        "INSERT INTO gcims.inventory_items(company_id,category_id,sku,name,base_uom_id,brand,division,item_type,subcategory,specification,canonical_name,reference_status,is_active) SELECT s.company_id,ic.id,i.sku,i.item_name,u.id,i.brand,i.division,i.item_type,i.subcategory,i.specification,i.canonical_name,i.source_status,(i.source_status='YES' OR EXISTS(SELECT 1 FROM _ref_bom b WHERE b.sku=i.sku)) FROM _ref_scope s CROSS JOIN _ref_inventory i JOIN gcims.inventory_categories ic ON ic.company_id=s.company_id AND ic.code=i.category_code JOIN gcims.uoms u ON u.code=i.stock_uom ON CONFLICT(company_id,sku) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,brand=EXCLUDED.brand,division=EXCLUDED.division,item_type=EXCLUDED.item_type,subcategory=EXCLUDED.subcategory,specification=EXCLUDED.specification,canonical_name=EXCLUDED.canonical_name,reference_status=EXCLUDED.reference_status,base_uom_id=EXCLUDED.base_uom_id,updated_at=now();",
        "INSERT INTO gcims.suppliers(company_id,code,name,is_active) SELECT s.company_id,x.code,x.name,TRUE FROM _ref_scope s CROSS JOIN _ref_suppliers x ON CONFLICT(company_id,code) DO UPDATE SET name=EXCLUDED.name,is_active=TRUE,updated_at=now();",
        "INSERT INTO gcims.item_uom_conversions(company_id,inventory_item_id,from_uom_id,factor_to_base,valid_from,created_by,conversion_basis,conversion_note) SELECT s.company_id,ii.id,fu.id,c.factor,CURRENT_DATE,s.admin_user_id,CASE WHEN fu.dimension<>bu.dimension THEN 'package_content' ELSE 'same_dimension' END,c.note FROM _ref_scope s CROSS JOIN _ref_conversions c JOIN gcims.inventory_items ii ON ii.company_id=s.company_id AND ii.sku=c.sku JOIN gcims.uoms fu ON fu.code=c.from_uom JOIN gcims.uoms bu ON bu.id=ii.base_uom_id ON CONFLICT(company_id,inventory_item_id,from_uom_id,valid_from) DO UPDATE SET factor_to_base=EXCLUDED.factor_to_base,conversion_basis=EXCLUDED.conversion_basis,conversion_note=EXCLUDED.conversion_note;",
        "CREATE TEMP TABLE _ref_old_variants ON COMMIT DROP AS SELECT mv.id variant_id,m.company_id FROM gcims.menus m JOIN gcims.menu_variants mv ON mv.company_id=m.company_id AND mv.menu_id=m.id CROSS JOIN _ref_scope s WHERE m.company_id=s.company_id AND NOT EXISTS(SELECT 1 FROM _ref_menus src WHERE src.code=m.code);",
        "UPDATE gcims.outlet_menu_variants omv SET is_available=FALSE,updated_at=now() FROM _ref_old_variants v WHERE omv.company_id=v.company_id AND omv.menu_variant_id=v.variant_id;",
        "UPDATE gcims.menu_variants mv SET is_active=FALSE,updated_at=now() FROM _ref_old_variants v WHERE mv.company_id=v.company_id AND mv.id=v.variant_id;",
        "UPDATE gcims.menus m SET is_active=FALSE,updated_at=now() FROM _ref_scope s WHERE m.company_id=s.company_id AND NOT EXISTS(SELECT 1 FROM _ref_menus src WHERE src.code=m.code);",
        "UPDATE gcims.recipe_versions rv SET status='retired' FROM gcims.recipes r,_ref_old_variants old WHERE rv.company_id=r.company_id AND rv.recipe_id=r.id AND r.menu_variant_id=old.variant_id AND rv.status='active';",
        "CREATE TEMP TABLE _ref_remove_variants ON COMMIT DROP AS SELECT v.variant_id FROM _ref_old_variants v WHERE NOT EXISTS(SELECT 1 FROM gcims.sales_order_items soi WHERE soi.company_id=v.company_id AND soi.menu_variant_id=v.variant_id) AND NOT EXISTS(SELECT 1 FROM gcims.sales_order_items soi JOIN gcims.recipe_versions rv ON rv.company_id=soi.company_id AND rv.id=soi.recipe_version_id JOIN gcims.recipes r ON r.company_id=rv.company_id AND r.id=rv.recipe_id WHERE soi.company_id=v.company_id AND r.menu_variant_id=v.variant_id);",
        "CREATE TEMP TABLE _ref_remove_recipes ON COMMIT DROP AS SELECT r.id FROM gcims.recipes r WHERE r.menu_variant_id IN(SELECT variant_id FROM _ref_remove_variants);",
        "DELETE FROM gcims.recipe_items ri USING gcims.recipe_versions rv,_ref_remove_recipes r WHERE ri.company_id=rv.company_id AND ri.recipe_version_id=rv.id AND rv.recipe_id=r.id;",
        "DELETE FROM gcims.recipe_versions rv USING _ref_remove_recipes r WHERE rv.recipe_id=r.id;",
        "DELETE FROM gcims.recipes r USING _ref_remove_recipes d WHERE r.id=d.id;",
        "DELETE FROM gcims.outlet_menu_variants omv USING _ref_remove_variants v WHERE omv.menu_variant_id=v.variant_id;",
        "DELETE FROM gcims.menu_variants mv USING _ref_remove_variants v WHERE mv.id=v.variant_id;",
        "DELETE FROM gcims.menus m USING _ref_scope s WHERE m.company_id=s.company_id AND NOT EXISTS(SELECT 1 FROM _ref_menus src WHERE src.code=m.code) AND NOT EXISTS(SELECT 1 FROM gcims.menu_variants mv WHERE mv.company_id=m.company_id AND mv.menu_id=m.id);",
        "WITH archived AS (UPDATE gcims.inventory_items ii SET is_active=FALSE,updated_at=now() FROM _ref_scope s WHERE ii.company_id=s.company_id AND ii.is_active AND (ii.sku LIKE 'CAF-RAW-%' OR ii.sku LIKE 'CAF-PKG-%' OR ii.sku LIKE 'CAF-OPS-GAS-%' OR ii.sku LIKE 'SMOKE-%' OR ii.sku LIKE 'ZZ-%') AND NOT EXISTS(SELECT 1 FROM gcims.recipe_items ri JOIN gcims.recipe_versions rv ON rv.company_id=ri.company_id AND rv.id=ri.recipe_version_id AND rv.status='active' WHERE ri.company_id=ii.company_id AND ri.inventory_item_id=ii.id) AND NOT EXISTS(SELECT 1 FROM gcims.supplier_inventory_items sii JOIN gcims.purchase_order_items poi ON poi.company_id=sii.company_id AND poi.inventory_item_id=sii.inventory_item_id JOIN gcims.purchase_orders po ON po.company_id=poi.company_id AND po.id=poi.purchase_order_id WHERE sii.company_id=ii.company_id AND sii.inventory_item_id=ii.id AND po.status NOT IN('cancelled','closed')) RETURNING ii.id) INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data,reason) SELECT s.company_id,s.outlet_id,s.admin_user_id,'admin.catalog.legacy_items_archived','inventory_catalog',s.company_id,jsonb_build_object('item_count',a.item_count),'Legacy test SKUs deactivated; stock ledger and transaction history retained.' FROM _ref_scope s CROSS JOIN (SELECT count(*)::int item_count FROM archived) a WHERE a.item_count>0;",
        "INSERT INTO gcims.menus(company_id,category_id,code,name,canonical_name,description,is_active) SELECT s.company_id,mc.id,m.code,m.name,m.canonical_name,'Harga merupakan angka acak untuk pengujian; ganti sebelum dipakai operasional.',m.can_sell FROM _ref_scope s CROSS JOIN _ref_menus m JOIN gcims.menu_categories mc ON mc.company_id=s.company_id AND mc.code=m.category_code ON CONFLICT(company_id,code) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,canonical_name=EXCLUDED.canonical_name,is_active=EXCLUDED.is_active,updated_at=now();",
        "INSERT INTO gcims.menu_variants(company_id,menu_id,code,name,price_amount,is_default,is_active,is_test_price) SELECT s.company_id,mn.id,'REGULAR','Reguler',src.test_price,TRUE,src.can_sell,TRUE FROM _ref_scope s CROSS JOIN _ref_menus src JOIN gcims.menus mn ON mn.company_id=s.company_id AND mn.code=src.code ON CONFLICT(menu_id,code) DO UPDATE SET name=EXCLUDED.name,is_default=TRUE,is_active=EXCLUDED.is_active,updated_at=now();",
        "INSERT INTO gcims.outlet_menu_variants(company_id,outlet_id,menu_variant_id,price_amount,is_available) SELECT s.company_id,s.outlet_id,mv.id,mv.price_amount,src.can_sell FROM _ref_scope s CROSS JOIN _ref_menus src JOIN gcims.menus mn ON mn.company_id=s.company_id AND mn.code=src.code JOIN gcims.menu_variants mv ON mv.company_id=mn.company_id AND mv.menu_id=mn.id AND mv.code='REGULAR' ON CONFLICT(outlet_id,menu_variant_id) DO UPDATE SET is_available=EXCLUDED.is_available,updated_at=now();",
        "INSERT INTO gcims.recipes(company_id,menu_variant_id,name) SELECT s.company_id,mv.id,src.name||' · Reguler' FROM _ref_scope s CROSS JOIN _ref_menus src JOIN gcims.menus mn ON mn.company_id=s.company_id AND mn.code=src.code JOIN gcims.menu_variants mv ON mv.company_id=mn.company_id AND mv.menu_id=mn.id AND mv.code='REGULAR' WHERE src.can_sell ON CONFLICT(menu_variant_id) DO NOTHING;",
        "UPDATE gcims.recipe_versions rv SET status='retired' FROM gcims.recipes r JOIN gcims.menu_variants mv ON mv.company_id=r.company_id AND mv.id=r.menu_variant_id JOIN gcims.menus m ON m.company_id=mv.company_id AND m.id=mv.menu_id JOIN _ref_menus src ON src.code=m.code WHERE rv.company_id=r.company_id AND rv.recipe_id=r.id AND rv.status='active' AND src.prep_line_count>0 AND rv.notes LIKE 'Imported READY BOM%' AND rv.notes LIKE '%preparation-only source line(s) without SKU%' AND rv.notes NOT LIKE '%Preparation only, no inventory SKU:%';",
        "CREATE TEMP TABLE _ref_new_versions(recipe_id uuid PRIMARY KEY,version_id uuid NOT NULL,version_no integer NOT NULL) ON COMMIT DROP;",
        "WITH missing AS (SELECT s.company_id,r.id recipe_id,COALESCE(MAX(old.version_no),0)+1 version_no,s.admin_user_id,m.code,src.prep_line_count,src.prep_notes FROM _ref_scope s CROSS JOIN _ref_menus src JOIN gcims.menus m ON m.company_id=s.company_id AND m.code=src.code JOIN gcims.menu_variants mv ON mv.company_id=m.company_id AND mv.menu_id=m.id AND mv.code='REGULAR' JOIN gcims.recipes r ON r.company_id=mv.company_id AND r.menu_variant_id=mv.id LEFT JOIN gcims.recipe_versions old ON old.company_id=r.company_id AND old.recipe_id=r.id WHERE src.can_sell AND NOT EXISTS(SELECT 1 FROM gcims.recipe_versions active WHERE active.company_id=r.company_id AND active.recipe_id=r.id AND active.status='active') GROUP BY s.company_id,r.id,s.admin_user_id,m.code,src.prep_line_count,src.prep_notes), ins AS (INSERT INTO gcims.recipe_versions(company_id,recipe_id,version_no,status,effective_from,notes,created_by,approved_by) SELECT company_id,recipe_id,version_no,'draft',now(),'Imported READY BOM · reference catalog v1; quantities already converted to item base UOM.'||CASE WHEN prep_line_count>0 THEN ' Preparation only, no inventory SKU: '||prep_notes ELSE '' END,admin_user_id,admin_user_id FROM missing RETURNING id,recipe_id,version_no) INSERT INTO _ref_new_versions SELECT recipe_id,id,version_no FROM ins;",
        "INSERT INTO gcims.recipe_items(company_id,recipe_version_id,line_no,inventory_item_id,quantity_base,preparation_note) SELECT s.company_id,v.version_id,b.line_no,ii.id,b.quantity_base,CASE WHEN b.preparation_note IS NOT NULL THEN 'Source note: '||b.preparation_note ELSE NULL END FROM _ref_scope s CROSS JOIN _ref_bom b JOIN gcims.menus m ON m.company_id=s.company_id AND m.code=b.menu_code JOIN gcims.menu_variants mv ON mv.company_id=m.company_id AND mv.menu_id=m.id AND mv.code='REGULAR' JOIN gcims.recipes r ON r.company_id=mv.company_id AND r.menu_variant_id=mv.id JOIN _ref_new_versions v ON v.recipe_id=r.id JOIN gcims.inventory_items ii ON ii.company_id=s.company_id AND ii.sku=b.sku;",
        "UPDATE gcims.recipe_versions rv SET status='active' WHERE rv.id IN(SELECT version_id FROM _ref_new_versions);",
        "INSERT INTO gcims.audit_logs(company_id,outlet_id,actor_user_id,action,entity_type,entity_id,after_data,reason) SELECT s.company_id,s.outlet_id,s.admin_user_id,'admin.catalog.reference_imported','recipe',r.id,jsonb_build_object('version_no',v.version_no,'source','READY + Operational Master','test_price',TRUE,'recipe_lines',(SELECT count(*) FROM gcims.recipe_items ri WHERE ri.recipe_version_id=v.version_id)),'BOM uses converted stock quantities; prices are randomized for testing only.' FROM _ref_scope s JOIN _ref_new_versions v ON TRUE JOIN gcims.recipes r ON r.id=v.recipe_id;",
        "DO $$ BEGIN IF (SELECT count(*) FROM _ref_new_versions) NOT IN (0,2,49) THEN RAISE EXCEPTION 'Unexpected count of new BOM recipe versions: %',(SELECT count(*) FROM _ref_new_versions); END IF; END $$;",
        "SELECT 'catalog import ready' result,(SELECT count(*) FROM _ref_inventory) source_inventory,(SELECT count(*) FROM _ref_menus) source_menus,(SELECT count(*) FROM _ref_bom) converted_bom_lines,(SELECT count(*) FROM _ref_conversions) uom_conversions,(SELECT count(*) FROM _ref_suppliers) suppliers,(SELECT count(*) FROM _ref_new_versions) new_recipe_versions;",
        "COMMIT;",
    ]
    output_path.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print(f"Generated {output_path}: {len(inventory)} inventory items, {len(menu_values)} menus, "
          f"{len(bom_rows)} BOM rows, {len(conversions)} conversions, {len(suppliers)} suppliers.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ready", type=Path, required=True)
    parser.add_argument("--operational", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("db/seeds/seed_ready_operational_catalog.sql"))
    args = parser.parse_args()
    build(args.ready, args.operational, args.output)

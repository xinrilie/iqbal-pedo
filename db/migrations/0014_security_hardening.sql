-- Migration 0014: Security Hardening
-- 1) Enable Row Level Security on all gcims tables (defense-in-depth).
--    No policies are added because the app connects as the DB owner via
--    pg driver — the owner bypasses RLS by default.  Enabling RLS ensures
--    that if a lesser role ever gains access, it sees nothing without an
--    explicit policy.
-- 2) Pin search_path on all gcims trigger functions so a rogue schema
--    cannot shadow referenced tables.

BEGIN;

INSERT INTO gcims.schema_migrations (version) VALUES (14);

-- ═══════════════════════════════════════════
-- 1. ENABLE RLS ON ALL TABLES
-- ═══════════════════════════════════════════

ALTER TABLE "gcims"."companies"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."outlets"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."users"                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."company_memberships"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."roles"                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."permissions"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."role_permissions"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."user_role_assignments"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."uoms"                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."inventory_categories"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."inventory_items"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."item_uom_conversions"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."suppliers"                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."supplier_inventory_items"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."menu_categories"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."menus"                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."menu_variants"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."outlet_menu_variants"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."recipes"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."recipe_versions"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."recipe_items"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."stock_locations"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."inventory_lots"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."purchase_orders"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."purchase_order_items"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."goods_receipts"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."goods_receipt_items"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."sales_orders"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."sales_order_items"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."sales_order_item_recipe_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."payments"                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."payment_events"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."refunds"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."refund_items"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."stocktakes"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."stocktake_items"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."stock_ledger"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."audit_logs"                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."system_settings"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."kitchen_tickets"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."kitchen_ticket_items"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."kitchen_ticket_events"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."outbox_events"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."payment_webhook_inbox"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."stock_reservations"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."stock_reservation_lines"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."cashier_shifts"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."cash_drawer_events"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gcims"."schema_migrations"            ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════
-- 2. PIN search_path ON TRIGGER FUNCTIONS
-- ═══════════════════════════════════════════

CREATE OR REPLACE FUNCTION gcims.reject_update_delete()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
BEGIN
    RAISE EXCEPTION '% is append-only; create a compensating record instead', TG_TABLE_NAME;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_active_recipe_items()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
DECLARE
    v_version_id UUID;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        v_version_id := OLD.recipe_version_id;
        IF EXISTS (SELECT 1 FROM gcims.recipe_versions rv
                   WHERE rv.id = v_version_id AND rv.status = 'active')
           OR EXISTS (SELECT 1 FROM gcims.sales_order_items soi
                     WHERE soi.recipe_version_id = v_version_id) THEN
            RAISE EXCEPTION 'Recipe items for an active recipe version are immutable';
        END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        v_version_id := NEW.recipe_version_id;
        IF EXISTS (SELECT 1 FROM gcims.recipe_versions rv
                   WHERE rv.id = v_version_id AND rv.status = 'active')
           OR EXISTS (SELECT 1 FROM gcims.sales_order_items soi
                     WHERE soi.recipe_version_id = v_version_id) THEN
            RAISE EXCEPTION 'Recipe items for an active recipe version are immutable';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_recipe_version_immutability()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'active' OR EXISTS (
            SELECT 1 FROM gcims.sales_order_items soi WHERE soi.recipe_version_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'An active or transaction-referenced recipe version cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;

    IF (OLD.status = 'active' OR EXISTS (
        SELECT 1 FROM gcims.sales_order_items soi WHERE soi.recipe_version_id = OLD.id
    )) AND (
        NEW.recipe_id IS DISTINCT FROM OLD.recipe_id OR
        NEW.version_no IS DISTINCT FROM OLD.version_no OR
        NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
        NEW.notes IS DISTINCT FROM OLD.notes OR
        NEW.created_by IS DISTINCT FROM OLD.created_by OR
        NEW.approved_by IS DISTINCT FROM OLD.approved_by
    ) THEN
        RAISE EXCEPTION 'Recipe version metadata is immutable once active or used by a sale';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.validate_item_uom_conversion()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_inventory_base_uom_change()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
BEGIN
    IF NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id AND (
        EXISTS (SELECT 1 FROM gcims.stock_ledger WHERE inventory_item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM gcims.recipe_items WHERE inventory_item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM gcims.purchase_order_items WHERE inventory_item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM gcims.goods_receipt_items WHERE inventory_item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM gcims.sales_order_item_recipe_lines WHERE inventory_item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM gcims.inventory_lots WHERE inventory_item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM gcims.item_uom_conversions WHERE inventory_item_id = OLD.id)
    ) THEN
        RAISE EXCEPTION 'Base UOM cannot be changed after the inventory item is referenced by operational data; use a controlled migration';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_sales_order_item_snapshots()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
DECLARE
    v_order_id UUID;
    v_status VARCHAR(24);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_order_id := OLD.order_id;
    ELSE
        v_order_id := NEW.order_id;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id THEN
        RAISE EXCEPTION 'Sales order items cannot be moved between orders';
    END IF;
    SELECT status INTO v_status FROM gcims.sales_orders WHERE id = v_order_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'Sales order item snapshots can only be changed while the order is draft';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_sales_recipe_snapshot_lines()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
DECLARE
    v_item_id UUID;
    v_status VARCHAR(24);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_item_id := OLD.sales_order_item_id;
    ELSE
        v_item_id := NEW.sales_order_item_id;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.sales_order_item_id IS DISTINCT FROM NEW.sales_order_item_id THEN
        RAISE EXCEPTION 'Sales recipe snapshot lines cannot be moved between order items';
    END IF;
    SELECT o.status INTO v_status
      FROM gcims.sales_order_items i
      JOIN gcims.sales_orders o ON o.id = i.order_id
     WHERE i.id = v_item_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'Sales recipe snapshot lines can only be changed while the order is draft';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_sales_order_totals()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
BEGIN
    IF OLD.status <> 'draft' AND (
        NEW.currency_code IS DISTINCT FROM OLD.currency_code OR
        NEW.gross_subtotal_amount IS DISTINCT FROM OLD.gross_subtotal_amount OR
        NEW.discount_amount IS DISTINCT FROM OLD.discount_amount OR
        NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR
        NEW.grand_total_amount IS DISTINCT FROM OLD.grand_total_amount
    ) THEN
        RAISE EXCEPTION 'Sales order financial snapshots cannot change after draft';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_purchase_order_lines()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
DECLARE
    v_po_id UUID;
    v_status VARCHAR(24);
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id THEN
        RAISE EXCEPTION 'PO lines cannot be moved between purchase orders';
    END IF;
    IF TG_OP = 'DELETE' THEN v_po_id := OLD.purchase_order_id;
    ELSE v_po_id := NEW.purchase_order_id;
    END IF;
    SELECT status INTO v_status FROM gcims.purchase_orders WHERE id = v_po_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'PO lines can only be changed while the purchase order is draft';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_goods_receipt_lines()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
DECLARE
    v_receipt_id UUID;
    v_status VARCHAR(20);
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.goods_receipt_id IS DISTINCT FROM NEW.goods_receipt_id THEN
        RAISE EXCEPTION 'Goods receipt lines cannot be moved between receipts';
    END IF;

    IF TG_OP = 'DELETE' THEN v_receipt_id := OLD.goods_receipt_id;
    ELSE v_receipt_id := NEW.goods_receipt_id;
    END IF;

    SELECT status INTO v_status
      FROM gcims.goods_receipts
     WHERE id = v_receipt_id;

    IF TG_OP = 'UPDATE'
       AND v_status = 'approved'
       AND OLD.lot_id IS NULL
       AND NEW.lot_id IS NOT NULL
       AND current_setting('gcims.allow_goods_receipt_lot_link', TRUE) = 'on'
       AND (to_jsonb(NEW) - 'lot_id') = (to_jsonb(OLD) - 'lot_id') THEN
        RETURN NEW;
    END IF;

    IF v_status NOT IN ('draft', 'submitted') THEN
        RAISE EXCEPTION 'Goods receipt lines are locked after approval/posting/rejection';
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION gcims.guard_stocktake_lines()
 RETURNS trigger LANGUAGE plpgsql
 SET search_path = gcims
AS $function$
DECLARE
    v_stocktake_id UUID;
    v_status VARCHAR(20);
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.stocktake_id IS DISTINCT FROM NEW.stocktake_id THEN
        RAISE EXCEPTION 'Stocktake lines cannot be moved between sessions';
    END IF;
    IF TG_OP = 'DELETE' THEN v_stocktake_id := OLD.stocktake_id;
    ELSE v_stocktake_id := NEW.stocktake_id;
    END IF;
    SELECT status INTO v_status FROM gcims.stocktakes WHERE id = v_stocktake_id;
    IF v_status NOT IN ('draft', 'counting') THEN
        RAISE EXCEPTION 'Stocktake lines are locked after counting is submitted for review';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

COMMIT;

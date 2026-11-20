-- GCIMS | Sesi 1 - Fondasi data
-- Target: PostgreSQL 15+
-- Scope: schema relasional awal, bukan aplikasi siap produksi.
-- Catatan: transaksi bisnis dan posting lintas tabel tetap harus dijalankan
-- melalui service dalam satu DB transaction; aturan agregat lintas baris
-- yang tidak dapat dinyatakan dengan CHECK dijelaskan di dokumen pendamping.

BEGIN;

CREATE SCHEMA IF NOT EXISTS gcims;
SET search_path = gcims, public;

-- ---------------------------------------------------------------------------
-- 1. ORGANISASI, PENGGUNA, ROLE, DAN PERMISSION
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(40) NOT NULL UNIQUE,
    name            VARCHAR(160) NOT NULL,
    legal_name      VARCHAR(200),
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    timezone_name   VARCHAR(80) NOT NULL DEFAULT 'Asia/Jakarta',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outlets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            VARCHAR(40) NOT NULL,
    name            VARCHAR(160) NOT NULL,
    address         TEXT,
    timezone_name   VARCHAR(80) NOT NULL DEFAULT 'Asia/Jakarta',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_outlets_company_code UNIQUE (company_id, code),
    CONSTRAINT uq_outlets_company_id UNIQUE (company_id, id)
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(160) NOT NULL,
    email           VARCHAR(254),
    phone           VARCHAR(40),
    password_hash   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email_lower
    ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE company_memberships (
    company_id      UUID NOT NULL REFERENCES companies(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    membership_status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (membership_status IN ('invited', 'active', 'suspended', 'ended')),
    joined_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, user_id)
);

CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            VARCHAR(60) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    scope           VARCHAR(20) NOT NULL DEFAULT 'outlet'
        CHECK (scope IN ('company', 'outlet')),
    is_system_role  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_roles_company_code UNIQUE (company_id, code),
    CONSTRAINT uq_roles_company_id UNIQUE (company_id, id)
);

CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(100) NOT NULL UNIQUE,
    module          VARCHAR(60) NOT NULL,
    description     TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

-- outlet_id NULL berarti penugasan berlaku pada lingkup perusahaan.
CREATE TABLE user_role_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    user_id         UUID NOT NULL,
    role_id         UUID NOT NULL,
    outlet_id       UUID,
    assigned_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_user_role_membership
        FOREIGN KEY (company_id, user_id)
        REFERENCES company_memberships(company_id, user_id),
    CONSTRAINT fk_user_role_role
        FOREIGN KEY (company_id, role_id)
        REFERENCES roles(company_id, id),
    CONSTRAINT fk_user_role_outlet
        FOREIGN KEY (company_id, outlet_id)
        REFERENCES outlets(company_id, id),
    CONSTRAINT uq_user_role_scope
        UNIQUE NULLS NOT DISTINCT (company_id, user_id, role_id, outlet_id)
);

-- ---------------------------------------------------------------------------
-- 2. SATUAN, KATEGORI INVENTORI, MASTER BAHAN, KONVERSI, DAN SUPPLIER
-- ---------------------------------------------------------------------------
CREATE TABLE uoms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(20) NOT NULL UNIQUE,
    name            VARCHAR(80) NOT NULL,
    dimension       VARCHAR(20) NOT NULL
        CHECK (dimension IN ('mass', 'volume', 'count', 'length', 'other')),
    decimal_scale   SMALLINT NOT NULL DEFAULT 3 CHECK (decimal_scale BETWEEN 0 AND 6),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO uoms (code, name, dimension, decimal_scale) VALUES
    ('ml', 'Mililiter', 'volume', 3),
    ('l', 'Liter', 'volume', 3),
    ('g', 'Gram', 'mass', 3),
    ('kg', 'Kilogram', 'mass', 3),
    ('pcs', 'Pieces', 'count', 0),
    ('box', 'Box', 'count', 3)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE inventory_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            VARCHAR(40) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_inventory_categories_company_code UNIQUE (company_id, code),
    CONSTRAINT uq_inventory_categories_company_id UNIQUE (company_id, id)
);

CREATE TABLE inventory_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    category_id     UUID,
    sku             VARCHAR(60) NOT NULL,
    name            VARCHAR(160) NOT NULL,
    description     TEXT,
    base_uom_id     UUID NOT NULL REFERENCES uoms(id),
    minimum_stock_base NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (minimum_stock_base >= 0),
    safety_stock_base  NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (safety_stock_base >= 0),
    lead_time_days  INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    track_lot       BOOLEAN NOT NULL DEFAULT FALSE,
    track_expiry    BOOLEAN NOT NULL DEFAULT FALSE,
    allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_inventory_category
        FOREIGN KEY (company_id, category_id)
        REFERENCES inventory_categories(company_id, id),
    CONSTRAINT uq_inventory_items_company_sku UNIQUE (company_id, sku),
    CONSTRAINT uq_inventory_items_company_id UNIQUE (company_id, id),
    CONSTRAINT ck_expiry_requires_lot CHECK (NOT track_expiry OR track_lot)
);

-- Faktor berarti: 1 unit from_uom = factor_to_base * satuan dasar item.
-- Konversi dibekukan sebagai snapshot saat PO/penerimaan dilakukan.
CREATE TABLE item_uom_conversions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    from_uom_id     UUID NOT NULL REFERENCES uoms(id),
    factor_to_base  NUMERIC(18,8) NOT NULL CHECK (factor_to_base > 0),
    valid_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_to        DATE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_conversion_item
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT ck_conversion_dates CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT uq_item_conversion_version
        UNIQUE (company_id, inventory_item_id, from_uom_id, valid_from)
);
CREATE INDEX ix_item_uom_conversions_lookup
    ON item_uom_conversions (inventory_item_id, from_uom_id, valid_from DESC);

CREATE TABLE suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            VARCHAR(50) NOT NULL,
    name            VARCHAR(160) NOT NULL,
    contact_name    VARCHAR(120),
    email           VARCHAR(254),
    phone           VARCHAR(40),
    address         TEXT,
    payment_terms   VARCHAR(120),
    default_lead_time_days INTEGER CHECK (default_lead_time_days IS NULL OR default_lead_time_days >= 0),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_suppliers_company_code UNIQUE (company_id, code),
    CONSTRAINT uq_suppliers_company_id UNIQUE (company_id, id)
);

CREATE TABLE supplier_inventory_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    supplier_id     UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    supplier_sku    VARCHAR(80),
    purchase_uom_id UUID NOT NULL REFERENCES uoms(id),
    default_unit_price BIGINT CHECK (default_unit_price IS NULL OR default_unit_price >= 0),
    minimum_order_qty NUMERIC(18,6) CHECK (minimum_order_qty IS NULL OR minimum_order_qty > 0),
    lead_time_days  INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    is_preferred    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_supplier_item_supplier
        FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers(company_id, id),
    CONSTRAINT fk_supplier_item_inventory
        FOREIGN KEY (company_id, inventory_item_id) REFERENCES inventory_items(company_id, id),
    CONSTRAINT uq_supplier_inventory_item UNIQUE (supplier_id, inventory_item_id)
);

-- ---------------------------------------------------------------------------
-- 3. MENU, VARIAN, RESEP, VERSI RESEP, DAN BOM
-- ---------------------------------------------------------------------------
CREATE TABLE menu_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    code            VARCHAR(40) NOT NULL,
    name            VARCHAR(100) NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_menu_categories_company_code UNIQUE (company_id, code),
    CONSTRAINT uq_menu_categories_company_id UNIQUE (company_id, id)
);

CREATE TABLE menus (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    category_id     UUID,
    code            VARCHAR(60) NOT NULL,
    name            VARCHAR(160) NOT NULL,
    description     TEXT,
    image_url       TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_menu_company FOREIGN KEY (company_id) REFERENCES companies(id),
    CONSTRAINT fk_menu_category
        FOREIGN KEY (company_id, category_id)
        REFERENCES menu_categories(company_id, id),
    CONSTRAINT uq_menus_company_code UNIQUE (company_id, code),
    CONSTRAINT uq_menus_company_id UNIQUE (company_id, id)
);

CREATE TABLE menu_variants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    menu_id         UUID NOT NULL,
    code            VARCHAR(60) NOT NULL,
    name            VARCHAR(100) NOT NULL DEFAULT 'Reguler',
    price_amount    BIGINT NOT NULL CHECK (price_amount >= 0),
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_variant_menu
        FOREIGN KEY (company_id, menu_id) REFERENCES menus(company_id, id),
    CONSTRAINT uq_menu_variant_code UNIQUE (menu_id, code),
    CONSTRAINT uq_menu_variant_company_id UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX uq_one_default_variant_per_menu
    ON menu_variants (menu_id) WHERE is_default;

-- Harga dan ketersediaan dapat dioverride per outlet; harga transaksi tetap snapshot.
CREATE TABLE outlet_menu_variants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    menu_variant_id UUID NOT NULL,
    price_amount    BIGINT NOT NULL CHECK (price_amount >= 0),
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_outlet_menu_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT fk_outlet_menu_variant
        FOREIGN KEY (company_id, menu_variant_id) REFERENCES menu_variants(company_id, id),
    CONSTRAINT uq_outlet_menu_variant UNIQUE (outlet_id, menu_variant_id)
);

CREATE TABLE recipes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    menu_variant_id UUID NOT NULL,
    name            VARCHAR(160) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_recipe_variant
        FOREIGN KEY (company_id, menu_variant_id)
        REFERENCES menu_variants(company_id, id),
    CONSTRAINT uq_recipe_per_variant UNIQUE (menu_variant_id),
    CONSTRAINT uq_recipes_company_id UNIQUE (company_id, id)
);

CREATE TABLE recipe_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    recipe_id       UUID NOT NULL,
    version_no      INTEGER NOT NULL CHECK (version_no > 0),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'active', 'retired')),
    effective_from TIMESTAMPTZ,
    effective_to   TIMESTAMPTZ,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_recipe_version_recipe
        FOREIGN KEY (company_id, recipe_id) REFERENCES recipes(company_id, id),
    CONSTRAINT uq_recipe_version_number UNIQUE (recipe_id, version_no),
    CONSTRAINT uq_recipe_versions_company_id UNIQUE (company_id, id),
    CONSTRAINT ck_recipe_version_dates
        CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    CONSTRAINT ck_active_recipe_dates
        CHECK (status <> 'active' OR effective_from IS NOT NULL)
);
CREATE UNIQUE INDEX uq_single_active_version_per_recipe
    ON recipe_versions (recipe_id) WHERE status = 'active';
CREATE INDEX ix_recipe_versions_effective
    ON recipe_versions (recipe_id, status, effective_from DESC);

-- Kuantitas BOM selalu disimpan dalam base_uom item terkait, bukan UOM bebas.
-- UI mengambil kode/nama satuan dari inventory_items.base_uom_id.
CREATE TABLE recipe_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    recipe_version_id UUID NOT NULL,
    line_no         SMALLINT NOT NULL CHECK (line_no > 0),
    inventory_item_id UUID NOT NULL,
    quantity_base   NUMERIC(18,6) NOT NULL CHECK (quantity_base > 0),
    preparation_note TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_recipe_item_version
        FOREIGN KEY (company_id, recipe_version_id)
        REFERENCES recipe_versions(company_id, id),
    CONSTRAINT fk_recipe_item_inventory
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT uq_recipe_item_line UNIQUE (recipe_version_id, line_no)
);
CREATE INDEX ix_recipe_items_inventory ON recipe_items (inventory_item_id);

-- ---------------------------------------------------------------------------
-- 4. LOKASI STOK DAN LOT/BATCH
-- ---------------------------------------------------------------------------
CREATE TABLE stock_locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    code            VARCHAR(50) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    location_type   VARCHAR(20) NOT NULL DEFAULT 'warehouse'
        CHECK (location_type IN ('warehouse', 'bar', 'kitchen', 'storage', 'other')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_stock_location_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT uq_stock_location_code UNIQUE (outlet_id, code),
    CONSTRAINT uq_stock_location_company_outlet_id UNIQUE (company_id, outlet_id, id),
    CONSTRAINT uq_stock_location_company_id UNIQUE (company_id, id)
);

CREATE TABLE inventory_lots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    supplier_id     UUID,
    lot_code        VARCHAR(100) NOT NULL,
    supplier_lot_code VARCHAR(100),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    manufactured_at DATE,
    expiry_date     DATE,
    unit_cost_base_amount BIGINT CHECK (unit_cost_base_amount IS NULL OR unit_cost_base_amount >= 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_lot_inventory
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT fk_lot_location
        FOREIGN KEY (company_id, stock_location_id)
        REFERENCES stock_locations(company_id, id),
    CONSTRAINT fk_lot_supplier
        FOREIGN KEY (company_id, supplier_id)
        REFERENCES suppliers(company_id, id),
    CONSTRAINT ck_lot_dates
        CHECK (expiry_date IS NULL OR manufactured_at IS NULL OR expiry_date >= manufactured_at),
    CONSTRAINT uq_lot_item_location_code UNIQUE (inventory_item_id, stock_location_id, lot_code),
    CONSTRAINT uq_lot_company_item_location_id
        UNIQUE (company_id, inventory_item_id, stock_location_id, id)
);
CREATE INDEX ix_inventory_lots_expiry
    ON inventory_lots (stock_location_id, inventory_item_id, expiry_date)
    WHERE expiry_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. PENGADAAN DAN PENERIMAAN BARANG
-- ---------------------------------------------------------------------------
CREATE TABLE purchase_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    po_number       VARCHAR(60) NOT NULL,
    supplier_id     UUID NOT NULL,
    status          VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent',
                          'partially_received', 'fully_received', 'closed', 'cancelled')),
    ordered_at      TIMESTAMPTZ,
    expected_at     TIMESTAMPTZ,
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    subtotal_amount BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount      BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    shipping_amount BIGINT NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
    total_amount    BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_po_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT fk_po_supplier
        FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers(company_id, id),
    CONSTRAINT uq_po_number UNIQUE (outlet_id, po_number),
    CONSTRAINT uq_po_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_po_company_outlet_id UNIQUE (company_id, outlet_id, id),
    CONSTRAINT ck_po_amounts CHECK (subtotal_amount >= discount_amount),
    CONSTRAINT ck_po_total CHECK
        (total_amount = subtotal_amount - discount_amount + tax_amount + shipping_amount)
);
CREATE INDEX ix_purchase_orders_status_eta
    ON purchase_orders (company_id, outlet_id, status, expected_at);

CREATE TABLE purchase_order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    purchase_order_id UUID NOT NULL,
    line_no         SMALLINT NOT NULL CHECK (line_no > 0),
    inventory_item_id UUID NOT NULL,
    description_snapshot VARCHAR(200) NOT NULL,
    purchase_uom_id UUID NOT NULL REFERENCES uoms(id),
    quantity_ordered NUMERIC(18,6) NOT NULL CHECK (quantity_ordered > 0),
    base_qty_per_purchase_unit NUMERIC(18,8) NOT NULL CHECK (base_qty_per_purchase_unit > 0),
    quantity_ordered_base NUMERIC(18,6) NOT NULL CHECK (quantity_ordered_base > 0),
    unit_price_purchase_uom BIGINT NOT NULL CHECK (unit_price_purchase_uom >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_total_amount BIGINT NOT NULL CHECK (line_total_amount >= 0),
    notes           TEXT,
    CONSTRAINT fk_po_item_header
        FOREIGN KEY (company_id, purchase_order_id)
        REFERENCES purchase_orders(company_id, id),
    CONSTRAINT fk_po_item_inventory
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT uq_po_item_line UNIQUE (purchase_order_id, line_no),
    CONSTRAINT uq_po_item_company_id_inventory UNIQUE (company_id, id, inventory_item_id),
    CONSTRAINT ck_po_item_quantity_conversion
        CHECK (quantity_ordered_base = round(quantity_ordered * base_qty_per_purchase_unit, 6))
);
CREATE INDEX ix_po_items_inventory ON purchase_order_items (inventory_item_id);

CREATE TABLE goods_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    purchase_order_id UUID NOT NULL,
    receipt_number  VARCHAR(60) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'posted', 'rejected')),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    supplier_document_no VARCHAR(100),
    notes           TEXT,
    received_by     UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    posted_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_receipt_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT fk_receipt_po
        FOREIGN KEY (company_id, outlet_id, purchase_order_id)
        REFERENCES purchase_orders(company_id, outlet_id, id),
    CONSTRAINT uq_receipt_number UNIQUE (outlet_id, receipt_number),
    CONSTRAINT uq_receipt_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_receipt_company_id_outlet UNIQUE (company_id, id, outlet_id)
);
CREATE INDEX ix_goods_receipts_po ON goods_receipts (purchase_order_id, status);

CREATE TABLE goods_receipt_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    goods_receipt_id UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    purchase_order_item_id UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    lot_id          UUID,
    quantity_received_purchase_uom NUMERIC(18,6) NOT NULL CHECK (quantity_received_purchase_uom > 0),
    quantity_rejected_purchase_uom NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (quantity_rejected_purchase_uom >= 0),
    base_qty_per_purchase_unit NUMERIC(18,8) NOT NULL CHECK (base_qty_per_purchase_unit > 0),
    quantity_accepted_base NUMERIC(18,6) NOT NULL CHECK (quantity_accepted_base > 0),
    unit_cost_base_amount BIGINT CHECK (unit_cost_base_amount IS NULL OR unit_cost_base_amount >= 0),
    rejection_reason TEXT,
    notes           TEXT,
    CONSTRAINT fk_receipt_item_header
        FOREIGN KEY (company_id, goods_receipt_id, outlet_id)
        REFERENCES goods_receipts(company_id, id, outlet_id),
    CONSTRAINT fk_receipt_item_po_line
        FOREIGN KEY (company_id, purchase_order_item_id, inventory_item_id)
        REFERENCES purchase_order_items(company_id, id, inventory_item_id),
    CONSTRAINT fk_receipt_item_location
        FOREIGN KEY (company_id, outlet_id, stock_location_id)
        REFERENCES stock_locations(company_id, outlet_id, id),
    CONSTRAINT fk_receipt_item_inventory
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT fk_receipt_item_lot
        FOREIGN KEY (company_id, inventory_item_id, stock_location_id, lot_id)
        REFERENCES inventory_lots(company_id, inventory_item_id, stock_location_id, id),
    CONSTRAINT ck_receipt_item_qty
        CHECK (quantity_received_purchase_uom >= quantity_rejected_purchase_uom),
    CONSTRAINT ck_receipt_item_accepted_conversion
        CHECK (quantity_accepted_base = round(
            (quantity_received_purchase_uom - quantity_rejected_purchase_uom)
            * base_qty_per_purchase_unit, 6))
);
CREATE INDEX ix_receipt_items_po_line ON goods_receipt_items (purchase_order_item_id);

-- ---------------------------------------------------------------------------
-- 6. PENJUALAN, ITEM PENJUALAN, SNAPSHOT BOM, PEMBAYARAN, REFUND
-- ---------------------------------------------------------------------------
CREATE TABLE sales_orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    order_number    VARCHAR(60) NOT NULL,
    order_type      VARCHAR(20) NOT NULL
        CHECK (order_type IN ('dine_in', 'takeaway')),
    table_label     VARCHAR(40),
    queue_name      VARCHAR(100),
    status          VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_payment', 'confirmed', 'in_preparation',
                          'ready', 'served', 'completed', 'cancelled',
                          'partially_cancelled', 'partially_refunded', 'refunded')),
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    gross_subtotal_amount BIGINT NOT NULL DEFAULT 0 CHECK (gross_subtotal_amount >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount      BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    grand_total_amount BIGINT NOT NULL DEFAULT 0 CHECK (grand_total_amount >= 0),
    customer_note   TEXT,
    created_by      UUID REFERENCES users(id),
    cashier_user_id UUID REFERENCES users(id),
    placed_at       TIMESTAMPTZ,
    confirmed_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancel_reason   TEXT,
    idempotency_key VARCHAR(120),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_sales_order_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT fk_sales_order_location
        FOREIGN KEY (company_id, outlet_id, stock_location_id)
        REFERENCES stock_locations(company_id, outlet_id, id),
    CONSTRAINT uq_sales_order_number UNIQUE (outlet_id, order_number),
    CONSTRAINT uq_sales_order_company_id UNIQUE (company_id, id),
    CONSTRAINT ck_sales_order_amounts CHECK (gross_subtotal_amount >= discount_amount),
    CONSTRAINT ck_sales_order_total CHECK
        (grand_total_amount = gross_subtotal_amount - discount_amount + tax_amount)
);
CREATE UNIQUE INDEX uq_sales_order_idempotency
    ON sales_orders (outlet_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_sales_orders_outlet_date_status
    ON sales_orders (outlet_id, placed_at DESC, status);

CREATE TABLE sales_order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    order_id        UUID NOT NULL,
    line_no         SMALLINT NOT NULL CHECK (line_no > 0),
    menu_variant_id UUID NOT NULL,
    recipe_version_id UUID,
    menu_name_snapshot VARCHAR(160) NOT NULL,
    variant_name_snapshot VARCHAR(100) NOT NULL,
    sku_snapshot    VARCHAR(60),
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_price_amount BIGINT NOT NULL CHECK (unit_price_amount >= 0),
    gross_amount    BIGINT NOT NULL CHECK (gross_amount >= 0),
    discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_rate        NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount      BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount    BIGINT NOT NULL CHECK (total_amount >= 0),
    item_note       TEXT,
    CONSTRAINT fk_sales_item_order
        FOREIGN KEY (company_id, order_id) REFERENCES sales_orders(company_id, id),
    CONSTRAINT fk_sales_item_variant
        FOREIGN KEY (company_id, menu_variant_id) REFERENCES menu_variants(company_id, id),
    CONSTRAINT fk_sales_item_recipe_version
        FOREIGN KEY (company_id, recipe_version_id) REFERENCES recipe_versions(company_id, id),
    CONSTRAINT uq_sales_item_line UNIQUE (order_id, line_no),
    CONSTRAINT uq_sales_order_item_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_sales_order_item_company_order UNIQUE (company_id, order_id, id),
    CONSTRAINT ck_sales_item_discount CHECK (gross_amount >= discount_amount),
    CONSTRAINT ck_sales_item_total CHECK
        (total_amount = gross_amount - discount_amount + tax_amount)
);
CREATE INDEX ix_sales_order_items_variant ON sales_order_items (menu_variant_id);

-- Snapshot konsumsi bahan dari versi BOM yang benar-benar dipakai transaksi.
-- quantity_base = total pemakaian bahan untuk seluruh quantity pada baris penjualan.
CREATE TABLE sales_order_item_recipe_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    sales_order_item_id UUID NOT NULL,
    line_no         SMALLINT NOT NULL CHECK (line_no > 0),
    inventory_item_id UUID NOT NULL,
    item_name_snapshot VARCHAR(160) NOT NULL,
    sku_snapshot    VARCHAR(60) NOT NULL,
    base_uom_code_snapshot VARCHAR(20) NOT NULL,
    quantity_base   NUMERIC(18,6) NOT NULL CHECK (quantity_base > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_sales_recipe_line_order_item
        FOREIGN KEY (company_id, sales_order_item_id)
        REFERENCES sales_order_items(company_id, id),
    CONSTRAINT fk_sales_recipe_line_inventory
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT uq_sales_recipe_line UNIQUE (sales_order_item_id, line_no)
);
CREATE INDEX ix_sales_recipe_lines_inventory ON sales_order_item_recipe_lines (inventory_item_id);

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    order_id        UUID NOT NULL,
    payment_number  VARCHAR(80) NOT NULL,
    method          VARCHAR(24) NOT NULL
        CHECK (method IN ('cash', 'qris', 'card', 'bank_transfer', 'other')),
    provider_code   VARCHAR(60),
    provider_reference VARCHAR(160),
    status          VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'expired', 'cancelled',
                          'partially_refunded', 'refunded', 'reconciliation_required')),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    currency_code   CHAR(3) NOT NULL DEFAULT 'IDR',
    idempotency_key VARCHAR(120) NOT NULL,
    initiated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,
    cash_received_amount BIGINT CHECK (cash_received_amount IS NULL OR cash_received_amount >= 0),
    cash_change_amount BIGINT CHECK (cash_change_amount IS NULL OR cash_change_amount >= 0),
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_payment_order
        FOREIGN KEY (company_id, order_id) REFERENCES sales_orders(company_id, id),
    CONSTRAINT uq_payment_number UNIQUE (payment_number),
    CONSTRAINT uq_payment_idempotency UNIQUE (company_id, idempotency_key),
    CONSTRAINT uq_payment_company_order_id UNIQUE (company_id, order_id, id)
);
CREATE UNIQUE INDEX uq_payment_provider_reference
    ON payments (provider_code, provider_reference)
    WHERE provider_code IS NOT NULL AND provider_reference IS NOT NULL;
CREATE INDEX ix_payments_order_status ON payments (order_id, status);

CREATE TABLE payment_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      UUID NOT NULL,
    provider_code   VARCHAR(60) NOT NULL,
    provider_event_id VARCHAR(180) NOT NULL,
    event_type      VARCHAR(80) NOT NULL,
    signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
        CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
    processing_error TEXT,
    CONSTRAINT uq_payment_provider_event UNIQUE (provider_code, provider_event_id)
);
CREATE INDEX ix_payment_events_unprocessed
    ON payment_events (received_at) WHERE processing_status = 'received';

CREATE TABLE refunds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    order_id        UUID NOT NULL,
    payment_id      UUID NOT NULL,
    refund_number   VARCHAR(80) NOT NULL UNIQUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'pending', 'succeeded', 'failed', 'rejected')),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    reason_code     VARCHAR(60) NOT NULL,
    reason_note     TEXT,
    provider_reference VARCHAR(160),
    requested_by    UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_refund_order
        FOREIGN KEY (company_id, order_id) REFERENCES sales_orders(company_id, id),
    CONSTRAINT fk_refund_payment_same_order
        FOREIGN KEY (company_id, order_id, payment_id)
        REFERENCES payments(company_id, order_id, id),
    CONSTRAINT uq_refund_company_order_id UNIQUE (company_id, order_id, id)
);
CREATE INDEX ix_refunds_order_status ON refunds (order_id, status);

CREATE TABLE refund_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    order_id        UUID NOT NULL,
    refund_id       UUID NOT NULL,
    sales_order_item_id UUID NOT NULL,
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_refund_item_refund
        FOREIGN KEY (company_id, order_id, refund_id)
        REFERENCES refunds(company_id, order_id, id),
    CONSTRAINT fk_refund_item_order_line
        FOREIGN KEY (company_id, order_id, sales_order_item_id)
        REFERENCES sales_order_items(company_id, order_id, id),
    CONSTRAINT uq_refund_item UNIQUE (refund_id, sales_order_item_id)
);

-- ---------------------------------------------------------------------------
-- 7. STOCKTAKE DAN STOCK LEDGER (LEDGER ADALAH SUMBER AUDIT SALDO)
-- ---------------------------------------------------------------------------
CREATE TABLE stocktakes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    stocktake_number VARCHAR(60) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'counting', 'pending_review', 'approved', 'posted', 'cancelled')),
    cutoff_at       TIMESTAMPTZ NOT NULL,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    reviewed_by     UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    posted_at       TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_stocktake_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT fk_stocktake_location
        FOREIGN KEY (company_id, outlet_id, stock_location_id)
        REFERENCES stock_locations(company_id, outlet_id, id),
    CONSTRAINT uq_stocktake_number UNIQUE (outlet_id, stocktake_number),
    CONSTRAINT uq_stocktake_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_stocktake_company_location UNIQUE (company_id, id, stock_location_id)
);

CREATE TABLE stocktake_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    stocktake_id    UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    lot_id          UUID,
    system_qty_base NUMERIC(18,6) NOT NULL CHECK (system_qty_base >= 0),
    counted_qty_base NUMERIC(18,6) CHECK (counted_qty_base IS NULL OR counted_qty_base >= 0),
    variance_qty_base NUMERIC(18,6)
        GENERATED ALWAYS AS (counted_qty_base - system_qty_base) STORED,
    reason_code     VARCHAR(60),
    notes           TEXT,
    counted_by      UUID REFERENCES users(id),
    counted_at      TIMESTAMPTZ,
    CONSTRAINT fk_stocktake_item_location
        FOREIGN KEY (company_id, stocktake_id, stock_location_id)
        REFERENCES stocktakes(company_id, id, stock_location_id),
    CONSTRAINT fk_stocktake_item_inventory
        FOREIGN KEY (company_id, inventory_item_id) REFERENCES inventory_items(company_id, id),
    CONSTRAINT fk_stocktake_item_lot
        FOREIGN KEY (company_id, inventory_item_id, stock_location_id, lot_id)
        REFERENCES inventory_lots(company_id, inventory_item_id, stock_location_id, id),
    CONSTRAINT uq_stocktake_item UNIQUE NULLS NOT DISTINCT
        (stocktake_id, inventory_item_id, lot_id)
);
CREATE INDEX ix_stocktake_items_item ON stocktake_items (inventory_item_id);

CREATE TABLE stock_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL,
    outlet_id       UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    lot_id          UUID,
    movement_type   VARCHAR(30) NOT NULL
        CHECK (movement_type IN ('opening_balance', 'goods_receipt', 'sale_consumption',
                                 'waste', 'adjustment_in', 'adjustment_out',
                                 'transfer_in', 'transfer_out', 'return_to_stock',
                                 'stocktake_in', 'stocktake_out')),
    quantity_delta_base NUMERIC(18,6) NOT NULL CHECK (quantity_delta_base <> 0),
    occurred_at     TIMESTAMPTZ NOT NULL,
    posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_type     VARCHAR(30) NOT NULL
        CHECK (source_type IN ('opening', 'goods_receipt', 'sale', 'waste',
                               'adjustment', 'transfer', 'return', 'stocktake', 'system')),
    source_id       UUID,
    source_line_id  UUID,
    source_line_sequence SMALLINT NOT NULL DEFAULT 1 CHECK (source_line_sequence > 0),
    idempotency_key VARCHAR(180) NOT NULL UNIQUE,
    reversal_of_ledger_id UUID REFERENCES stock_ledger(id),
    reason          TEXT,
    actor_user_id   UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_ledger_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT fk_ledger_location
        FOREIGN KEY (company_id, outlet_id, stock_location_id)
        REFERENCES stock_locations(company_id, outlet_id, id),
    CONSTRAINT fk_ledger_inventory
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES inventory_items(company_id, id),
    CONSTRAINT fk_ledger_lot
        FOREIGN KEY (company_id, inventory_item_id, stock_location_id, lot_id)
        REFERENCES inventory_lots(company_id, inventory_item_id, stock_location_id, id),
    CONSTRAINT ck_ledger_direction CHECK (
        (movement_type IN ('opening_balance', 'goods_receipt', 'adjustment_in',
                           'transfer_in', 'return_to_stock', 'stocktake_in')
            AND quantity_delta_base > 0)
        OR
        (movement_type IN ('sale_consumption', 'waste', 'adjustment_out',
                           'transfer_out', 'stocktake_out')
            AND quantity_delta_base < 0)
    )
);
CREATE INDEX ix_stock_ledger_item_time
    ON stock_ledger (company_id, stock_location_id, inventory_item_id, occurred_at, id);
CREATE INDEX ix_stock_ledger_source
    ON stock_ledger (source_type, source_id, source_line_id);
CREATE UNIQUE INDEX uq_stock_ledger_source_line_movement
    ON stock_ledger (source_type, source_line_id, movement_type, source_line_sequence)
    WHERE source_line_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. AUDIT LOG DAN KONFIGURASI
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    outlet_id       UUID,
    actor_user_id   UUID REFERENCES users(id),
    actor_type      VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (actor_type IN ('user', 'system', 'integration')),
    action          VARCHAR(80) NOT NULL,
    entity_type     VARCHAR(80) NOT NULL,
    entity_id       UUID,
    before_data     JSONB,
    after_data      JSONB,
    reason          TEXT,
    request_id      VARCHAR(120),
    ip_address      INET,
    user_agent      TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_audit_outlet_same_company
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id)
);
CREATE INDEX ix_audit_entity_time ON audit_logs (company_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_actor_time ON audit_logs (actor_user_id, occurred_at DESC);

CREATE TABLE system_settings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id),
    outlet_id       UUID,
    setting_key     VARCHAR(120) NOT NULL,
    setting_value  JSONB NOT NULL,
    description     TEXT,
    updated_by      UUID REFERENCES users(id),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_setting_outlet
        FOREIGN KEY (company_id, outlet_id) REFERENCES outlets(company_id, id),
    CONSTRAINT uq_system_setting_scope
        UNIQUE NULLS NOT DISTINCT (company_id, outlet_id, setting_key)
);

-- ---------------------------------------------------------------------------
-- 9. VIEW SALDO LEDGER DAN RINGKASAN PENERIMAAN PO
-- ---------------------------------------------------------------------------
CREATE VIEW v_stock_on_hand AS
SELECT
    company_id,
    outlet_id,
    stock_location_id,
    inventory_item_id,
    lot_id,
    SUM(quantity_delta_base) AS on_hand_qty_base
FROM stock_ledger
GROUP BY company_id, outlet_id, stock_location_id, inventory_item_id, lot_id;

CREATE VIEW v_purchase_order_item_receipts AS
SELECT
    poi.id AS purchase_order_item_id,
    poi.purchase_order_id,
    poi.quantity_ordered_base,
    COALESCE(SUM(gri.quantity_accepted_base)
        FILTER (WHERE gr.status = 'posted'), 0) AS quantity_received_base,
    poi.quantity_ordered_base - COALESCE(SUM(gri.quantity_accepted_base)
        FILTER (WHERE gr.status = 'posted'), 0) AS quantity_outstanding_base
FROM purchase_order_items poi
LEFT JOIN goods_receipt_items gri ON gri.purchase_order_item_id = poi.id
LEFT JOIN goods_receipts gr ON gr.id = gri.goods_receipt_id
GROUP BY poi.id, poi.purchase_order_id, poi.quantity_ordered_base;

-- ---------------------------------------------------------------------------
-- 10. GUARDRAIL: LEDGER DAN AUDIT APPEND-ONLY; BOM AKTIF TIDAK DIUBAH
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gcims.reject_update_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a compensating record instead', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_stock_ledger_append_only
BEFORE UPDATE OR DELETE ON stock_ledger
FOR EACH ROW EXECUTE FUNCTION gcims.reject_update_delete();

CREATE TRIGGER trg_audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION gcims.reject_update_delete();

CREATE OR REPLACE FUNCTION gcims.guard_active_recipe_items()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_recipe_items_active_immutable
BEFORE INSERT OR UPDATE OR DELETE ON recipe_items
FOR EACH ROW EXECUTE FUNCTION gcims.guard_active_recipe_items();

CREATE OR REPLACE FUNCTION gcims.guard_recipe_version_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_recipe_version_immutable
BEFORE UPDATE OR DELETE ON recipe_versions
FOR EACH ROW EXECUTE FUNCTION gcims.guard_recipe_version_immutability();

CREATE OR REPLACE FUNCTION gcims.validate_item_uom_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_from_dimension VARCHAR(20);
    v_base_dimension VARCHAR(20);
    v_base_uom_id UUID;
BEGIN
    SELECT dimension INTO v_from_dimension FROM gcims.uoms WHERE id = NEW.from_uom_id;
    SELECT i.base_uom_id, u.dimension INTO v_base_uom_id, v_base_dimension
      FROM gcims.inventory_items i
      JOIN gcims.uoms u ON u.id = i.base_uom_id
     WHERE i.id = NEW.inventory_item_id AND i.company_id = NEW.company_id;

    IF v_from_dimension IS NULL OR v_base_dimension IS NULL THEN
        RAISE EXCEPTION 'UOM or inventory item was not found';
    END IF;
    IF NEW.from_uom_id = v_base_uom_id THEN
        RAISE EXCEPTION 'A conversion row cannot convert the base UOM to itself';
    END IF;
    IF v_from_dimension <> v_base_dimension THEN
        RAISE EXCEPTION 'UOM dimensions must match; density-based conversions require an explicit, separately governed rule';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_item_uom_conversion
BEFORE INSERT OR UPDATE ON item_uom_conversions
FOR EACH ROW EXECUTE FUNCTION gcims.validate_item_uom_conversion();

CREATE OR REPLACE FUNCTION gcims.guard_inventory_base_uom_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_inventory_base_uom_immutable_after_use
BEFORE UPDATE OF base_uom_id ON inventory_items
FOR EACH ROW EXECUTE FUNCTION gcims.guard_inventory_base_uom_change();

CREATE OR REPLACE FUNCTION gcims.guard_sales_order_item_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_sales_order_item_snapshot_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales_order_items
FOR EACH ROW EXECUTE FUNCTION gcims.guard_sales_order_item_snapshots();

CREATE OR REPLACE FUNCTION gcims.guard_sales_recipe_snapshot_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_sales_recipe_snapshot_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales_order_item_recipe_lines
FOR EACH ROW EXECUTE FUNCTION gcims.guard_sales_recipe_snapshot_lines();

CREATE OR REPLACE FUNCTION gcims.guard_sales_order_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_sales_order_totals_immutable_after_draft
BEFORE UPDATE ON sales_orders
FOR EACH ROW EXECUTE FUNCTION gcims.guard_sales_order_totals();

CREATE OR REPLACE FUNCTION gcims.guard_purchase_order_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_purchase_order_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_items
FOR EACH ROW EXECUTE FUNCTION gcims.guard_purchase_order_lines();

CREATE OR REPLACE FUNCTION gcims.guard_goods_receipt_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
    SELECT status INTO v_status FROM gcims.goods_receipts WHERE id = v_receipt_id;
    IF v_status NOT IN ('draft', 'submitted') THEN
        RAISE EXCEPTION 'Goods receipt lines are locked after approval/posting/rejection';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_goods_receipt_lines_pre_post_only
BEFORE INSERT OR UPDATE OR DELETE ON goods_receipt_items
FOR EACH ROW EXECUTE FUNCTION gcims.guard_goods_receipt_lines();

CREATE OR REPLACE FUNCTION gcims.guard_stocktake_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

CREATE TRIGGER trg_stocktake_lines_counting_only
BEFORE INSERT OR UPDATE OR DELETE ON stocktake_items
FOR EACH ROW EXECUTE FUNCTION gcims.guard_stocktake_lines();

COMMIT;

-- Catatan implementasi wajib:
-- 1) Trigger ini tidak menggantikan RBAC, validasi service, atau transaksi atomik.
-- 2) Pembuatan order + payment confirmation + ledger + outbox event harus
--    dirancang sebagai satu transaksi DB atau pola outbox pada sesi lanjutan.
-- 3) Agregat seperti total refund <= pembayaran sukses, total receipt <= PO,
--    ketersediaan stok >= 0, dan kecocokan company/order/payment harus
--    diperiksa dengan row locking dan service transaction; CHECK biasa tidak cukup.

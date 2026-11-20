-- GCIMS Sesi 3 — stock reservation and inventory availability.
-- Apply after db/migrations/0001_schema_sesi1.sql, db/migrations/0002_migration_sesi2.sql and db/migrations/0003_hardening_v011.sql.
-- Additive migration: keeps stock_ledger append-only and derives on-hand from its movements.
BEGIN;

CREATE TABLE IF NOT EXISTS gcims.stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    order_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'reserved'
        CHECK (status IN ('reserved', 'consumed', 'released', 'expired')),
    idempotency_key VARCHAR(180) NOT NULL,
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    release_reason TEXT,
    created_by UUID REFERENCES gcims.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_stock_reservation_order
        FOREIGN KEY (company_id, outlet_id, order_id)
        REFERENCES gcims.sales_orders(company_id, outlet_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_reservation_location
        FOREIGN KEY (company_id, outlet_id, stock_location_id)
        REFERENCES gcims.stock_locations(company_id, outlet_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_stock_reservation_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_stock_reservation_company_location
        UNIQUE (company_id, id, stock_location_id),
    CONSTRAINT uq_stock_reservation_idempotency UNIQUE (company_id, idempotency_key),
    CONSTRAINT ck_stock_reservation_expiry CHECK (expires_at > reserved_at),
    CONSTRAINT ck_stock_reservation_terminal_timestamp CHECK (
        (status = 'reserved' AND consumed_at IS NULL AND released_at IS NULL AND expired_at IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND released_at IS NULL AND expired_at IS NULL)
        OR (status = 'released' AND released_at IS NOT NULL AND consumed_at IS NULL AND expired_at IS NULL)
        OR (status = 'expired' AND expired_at IS NOT NULL AND consumed_at IS NULL AND released_at IS NULL)
    )
);

-- An order can have at most one live reservation; expired/released attempts remain auditable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_reservation_active_order
    ON gcims.stock_reservations (company_id, outlet_id, order_id)
    WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS ix_stock_reservations_expiry
    ON gcims.stock_reservations (company_id, outlet_id, expires_at)
    WHERE status = 'reserved';

CREATE TABLE IF NOT EXISTS gcims.stock_reservation_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    reservation_id UUID NOT NULL,
    stock_location_id UUID NOT NULL,
    inventory_item_id UUID NOT NULL,
    lot_id UUID,
    quantity_reserved_base NUMERIC(18,6) NOT NULL CHECK (quantity_reserved_base > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_stock_reservation_line_header
        FOREIGN KEY (company_id, reservation_id, stock_location_id)
        REFERENCES gcims.stock_reservations(company_id, id, stock_location_id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_reservation_line_item
        FOREIGN KEY (company_id, inventory_item_id)
        REFERENCES gcims.inventory_items(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_reservation_line_lot
        FOREIGN KEY (company_id, inventory_item_id, stock_location_id, lot_id)
        REFERENCES gcims.inventory_lots(company_id, inventory_item_id, stock_location_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_stock_reservation_line_bucket
        UNIQUE NULLS NOT DISTINCT (reservation_id, inventory_item_id, lot_id)
);

CREATE INDEX IF NOT EXISTS ix_stock_reservation_lines_item_lot
    ON gcims.stock_reservation_lines (company_id, stock_location_id, inventory_item_id, lot_id);

-- Available balance = append-only ledger balance minus unexpired reservations.
CREATE OR REPLACE VIEW gcims.v_stock_available AS
SELECT soh.company_id,
       soh.outlet_id,
       soh.stock_location_id,
       soh.inventory_item_id,
       soh.lot_id,
       soh.on_hand_qty_base,
       COALESCE(reserved.reserved_qty_base, 0)::NUMERIC(18,6) AS reserved_qty_base,
       (soh.on_hand_qty_base - COALESCE(reserved.reserved_qty_base, 0))::NUMERIC(18,6) AS available_qty_base
  FROM gcims.v_stock_on_hand soh
  LEFT JOIN LATERAL (
    SELECT SUM(srl.quantity_reserved_base) AS reserved_qty_base
      FROM gcims.stock_reservation_lines srl
      JOIN gcims.stock_reservations sr
        ON sr.company_id = srl.company_id AND sr.id = srl.reservation_id
     WHERE sr.company_id = soh.company_id
       AND sr.outlet_id = soh.outlet_id
       AND sr.stock_location_id = soh.stock_location_id
       AND srl.inventory_item_id = soh.inventory_item_id
       AND srl.lot_id IS NOT DISTINCT FROM soh.lot_id
       AND sr.status = 'reserved'
       AND sr.expires_at > now()
  ) reserved ON TRUE;

COMMIT;

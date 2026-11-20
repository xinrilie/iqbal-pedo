-- Cashier shift lifecycle, cash-drawer event log, and durable POS transaction history.
-- Apply after 0007_goods_receipt_posting_fix.sql.
BEGIN;

CREATE TABLE gcims.cashier_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    cashier_user_id UUID NOT NULL REFERENCES gcims.users(id) ON DELETE RESTRICT,
    status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_cash_amount BIGINT NOT NULL CHECK (opening_cash_amount >= 0),
    closed_at TIMESTAMPTZ,
    closing_cash_amount BIGINT CHECK (closing_cash_amount IS NULL OR closing_cash_amount >= 0),
    expected_cash_amount BIGINT CHECK (expected_cash_amount IS NULL OR expected_cash_amount >= 0),
    variance_amount BIGINT,
    closing_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_cashier_shift_outlet FOREIGN KEY (company_id, outlet_id)
        REFERENCES gcims.outlets(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_cashier_shift_company_id UNIQUE (company_id, id),
    CONSTRAINT ck_cashier_shift_close_fields CHECK (
      (status = 'open' AND closed_at IS NULL AND closing_cash_amount IS NULL
        AND expected_cash_amount IS NULL AND variance_amount IS NULL)
      OR (status = 'closed' AND closed_at IS NOT NULL AND closing_cash_amount IS NOT NULL
        AND expected_cash_amount IS NOT NULL AND variance_amount = closing_cash_amount - expected_cash_amount)
    )
);
CREATE UNIQUE INDEX uq_cashier_shift_one_open_per_user
    ON gcims.cashier_shifts (company_id, outlet_id, cashier_user_id) WHERE status = 'open';
CREATE INDEX ix_cashier_shifts_history
    ON gcims.cashier_shifts (company_id, outlet_id, cashier_user_id, opened_at DESC);

ALTER TABLE gcims.sales_orders
    ADD COLUMN cashier_shift_id UUID;
ALTER TABLE gcims.sales_orders
    ADD CONSTRAINT fk_sales_order_cashier_shift
    FOREIGN KEY (company_id, cashier_shift_id)
    REFERENCES gcims.cashier_shifts(company_id, id) ON DELETE RESTRICT;
CREATE INDEX ix_sales_orders_cashier_shift
    ON gcims.sales_orders (company_id, cashier_shift_id, placed_at DESC)
    WHERE cashier_shift_id IS NOT NULL;

CREATE TABLE gcims.cash_drawer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    cashier_shift_id UUID NOT NULL,
    actor_user_id UUID NOT NULL REFERENCES gcims.users(id) ON DELETE RESTRICT,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('no_sale_open', 'cash_in', 'cash_out')),
    amount BIGINT NOT NULL DEFAULT 0 CHECK (amount >= 0),
    reason TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_cash_drawer_event_shift FOREIGN KEY (company_id, cashier_shift_id)
        REFERENCES gcims.cashier_shifts(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_cash_drawer_event_outlet FOREIGN KEY (company_id, outlet_id)
        REFERENCES gcims.outlets(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_cash_drawer_event_amount CHECK (
      (event_type = 'no_sale_open' AND amount = 0) OR
      (event_type IN ('cash_in', 'cash_out') AND amount > 0)
    )
);
CREATE INDEX ix_cash_drawer_events_shift_time
    ON gcims.cash_drawer_events (company_id, cashier_shift_id, occurred_at DESC);
CREATE TRIGGER trg_cash_drawer_events_append_only
    BEFORE UPDATE OR DELETE ON gcims.cash_drawer_events
    FOR EACH ROW EXECUTE FUNCTION gcims.reject_update_delete();

INSERT INTO gcims.permissions (code, module, description) VALUES
  ('pos.shift.read', 'pos', 'Melihat status dan ringkasan shift kasir'),
  ('pos.shift.write', 'pos', 'Membuka dan menutup shift kasir'),
  ('pos.cash_drawer.write', 'pos', 'Mencatat aktivitas laci kas')
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description;

INSERT INTO gcims.role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, new_permission.id
  FROM gcims.role_permissions rp
  JOIN gcims.permissions existing_permission ON existing_permission.id=rp.permission_id
  CROSS JOIN gcims.permissions new_permission
 WHERE existing_permission.code IN ('pos.order.create','pos.payment.create')
   AND new_permission.code IN ('pos.shift.read','pos.shift.write','pos.cash_drawer.write')
ON CONFLICT DO NOTHING;

COMMIT;

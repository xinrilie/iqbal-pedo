-- GCIMS Sesi 2 — additive migration: KDS, outbox, payment webhook inbox.
-- Jalankan HANYA pada db_gcims_test terlebih dahulu. Backup sebelum staging/production.
-- Tidak mengubah isi transaksi Sesi 1; menambah 5 tabel, kolom versi/hash, index dan satu FK defensif.

BEGIN;
SET search_path = gcims, public;

-- Versi draft mencegah dua kasir/perangkat menimpa keranjang secara diam-diam.
ALTER TABLE gcims.sales_orders
    ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gcims.sales_orders
    ADD COLUMN IF NOT EXISTS idempotency_request_hash CHAR(64);
ALTER TABLE gcims.payments
    ADD COLUMN IF NOT EXISTS idempotency_request_hash CHAR(64);

-- Kunci unik komposit agar company + outlet + order pada tiket tidak dapat tertukar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_order_company_outlet_id
    ON gcims.sales_orders (company_id, outlet_id, id);

CREATE TABLE IF NOT EXISTS gcims.kitchen_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    order_id UUID NOT NULL,
    ticket_number VARCHAR(60) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'in_preparation', 'ready', 'served', 'cancelled')),
    priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority >= 0),
    station_code VARCHAR(40),
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    served_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_kitchen_ticket_order
        FOREIGN KEY (company_id, outlet_id, order_id)
        REFERENCES gcims.sales_orders(company_id, outlet_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_kitchen_ticket_outlet
        FOREIGN KEY (company_id, outlet_id)
        REFERENCES gcims.outlets(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_kitchen_ticket_number UNIQUE (outlet_id, ticket_number),
    CONSTRAINT uq_kitchen_ticket_company_id UNIQUE (company_id, id),
    CONSTRAINT uq_kitchen_ticket_company_outlet_id UNIQUE (company_id, outlet_id, id),
    CONSTRAINT uq_kitchen_ticket_order UNIQUE (company_id, order_id)
);
CREATE INDEX IF NOT EXISTS ix_kitchen_tickets_queue
    ON gcims.kitchen_tickets (company_id, outlet_id, status, priority, queued_at);

CREATE TABLE IF NOT EXISTS gcims.kitchen_ticket_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    kitchen_ticket_id UUID NOT NULL,
    order_id UUID NOT NULL,
    sales_order_item_id UUID NOT NULL,
    line_no SMALLINT NOT NULL CHECK (line_no > 0),
    menu_name_snapshot VARCHAR(160) NOT NULL,
    variant_name_snapshot VARCHAR(100) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    item_note TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'in_preparation', 'ready', 'served', 'cancelled')),
    started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    served_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_kitchen_item_ticket
        FOREIGN KEY (company_id, kitchen_ticket_id)
        REFERENCES gcims.kitchen_tickets(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_kitchen_item_order_line
        FOREIGN KEY (company_id, order_id, sales_order_item_id)
        REFERENCES gcims.sales_order_items(company_id, order_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_kitchen_item_line UNIQUE (kitchen_ticket_id, line_no),
    CONSTRAINT uq_kitchen_item_order_line UNIQUE (kitchen_ticket_id, sales_order_item_id),
    CONSTRAINT uq_kitchen_item_company_ticket_id UNIQUE (company_id, kitchen_ticket_id, id)
);
CREATE INDEX IF NOT EXISTS ix_kitchen_ticket_items_status
    ON gcims.kitchen_ticket_items (kitchen_ticket_id, status, line_no);

CREATE TABLE IF NOT EXISTS gcims.kitchen_ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    outlet_id UUID NOT NULL,
    kitchen_ticket_id UUID NOT NULL,
    kitchen_ticket_item_id UUID,
    event_type VARCHAR(60) NOT NULL,
    from_status VARCHAR(24),
    to_status VARCHAR(24),
    actor_user_id UUID REFERENCES gcims.users(id) ON DELETE RESTRICT,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_kitchen_event_ticket
        FOREIGN KEY (company_id, outlet_id, kitchen_ticket_id)
        REFERENCES gcims.kitchen_tickets(company_id, outlet_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_kitchen_event_item
        FOREIGN KEY (company_id, kitchen_ticket_id, kitchen_ticket_item_id)
        REFERENCES gcims.kitchen_ticket_items(company_id, kitchen_ticket_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_kitchen_event_outlet
        FOREIGN KEY (company_id, outlet_id)
        REFERENCES gcims.outlets(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ix_kitchen_ticket_events_time
    ON gcims.kitchen_ticket_events (kitchen_ticket_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS gcims.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES gcims.companies(id) ON DELETE RESTRICT,
    outlet_id UUID,
    aggregate_type VARCHAR(60) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    dedupe_key VARCHAR(180) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'published', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(120),
    published_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_outbox_outlet
        FOREIGN KEY (company_id, outlet_id)
        REFERENCES gcims.outlets(company_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_outbox_dedupe UNIQUE (company_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS ix_outbox_pending
    ON gcims.outbox_events (available_at, created_at)
    WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS gcims.payment_webhook_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_code VARCHAR(60) NOT NULL,
    provider_event_id VARCHAR(180) NOT NULL,
    provider_reference VARCHAR(160),
    event_type VARCHAR(80) NOT NULL,
    signature_valid BOOLEAN NOT NULL,
    sanitized_payload JSONB NOT NULL,
    matched_payment_id UUID REFERENCES gcims.payments(id) ON DELETE RESTRICT,
    processing_status VARCHAR(24) NOT NULL DEFAULT 'received'
        CHECK (processing_status IN ('received', 'processing', 'processed', 'duplicate', 'reconciliation_required', 'rejected')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    processing_error TEXT,
    CONSTRAINT uq_payment_webhook_event UNIQUE (provider_code, provider_event_id)
);
CREATE INDEX IF NOT EXISTS ix_payment_webhook_pending
    ON gcims.payment_webhook_inbox (received_at)
    WHERE processing_status IN ('received', 'reconciliation_required');

-- payment_events di DDL Sesi 1 sebelumnya belum memiliki FK ke payments.
-- Tambahkan FK bila belum ada; bila orphan ditemukan, hentikan migrasi agar diperiksa.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'gcims.payment_events'::regclass
          AND conname = 'fk_payment_events_payment'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM gcims.payment_events pe
            LEFT JOIN gcims.payments p ON p.id = pe.payment_id
            WHERE p.id IS NULL
        ) THEN
            RAISE EXCEPTION 'Cannot add fk_payment_events_payment: orphan payment_events rows exist';
        END IF;
        ALTER TABLE gcims.payment_events
            ADD CONSTRAINT fk_payment_events_payment
            FOREIGN KEY (payment_id) REFERENCES gcims.payments(id) ON DELETE RESTRICT;
    END IF;
END $$;

COMMIT;

-- Catatan implementasi:
-- 1) `version_no` naik saat PUT cart sukses; request hash dibuat service dari payload canonical.
-- 2) Isi kitchen ticket + outbox harus dibuat dalam transaksi yang sama dengan konfirmasi order.
-- 3) Worker outbox memakai SELECT ... FOR UPDATE SKIP LOCKED dan lease agar aman diulang.
-- 4) Perubahan status ticket/item harus divalidasi service dan ditulis ke kitchen_ticket_events + audit_logs.
-- 5) Webhook inbox menyimpan payload yang sudah disanitasi; jangan simpan secret/PAN/CVV/token.
-- 6) Stock reservation/consume belum diimplementasikan oleh migrasi ini; itu Sesi 3.

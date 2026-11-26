BEGIN;

CREATE INDEX IF NOT EXISTS ix_kitchen_tickets_fifo
    ON gcims.kitchen_tickets (company_id, outlet_id, priority, queued_at, id);

COMMIT;

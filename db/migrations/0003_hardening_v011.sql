-- GCIMS v0.1.1: deterministic KDS FIFO access path.
-- Apply after db/migrations/0002_migration_sesi2.sql. This migration is additive and safe to rerun.
BEGIN;
CREATE INDEX IF NOT EXISTS ix_kitchen_tickets_fifo
    ON gcims.kitchen_tickets (company_id, outlet_id, priority, queued_at, id);
COMMIT;

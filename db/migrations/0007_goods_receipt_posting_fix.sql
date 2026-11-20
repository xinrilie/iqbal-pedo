-- Permit the posting transaction to attach a newly resolved inventory lot to
-- an approved receipt line, while keeping all other post-approval edits locked.
-- Apply after db/migrations/0006_maker_checker_hardening.sql.
BEGIN;

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
$$;

COMMIT;

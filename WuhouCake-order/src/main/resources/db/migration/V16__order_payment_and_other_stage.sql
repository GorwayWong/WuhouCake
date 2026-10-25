ALTER TABLE cake_order ADD COLUMN paid_at TIMESTAMPTZ;
CREATE INDEX idx_order_paid_at ON cake_order(paid_at) WHERE payment_status = 'PAID';
ALTER TABLE cake_order DROP CONSTRAINT cake_order_current_stage_code_check;
ALTER TABLE cake_order ADD CONSTRAINT cake_order_current_stage_code_check
    CHECK (current_stage_code IN ('LAYER_DONE', 'FROSTING_DONE', 'OTHER_DONE'));

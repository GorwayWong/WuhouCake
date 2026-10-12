ALTER TABLE cake_order ADD COLUMN current_stage_code VARCHAR(64)
    CHECK (current_stage_code IN ('LAYER_DONE', 'FROSTING_DONE'));

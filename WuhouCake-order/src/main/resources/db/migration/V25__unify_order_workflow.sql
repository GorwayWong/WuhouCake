UPDATE cake_order
SET status = CASE
        WHEN status = 'WAITING_PRODUCTION' THEN 'CAKE_BASE'
        WHEN status = 'PROCESSING' THEN CASE current_stage_code
            WHEN 'LAYER_DONE' THEN 'FROSTING'
            WHEN 'FROSTING_DONE' THEN 'DECORATING'
            WHEN 'OTHER_DONE' THEN 'DECORATING'
            ELSE 'CAKE_BASE'
        END
        WHEN status IN ('WAITING_PICKUP', 'DELIVERING') THEN 'WAITING_DELIVERY'
        ELSE status
    END,
    current_stage_code = NULL
WHERE status IN ('WAITING_PRODUCTION', 'PROCESSING', 'WAITING_PICKUP', 'DELIVERING')
   OR current_stage_code IS NOT NULL;

ALTER TABLE cake_order DROP CONSTRAINT cake_order_current_stage_code_check;
ALTER TABLE cake_order ADD CONSTRAINT cake_order_current_stage_code_check CHECK (current_stage_code IS NULL);
ALTER TABLE cake_order ADD CONSTRAINT cake_order_status_check
    CHECK (status IN ('CAKE_BASE', 'LAYER', 'FROSTING', 'DECORATING', 'WAITING_DELIVERY', 'COMPLETED', 'CANCELLED'));

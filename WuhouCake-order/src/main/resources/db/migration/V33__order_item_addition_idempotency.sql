ALTER TABLE cake_order_activity
    ADD COLUMN item_add_request_id uuid,
    ADD COLUMN item_add_fingerprint char(64),
    ADD CONSTRAINT cake_order_item_addition_receipt CHECK (
        (item_add_request_id IS NULL AND item_add_fingerprint IS NULL)
        OR (type = 'ITEM_ADDED' AND item_add_request_id IS NOT NULL AND item_add_fingerprint IS NOT NULL)
    );

CREATE UNIQUE INDEX cake_order_item_addition_request_key
    ON cake_order_activity (order_id, actor_id, item_add_request_id)
    WHERE item_add_request_id IS NOT NULL;

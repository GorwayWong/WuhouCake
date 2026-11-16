CREATE TABLE cake_order_image_upload (
    order_id UUID NOT NULL REFERENCES cake_order(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    image_id UUID NOT NULL REFERENCES cake_order_image(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (order_id, request_id)
);
CREATE INDEX cake_order_image_active_item_idx ON cake_order_image (order_id, item_id) WHERE NOT is_removed;

ALTER TABLE cake_order_item ADD CONSTRAINT uq_order_item_owner UNIQUE (order_id, id);

CREATE TABLE cake_order_image (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES cake_order(id),
    item_id UUID,
    content_type VARCHAR(16) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    filename VARCHAR(255) NOT NULL,
    content BYTEA NOT NULL,
    size BIGINT NOT NULL CHECK (size > 0 AND size <= 5242880 AND size = octet_length(content)),
    width INTEGER NOT NULL CHECK (width > 0 AND width <= 8192),
    height INTEGER NOT NULL CHECK (height > 0 AND height <= 8192),
    uploaded_by UUID NOT NULL,
    uploader_name_snapshot VARCHAR(100) NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (order_id, item_id) REFERENCES cake_order_item(order_id, id),
    CHECK (width::bigint * height <= 24000000)
);
CREATE INDEX idx_order_image_order_time ON cake_order_image(order_id, uploaded_at, id);

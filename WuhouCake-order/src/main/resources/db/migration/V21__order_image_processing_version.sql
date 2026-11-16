ALTER TABLE cake_order_image ADD COLUMN processing_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX cake_order_image_unprocessed_idx ON cake_order_image(id) WHERE processing_version=0;

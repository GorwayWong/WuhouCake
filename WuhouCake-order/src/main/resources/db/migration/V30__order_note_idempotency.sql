ALTER TABLE cake_order_activity ADD COLUMN note_request_id uuid;
CREATE UNIQUE INDEX cake_order_note_request_key ON cake_order_activity (order_id, actor_id, note_request_id)
    WHERE note_request_id IS NOT NULL;

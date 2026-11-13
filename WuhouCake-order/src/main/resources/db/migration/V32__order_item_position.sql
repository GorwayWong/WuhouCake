ALTER TABLE cake_order_item ADD COLUMN position integer;

WITH ranked_items AS (
    SELECT id, row_number() OVER (PARTITION BY order_id ORDER BY created_at, id)::integer AS position
    FROM cake_order_item
)
UPDATE cake_order_item i
SET position = ranked_items.position
FROM ranked_items
WHERE i.id = ranked_items.id;

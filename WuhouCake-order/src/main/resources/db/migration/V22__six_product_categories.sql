UPDATE cake_order_item
SET product_type = CASE product_type WHEN 'BREAD' THEN 'READY_BAKERY' ELSE 'TEA_BREAK' END
WHERE product_type IN ('BREAD', 'DONUT', 'CUPCAKE', 'OTHER');

UPDATE cake_order_package p
SET items = (SELECT jsonb_agg(
    CASE WHEN item->>'productType' IN ('BREAD', 'DONUT', 'CUPCAKE', 'OTHER')
         THEN jsonb_set(item, '{productType}', to_jsonb(CASE WHEN item->>'productType' = 'BREAD' THEN 'READY_BAKERY' ELSE 'TEA_BREAK' END))
         ELSE item END ORDER BY position)
    FROM jsonb_array_elements(p.items) WITH ORDINALITY AS entries(item, position))
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) item WHERE item->>'productType' IN ('BREAD', 'DONUT', 'CUPCAKE', 'OTHER'));

UPDATE customer_order_submission s
SET reviewed = jsonb_set(reviewed, '{content,items}',
    (SELECT jsonb_agg(
        CASE WHEN item->>'productType' IN ('BREAD', 'DONUT', 'CUPCAKE', 'OTHER')
             THEN jsonb_set(item, '{productType}', to_jsonb(CASE WHEN item->>'productType' = 'BREAD' THEN 'READY_BAKERY' ELSE 'TEA_BREAK' END))
             ELSE item END ORDER BY position)
        FROM jsonb_array_elements(s.reviewed->'content'->'items') WITH ORDINALITY AS entries(item, position)))
WHERE status = 'PENDING' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(s.reviewed->'content'->'items') item
    WHERE item->>'productType' IN ('BREAD', 'DONUT', 'CUPCAKE', 'OTHER'));

-- Preserve reviewed item order so existing positional prices stay attached during migration.
UPDATE customer_order_submission AS submission
SET reviewed = jsonb_set(submission.reviewed, '{content,items}', (
    SELECT jsonb_agg(
        CASE WHEN item->>'itemId' IS NULL
            THEN item || jsonb_build_object('itemId', gen_random_uuid())
            ELSE item END
        ORDER BY position)
    FROM jsonb_array_elements(submission.reviewed #> '{content,items}') WITH ORDINALITY AS entry(item, position)
))
WHERE submission.status = 'PENDING'
    AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(submission.reviewed #> '{content,items}') AS entry(item)
        WHERE item->>'itemId' IS NULL
    );

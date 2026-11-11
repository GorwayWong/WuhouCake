ALTER TABLE cake_order_package
    ADD COLUMN original_amount_cents BIGINT CHECK (original_amount_cents BETWEEN 0 AND 9007199254740991),
    ADD COLUMN member_amount_cents BIGINT CHECK (member_amount_cents BETWEEN 0 AND 9007199254740991);

CREATE TABLE cake_order_package_image (
    package_id UUID NOT NULL REFERENCES cake_order_package(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    image_id UUID NOT NULL,
    filename TEXT NOT NULL,
    content_type VARCHAR(32) NOT NULL,
    content BYTEA NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    PRIMARY KEY (package_id, item_id, image_id)
);

-- Keep financial columns for historical, permission-gated reference.
CREATE FUNCTION wuhou_other_spec(attributes jsonb) RETURNS jsonb LANGUAGE SQL IMMUTABLE AS $$
    SELECT CASE WHEN specification IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('specification', specification) END
    FROM (
        SELECT string_agg(line, E'\n' ORDER BY first_key) AS specification
        FROM (
            SELECT line, min(sort_key) AS first_key FROM (
                SELECT CASE WHEN key = 'specification' THEN '' ELSE key END AS sort_key,
                    CASE WHEN key = 'specification' THEN '' ELSE
                        CASE key WHEN 'size' THEN '尺寸' WHEN 'base' THEN '内胚' WHEN 'cakeBase' THEN '内胚'
                            WHEN 'flavor' THEN '奶油' WHEN 'filling' THEN '夹馅' WHEN 'message' THEN '祝福语'
                            WHEN 'greeting' THEN '祝福语' WHEN 'requirements' THEN '特殊要求'
                            WHEN 'otherRequirements' THEN '特殊要求' ELSE key END || '：' END
                    || regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g') AS line
                FROM jsonb_each_text(COALESCE(NULLIF(attributes, 'null'::jsonb), '{}'::jsonb))
                WHERE value IS NOT NULL AND value !~ '^[[:space:]]*$'
            ) lines GROUP BY line
        ) unique_lines
    ) combined;
$$;

UPDATE cake_order_item
SET product_type = 'OTHER', attributes = wuhou_other_spec(attributes)
WHERE upper(btrim(product_type)) <> 'CAKE';

UPDATE cake_order_package p
SET items = (SELECT jsonb_agg(
    item || jsonb_build_object('itemId', COALESCE(item->>'itemId', gen_random_uuid()::text),
        'productType', 'OTHER', 'attributes', wuhou_other_spec(item->'attributes')) ORDER BY position)
    FROM jsonb_array_elements(p.items) WITH ORDINALITY AS entries(item, position));

CREATE FUNCTION wuhou_two_category_items(items jsonb) RETURNS jsonb LANGUAGE SQL IMMUTABLE AS $$
    SELECT COALESCE(jsonb_agg(
        CASE WHEN upper(btrim(item->>'productType')) = 'CAKE' THEN item
        ELSE item || jsonb_build_object('productType', 'OTHER', 'attributes', wuhou_other_spec(item->'attributes')) END
        ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(items) WITH ORDINALITY AS entries(item, position);
$$;

UPDATE customer_order_submission
SET original = jsonb_set(original, '{items}', wuhou_two_category_items(original->'items')),
    reviewed = CASE WHEN reviewed IS NULL THEN NULL ELSE
        jsonb_set(reviewed, '{content,items}', wuhou_two_category_items(reviewed->'content'->'items')) END
WHERE status = 'PENDING';

DROP FUNCTION wuhou_two_category_items(jsonb);
DROP FUNCTION wuhou_other_spec(jsonb);

WITH split AS (
    SELECT i.id, line, position, regexp_match(line, '^(原商品单价|原会员单价)：(.+) 元（仅供参考）$') AS quote
    FROM cake_order_item i
    CROSS JOIN LATERAL regexp_split_to_table(i.attributes->>'specification', E'\\r?\\n') WITH ORDINALITY AS lines(line, position)
    WHERE i.attributes->>'specification' LIKE '% 元（仅供参考）%'
), parsed AS (
    SELECT *,
        CASE WHEN quote[2] ~ '^[0-9]{1,16}([.][0-9]{1,2})?$' THEN quote[2]::numeric * 100 END AS cents
    FROM split
), cleaned AS (
    SELECT id, string_agg(line, E'\n' ORDER BY position) FILTER (WHERE quote IS NULL) AS specification,
        (array_agg(cents::bigint ORDER BY position) FILTER (WHERE quote[1] = '原商品单价' AND cents BETWEEN 0 AND 9007199254740991))[1] AS unit,
        (array_agg(cents::bigint ORDER BY position) FILTER (WHERE quote[1] = '原会员单价' AND cents BETWEEN 0 AND 9007199254740991))[1] AS member
    FROM parsed GROUP BY id HAVING bool_or(quote IS NOT NULL)
)
UPDATE cake_order_item i
SET attributes = CASE WHEN cleaned.specification IS NULL OR btrim(cleaned.specification) = ''
        THEN i.attributes - 'specification'
        ELSE jsonb_set(i.attributes, '{specification}', to_jsonb(cleaned.specification)) END,
    unit_price_cents = COALESCE(i.unit_price_cents, cleaned.unit),
    member_price_cents = COALESCE(i.member_price_cents, cleaned.member)
FROM cleaned WHERE i.id = cleaned.id;

CREATE OR REPLACE FUNCTION cake_size_inches(attributes jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN value > 0 AND value = round(value, 2) THEN trim_scale(value) ELSE NULL END
    FROM (SELECT CASE WHEN btrim(attributes->>'size') ~ '^[0-9]{1,9}(\.[0-9]{1,6})? *(英寸|寸)?$'
        THEN regexp_replace(btrim(attributes->>'size'), ' *(英寸|寸)$', '')::numeric ELSE NULL END AS value) parsed
$$;

CREATE INDEX cake_order_created_at_idx ON cake_order(created_at);

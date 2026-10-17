ALTER TABLE cake_order ADD COLUMN credited_employee_id uuid REFERENCES identity_account(id);
ALTER TABLE cake_order ADD COLUMN credited_employee_number varchar(32);
ALTER TABLE cake_order ADD COLUMN credited_employee_name varchar(100);
ALTER TABLE cake_order ADD CONSTRAINT cake_order_employee_snapshot CHECK (
    (credited_employee_id IS NULL AND credited_employee_number IS NULL AND credited_employee_name IS NULL)
    OR (credited_employee_id IS NOT NULL AND credited_employee_number IS NOT NULL AND credited_employee_name IS NOT NULL));
CREATE INDEX cake_order_employee_date_idx ON cake_order(credited_employee_id, requested_receive_date);

CREATE FUNCTION cake_size_inches(attributes jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN btrim(attributes->>'size') ~ '^[0-9]{1,9}(\.[0-9]{1,6})? *(英寸|寸)?$'
        THEN NULLIF(regexp_replace(btrim(attributes->>'size'), ' *(英寸|寸)$', '')::numeric, 0) ELSE NULL END
$$;

ALTER TABLE customer_order_submission
    ADD COLUMN fingerprint_version SMALLINT NOT NULL DEFAULT 1 CHECK (fingerprint_version IN (1, 2));

-- V37 introduced exact size text in the submission fingerprint.
UPDATE customer_order_submission
SET fingerprint_version = 2
WHERE created_at >= (
    SELECT installed_on AT TIME ZONE current_setting('TimeZone')
    FROM flyway_schema_history WHERE version = '37' AND success
);

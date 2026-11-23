DO $repair$
DECLARE
    configured_cutover text := NULLIF(current_setting('wuhou.submission_v37_cutover', true), '');
    source_timezone text := NULLIF(current_setting('wuhou.submission_v37_source_timezone', true), '');
    cutover timestamptz;
    expected_cutover timestamptz;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM customer_order_submission) THEN
        RETURN;
    END IF;

    IF configured_cutover IS NULL
        OR configured_cutover !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RAISE EXCEPTION 'V39 requires wuhou.submission_v37_cutover with the verified V37 timestamp and explicit UTC offset';
    END IF;
    BEGIN
        cutover := configured_cutover::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN
        RAISE EXCEPTION 'V39 could not parse wuhou.submission_v37_cutover as a timestamp with an explicit UTC offset';
    END;
    IF cutover > statement_timestamp() THEN
        RAISE EXCEPTION 'V39 requires wuhou.submission_v37_cutover to be a historical timestamp';
    END IF;

    IF source_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = source_timezone) THEN
        RAISE EXCEPTION 'V39 requires wuhou.submission_v37_source_timezone with the original V37 session time zone';
    END IF;
    SELECT installed_on AT TIME ZONE source_timezone INTO expected_cutover
    FROM flyway_schema_history WHERE version = '37' AND success;
    IF expected_cutover IS NULL OR cutover IS DISTINCT FROM expected_cutover THEN
        RAISE EXCEPTION 'V39 wuhou.submission_v37_cutover does not match the V37 Flyway record in the configured source time zone';
    END IF;

    UPDATE customer_order_submission
    SET fingerprint_version = CASE WHEN created_at < cutover THEN 1 ELSE 2 END
    WHERE fingerprint_version <> CASE WHEN created_at < cutover THEN 1 ELSE 2 END;
END;
$repair$;

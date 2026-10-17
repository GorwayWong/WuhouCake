ALTER TABLE audit_operation ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE audit_operation ADD CONSTRAINT audit_details_object CHECK (jsonb_typeof(details)='object');

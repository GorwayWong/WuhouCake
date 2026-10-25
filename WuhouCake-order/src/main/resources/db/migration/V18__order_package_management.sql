DO $$
BEGIN
    IF EXISTS (SELECT btrim(name) FROM cake_order_package GROUP BY btrim(name) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate order package names prevent enabling package management'
            USING HINT = 'Ask the store manager to confirm distinct names, then rename the duplicates before retrying this migration.';
    END IF;
END $$;

ALTER TABLE cake_order_package
    ADD COLUMN version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    ADD COLUMN updated_at timestamptz,
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN creation_key uuid UNIQUE;
UPDATE cake_order_package SET name=btrim(name), updated_at=created_at;
ALTER TABLE cake_order_package ALTER COLUMN updated_at SET NOT NULL;
CREATE UNIQUE INDEX cake_order_package_active_name ON cake_order_package(name) WHERE deleted_at IS NULL;
CREATE INDEX cake_order_package_updated ON cake_order_package(updated_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE cake_order_package_change (
    id uuid PRIMARY KEY,
    package_id uuid NOT NULL REFERENCES cake_order_package(id),
    actor_id uuid NOT NULL,
    occurred_at timestamptz NOT NULL,
    before_content jsonb,
    after_content jsonb NOT NULL
);
CREATE INDEX cake_order_package_change_history ON cake_order_package_change(package_id, occurred_at, id);

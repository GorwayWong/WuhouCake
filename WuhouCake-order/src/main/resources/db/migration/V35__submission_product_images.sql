CREATE TABLE customer_submission_image (
    id UUID PRIMARY KEY,
    item_id UUID NOT NULL,
    entry_id UUID REFERENCES customer_order_entry(id),
    submission_id UUID REFERENCES customer_order_submission(id),
    expires_at TIMESTAMPTZ,
    filename TEXT NOT NULL,
    content_type VARCHAR(16) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    content BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
    fingerprint VARCHAR(64) NOT NULL,
    CHECK (entry_id IS NOT NULL OR submission_id IS NOT NULL),
    CHECK (expires_at IS NOT NULL OR submission_id IS NOT NULL)
);

CREATE INDEX customer_submission_image_expiry ON customer_submission_image (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX customer_submission_image_entry ON customer_submission_image (entry_id, item_id) WHERE submission_id IS NULL;
CREATE INDEX customer_submission_image_submission ON customer_submission_image (submission_id);

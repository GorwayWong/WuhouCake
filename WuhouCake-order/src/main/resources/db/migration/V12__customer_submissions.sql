CREATE TABLE customer_order_entry (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL UNIQUE,
    owner_name VARCHAR(100) NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL
);
CREATE TABLE customer_order_submission (
    id UUID PRIMARY KEY,
    entry_id UUID NOT NULL REFERENCES customer_order_entry(id),
    owner_id UUID NOT NULL,
    owner_name VARCHAR(100) NOT NULL,
    request_id UUID NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    original JSONB NOT NULL,
    reviewed JSONB,
    original_phone VARCHAR(32) NOT NULL,
    requested_date DATE NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL CHECK (status IN ('PENDING','CONFIRMED','DELETED')),
    order_id UUID UNIQUE REFERENCES cake_order(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE(entry_id, request_id),
    CHECK ((status = 'CONFIRMED') = (order_id IS NOT NULL))
);
CREATE INDEX idx_customer_submission_pending ON customer_order_submission(status, created_at DESC, id DESC);
CREATE INDEX idx_customer_submission_duplicates ON customer_order_submission(original_phone, requested_date, created_at DESC, id DESC) WHERE status='PENDING';
CREATE TABLE customer_submission_activity (
    id BIGSERIAL PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES customer_order_submission(id),
    type VARCHAR(32) NOT NULL,
    actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('CUSTOMER','EMPLOYEE')),
    actor_id UUID,
    actor_name VARCHAR(100) NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CHECK ((actor_type='CUSTOMER' AND actor_id IS NULL) OR (actor_type='EMPLOYEE' AND actor_id IS NOT NULL))
);
CREATE INDEX idx_submission_activity ON customer_submission_activity(submission_id, id DESC);
ALTER TABLE cake_order ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'STAFF_ENTERED';
ALTER TABLE cake_order ADD COLUMN source_submission_id UUID UNIQUE REFERENCES customer_order_submission(id);

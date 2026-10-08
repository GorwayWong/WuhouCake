CREATE TABLE audit_operation (
    id UUID PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    action VARCHAR(80) NOT NULL,
    result VARCHAR(10) NOT NULL CHECK (result IN ('SUCCESS', 'FAILURE')),
    actor_id UUID,
    actor_employee_number VARCHAR(32),
    actor_nickname VARCHAR(160),
    target_id VARCHAR(128),
    request_id VARCHAR(64)
);
CREATE INDEX audit_operation_time_idx ON audit_operation(occurred_at DESC, id DESC);
CREATE INDEX audit_operation_actor_idx ON audit_operation(actor_id, occurred_at DESC);

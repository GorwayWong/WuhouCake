CREATE TABLE identity_account (
    id UUID PRIMARY KEY,
    employee_number VARCHAR(32) NOT NULL UNIQUE CHECK (employee_number ~ '^[A-Z0-9_-]{1,32}$'),
    nickname VARCHAR(160) NOT NULL,
    system_role VARCHAR(20) NOT NULL CHECK (system_role IN ('STAFF', 'SUPER_ADMIN')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    password_hash VARCHAR(255) NOT NULL,
    password_change_required BOOLEAN NOT NULL,
    credential_version BIGINT NOT NULL DEFAULT 0 CHECK (credential_version >= 0),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ,
    archived_by UUID REFERENCES identity_account(id),
    CHECK ((status = 'ACTIVE' AND archived_at IS NULL) OR (status = 'ARCHIVED' AND archived_at IS NOT NULL))
);
CREATE TABLE identity_account_role (
    account_id UUID NOT NULL REFERENCES identity_account(id),
    role VARCHAR(20) NOT NULL CHECK (role IN ('MANAGER', 'FRONT_DESK', 'PASTRY_CHEF')),
    PRIMARY KEY (account_id, role)
);
CREATE INDEX identity_account_status_idx ON identity_account(status, system_role);

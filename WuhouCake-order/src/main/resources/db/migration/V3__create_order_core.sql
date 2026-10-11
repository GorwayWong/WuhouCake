CREATE SEQUENCE cake_order_no_seq START WITH 1;

CREATE TABLE cake_order (
    id UUID PRIMARY KEY,
    order_no VARCHAR(32) NOT NULL UNIQUE,
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    status VARCHAR(32) NOT NULL,
    payment_status VARCHAR(16) NOT NULL DEFAULT 'UNPAID',
    customer_name VARCHAR(80),
    customer_phone VARCHAR(32) NOT NULL,
    member_phone VARCHAR(32),
    buyer_name VARCHAR(80),
    fulfillment_type VARCHAR(16) NOT NULL,
    delivery_address TEXT,
    requested_receive_date DATE NOT NULL,
    planned_handoff_at TIMESTAMPTZ NOT NULL,
    planned_finish_at TIMESTAMPTZ,
    total_amount_cents BIGINT CHECK (total_amount_cents >= 0),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP')),
    CHECK (fulfillment_type <> 'DELIVERY' OR NULLIF(BTRIM(delivery_address), '') IS NOT NULL)
);

CREATE TABLE cake_order_item (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES cake_order(id),
    name VARCHAR(128) NOT NULL,
    product_type VARCHAR(32) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents BIGINT CHECK (unit_price_cents >= 0),
    member_price_cents BIGINT CHECK (member_price_cents >= 0),
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
    production_status VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
    current_stage_code VARCHAR(64),
    is_removed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE cake_order_activity (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES cake_order(id),
    item_id UUID,
    type VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    actor_id UUID NOT NULL,
    actor_name_snapshot VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_order_item_order ON cake_order_item(order_id, created_at, id);
CREATE INDEX idx_order_activity_order_time ON cake_order_activity(order_id, created_at DESC, id DESC);
CREATE INDEX idx_order_activity_item_notes ON cake_order_activity(order_id, item_id, type, created_at DESC, id DESC);

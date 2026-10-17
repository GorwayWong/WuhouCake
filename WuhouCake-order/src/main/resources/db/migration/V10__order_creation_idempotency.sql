CREATE TABLE cake_order_creation (
    actor_id uuid NOT NULL REFERENCES identity_account(id),
    request_id uuid NOT NULL,
    fingerprint varchar(64) NOT NULL,
    order_id uuid REFERENCES cake_order(id),
    PRIMARY KEY (actor_id, request_id)
);

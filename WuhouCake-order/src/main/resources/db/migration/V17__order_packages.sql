CREATE TABLE cake_order_package (
    id uuid PRIMARY KEY,
    name varchar(80) NOT NULL,
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

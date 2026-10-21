CREATE INDEX idx_submission_duplicate_current_phone ON customer_order_submission
    (regexp_replace(COALESCE(reviewed->'content',original)->>'phone','[ ()-]','','g'))
    WHERE status='PENDING';

CREATE INDEX idx_order_duplicate_phone_date ON cake_order
    (regexp_replace(customer_phone,'[ ()-]','','g'),requested_receive_date);

ALTER TABLE cake_order
    ADD COLUMN original_amount_cents BIGINT,
    ADD COLUMN member_amount_cents BIGINT,
    ADD COLUMN payment_method VARCHAR(24);

ALTER TABLE cake_order
    ADD CONSTRAINT cake_order_original_amount_check CHECK (original_amount_cents BETWEEN 0 AND 9007199254740991),
    ADD CONSTRAINT cake_order_member_amount_check CHECK (member_amount_cents BETWEEN 0 AND 9007199254740991),
    ADD CONSTRAINT cake_order_effective_amount_check CHECK (
        (original_amount_cents IS NULL AND member_amount_cents IS NULL)
        OR total_amount_cents IS NOT DISTINCT FROM COALESCE(member_amount_cents, original_amount_cents)),
    ADD CONSTRAINT cake_order_payment_method_check CHECK (
        payment_method IS NULL
        OR payment_method = 'UNPAID' AND payment_status = 'UNPAID'
        OR payment_method IN ('UNIONPAY', 'MEMBER_CARD', 'BANK_TRANSFER', 'SERVICE_WECHAT', 'CASH') AND payment_status = 'PAID');

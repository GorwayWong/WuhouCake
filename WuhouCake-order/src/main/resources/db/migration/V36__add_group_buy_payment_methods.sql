ALTER TABLE cake_order DROP CONSTRAINT cake_order_payment_method_check;

ALTER TABLE cake_order ADD CONSTRAINT cake_order_payment_method_check CHECK (
    payment_method IS NULL
    OR payment_method = 'UNPAID' AND payment_status = 'UNPAID'
    OR payment_method IN ('UNIONPAY', 'MEMBER_CARD', 'BANK_TRANSFER', 'SERVICE_WECHAT', 'CASH',
        'DOUYIN_GROUP_BUY', 'MEITUAN_GROUP_BUY') AND payment_status = 'PAID'
);

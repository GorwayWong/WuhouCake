ALTER TABLE cake_order
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID,
    ADD COLUMN deleted_by_name VARCHAR(160),
    ADD COLUMN deletion_reason VARCHAR(1000),
    ADD CONSTRAINT cake_order_deletion_complete CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL AND deleted_by_name IS NULL AND deletion_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deleted_by_name IS NOT NULL AND deletion_reason IS NOT NULL));
CREATE INDEX cake_order_deleted_at_idx ON cake_order(deleted_at, id) WHERE deleted_at IS NOT NULL;

-- 无业务快照、客户资料和金额；清理后仍能追溯谁在何时删除了哪个订单。
CREATE TABLE cake_order_deletion_audit (
    order_id UUID PRIMARY KEY,
    order_no VARCHAR(32) NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL,
    deleted_by UUID NOT NULL,
    purged_at TIMESTAMPTZ
);
-- 幂等回执的订单标识在订单清理后仍须有效，避免旧请求重新建单。
ALTER TABLE cake_order_creation ADD COLUMN purged_order_id UUID;
ALTER TABLE cake_order_creation ADD CONSTRAINT cake_order_creation_receipt_check
    CHECK (order_id IS NULL OR purged_order_id IS NULL);
ALTER TABLE customer_order_submission DROP CONSTRAINT customer_order_submission_status_check;
ALTER TABLE customer_order_submission ADD CONSTRAINT customer_order_submission_status_check
    CHECK (status IN ('PENDING', 'CONFIRMED', 'DELETED', 'PURGED'));
ALTER TABLE customer_order_submission ALTER COLUMN requested_date DROP NOT NULL;

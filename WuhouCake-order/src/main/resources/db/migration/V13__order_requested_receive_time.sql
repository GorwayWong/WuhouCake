ALTER TABLE cake_order ADD COLUMN requested_receive_at TIMESTAMPTZ;

-- Preserve later date corrections rather than treating the acceptance snapshot as the current agreement.
UPDATE cake_order o
SET requested_receive_at = (s.reviewed #>> '{content,requestedReceiveAt}')::timestamptz
FROM customer_order_submission s
WHERE o.source = 'CUSTOMER_SUBMITTED' AND o.source_submission_id = s.id AND s.status = 'CONFIRMED'
  AND s.reviewed #>> '{content,requestedReceiveAt}' IS NOT NULL
  AND o.requested_receive_date = ((s.reviewed #>> '{content,requestedReceiveAt}')::timestamptz AT TIME ZONE 'Asia/Shanghai')::date;

ALTER TABLE cake_order ADD CONSTRAINT chk_order_requested_receive_date
CHECK (requested_receive_at IS NULL OR requested_receive_date = (requested_receive_at AT TIME ZONE 'Asia/Shanghai')::date);

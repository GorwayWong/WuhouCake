CREATE INDEX cake_order_pickup_day_idx ON cake_order
    ((COALESCE((COALESCE(planned_handoff_at, requested_receive_at) AT TIME ZONE 'Asia/Shanghai')::date, requested_receive_date)))
    WHERE deleted_at IS NULL;

CREATE INDEX cake_order_finish_schedule_idx ON cake_order (planned_finish_at, order_no, id)
    WHERE deleted_at IS NULL;

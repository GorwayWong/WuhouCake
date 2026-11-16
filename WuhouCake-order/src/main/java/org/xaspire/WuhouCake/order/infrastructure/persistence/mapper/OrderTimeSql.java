package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

/** Read historical pickup arrangements without rewriting their stored source fields. */
final class OrderTimeSql {
    static final String PICKUP_AT = "COALESCE(planned_handoff_at,requested_receive_at)";
    static final String PICKUP_DATE = "COALESCE((" + PICKUP_AT + " AT TIME ZONE 'Asia/Shanghai')::date,requested_receive_date)";
    static final String ORDER_PICKUP_AT = "COALESCE(o.planned_handoff_at,o.requested_receive_at)";
    static final String ORDER_PICKUP_DATE = "COALESCE((" + ORDER_PICKUP_AT + " AT TIME ZONE 'Asia/Shanghai')::date,o.requested_receive_date)";

    private OrderTimeSql() { }
}

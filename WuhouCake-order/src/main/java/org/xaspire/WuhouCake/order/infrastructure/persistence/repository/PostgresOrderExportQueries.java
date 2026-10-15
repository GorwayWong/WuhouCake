package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.port.OrderExportQueries;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.*;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.EXPORT_ORDERS;

public final class PostgresOrderExportQueries implements OrderExportQueries {
    private final OrderQueryMapper queries;
    private final OrderActivityMapper activities;
    private final JsonCodec json;
    public PostgresOrderExportQueries(OrderQueryMapper queries, OrderActivityMapper activities, JsonCodec json) {
        this.queries = queries; this.activities = activities; this.json = json;
    }
    @Override public List<UUID> select(Filter filter) {
        return queries.exportIds(filter.from(), filter.to(), filter.status(), filter.fulfillmentType(), filter.paymentStatus(), EXPORT_ORDERS + 1)
                .stream().map(UUID::fromString).toList();
    }
    @Override public List<OrderActivity> orderNotes(UUID orderId) {
        return activities.orderNotes(orderId.toString()).stream().map(row -> new OrderActivity(row.id(), orderId, null, row.type(), row.content(),
                JsonSnapshot.object(json.read(row.details(), Map.class)), UUID.fromString(row.actorId()), row.actorNameSnapshot(), row.createdAt())).toList();
    }
    @Override public ContentSize contentSize(List<UUID> orderIds) {
        var size = queries.exportContentSize(orderIds.stream().map(UUID::toString).toList());
        return new ContentSize(size.bytes(), size.rows());
    }
}

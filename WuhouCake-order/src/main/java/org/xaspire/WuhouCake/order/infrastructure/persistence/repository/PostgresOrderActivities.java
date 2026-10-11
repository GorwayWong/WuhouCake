package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.repository.OrderActivities;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderActivityMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public final class PostgresOrderActivities implements OrderActivities {
    private final OrderActivityMapper mapper;
    private final JsonCodec json;
    public PostgresOrderActivities(OrderActivityMapper mapper, JsonCodec json) { this.mapper = mapper; this.json = json; }

    @Override public OrderActivity append(OrderActivity activity) {
        var row = new OrderActivityMapper.Row(0, activity.orderId().toString(), string(activity.itemId()), activity.type(), activity.content(),
                json.write(activity.details()), activity.actorId().toString(), activity.actorNameSnapshot(), activity.createdAt());
        return activity.identified(mapper.append(row));
    }
    @Override public List<OrderActivity> recentItemNotes(UUID orderId) { return mapper.recentItemNotes(orderId.toString()).stream().map(this::activity).toList(); }
    @Override public List<OrderActivity> search(UUID orderId, UUID itemId, String type, int size, long offset) {
        return mapper.search(orderId.toString(), string(itemId), type, size, offset).stream().map(this::activity).toList();
    }
    @Override public long count(UUID orderId, UUID itemId, String type) { return mapper.count(orderId.toString(), string(itemId), type); }
    private OrderActivity activity(OrderActivityMapper.Row row) {
        return new OrderActivity(row.id(), UUID.fromString(row.orderId()), row.itemId() == null ? null : UUID.fromString(row.itemId()), row.type(), row.content(),
                JsonSnapshot.object(json.read(row.details(), Map.class)), UUID.fromString(row.actorId()), row.actorNameSnapshot(), row.createdAt());
    }
    private static String string(UUID id) { return id == null ? null : id.toString(); }
}

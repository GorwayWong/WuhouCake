package org.xaspire.WuhouCake.order.domain.model.entity;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.Actor;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public record OrderActivity(long id, UUID orderId, UUID itemId, String type, String content,
        Map<String, Object> details, UUID actorId, String actorNameSnapshot, Instant createdAt) {
    public static final Set<String> TYPES = Set.of("CREATED", "ITEM_CHANGED", "NOTE", "PAYMENT_STATUS_CHANGED", "ORDER_PRODUCTION_CHANGED",
            "ORDER_FULFILLMENT_CHANGED", "ORDER_CANCELLED", "ORDER_INFORMATION_CHANGED", "ITEM_ADDED", "ITEM_REMOVED", "ORDER_EXPORTED");
    public OrderActivity {
        Objects.requireNonNull(orderId); Objects.requireNonNull(actorId); Objects.requireNonNull(createdAt);
        if (type == null || !TYPES.contains(type)) throw invalid();
        content = requiredText(content, Integer.MAX_VALUE);
        actorNameSnapshot = requiredText(actorNameSnapshot, 100);
        details = JsonSnapshot.object(details);
    }
    public static OrderActivity append(UUID orderId, UUID itemId, String type, String content,
            Map<String, Object> details, Actor actor, Instant now) {
        return new OrderActivity(0, orderId, itemId, type, content, details, actor.accountId(), actor.nickname(), now);
    }
    public OrderActivity identified(long id) {
        return new OrderActivity(id, orderId, itemId, type, content, details, actorId, actorNameSnapshot, createdAt);
    }
}

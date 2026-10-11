package org.xaspire.WuhouCake.order.domain.repository;

import java.util.List;
import java.util.UUID;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;

public interface OrderActivities {
    OrderActivity append(OrderActivity activity);
    List<OrderActivity> recentItemNotes(UUID orderId);
    List<OrderActivity> search(UUID orderId, UUID itemId, String type, int size, long offset);
    long count(UUID orderId, UUID itemId, String type);
}

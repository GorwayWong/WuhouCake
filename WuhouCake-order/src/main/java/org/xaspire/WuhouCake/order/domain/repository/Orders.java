package org.xaspire.WuhouCake.order.domain.repository;

import java.util.Optional;
import java.util.UUID;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;

public interface Orders {
    String nextNumber();
    void create(Order order);
    Optional<Order> find(UUID id);
    void reviseItem(Order order, long expectedVersion, UUID itemId);
}

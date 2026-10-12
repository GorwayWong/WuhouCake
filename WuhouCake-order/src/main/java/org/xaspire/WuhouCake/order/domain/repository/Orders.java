package org.xaspire.WuhouCake.order.domain.repository;

import java.util.Optional;
import java.util.UUID;
import java.util.List;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;

public interface Orders {
    String nextNumber();
    void create(Order order);
    Optional<Order> find(UUID id);
    void reviseItem(Order order, long expectedVersion, UUID itemId);
    void changePaymentStatus(Order order, long expectedVersion);
    void changeProduction(Order order, long expectedVersion, List<UUID> changedItemIds);
    void changeStatus(Order order, long expectedVersion);
    void verifyVersion(UUID id, long expectedVersion);
}

package org.xaspire.WuhouCake.order.domain.repository;

import java.util.Optional;
import java.util.UUID;
import java.util.List;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;

public interface Orders {
    String nextNumber();
    void create(Order order);
    Optional<Order> find(UUID id);
    /** 写用例先锁订单行，再校验版本及删除标记。 */
    default Optional<Order> lock(UUID id) { return find(id); }
    default void delete(Order order, long expectedVersion) { throw new UnsupportedOperationException(); }
    void reviseItem(Order order, long expectedVersion, UUID itemId);
    void reviseInformation(Order order, long expectedVersion);
    void addItem(Order order, long expectedVersion, UUID itemId);
    void removeItem(Order order, long expectedVersion, UUID itemId);
    void changePaymentStatus(Order order, long expectedVersion);
    void changeProduction(Order order, long expectedVersion, List<UUID> changedItemIds);
    void changeStatus(Order order, long expectedVersion);
    void verifyVersion(UUID id, long expectedVersion);
}

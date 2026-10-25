package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.repository.Orders;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public final class PostgresOrders implements Orders {
    private final OrderMapper mapper;
    private final JsonCodec json;
    public PostgresOrders(OrderMapper mapper, JsonCodec json) { this.mapper = mapper; this.json = json; }

    @Override public String nextNumber() { return String.format(Locale.ROOT, "%07d", mapper.nextNumber()); }
    @Override public void create(Order order) {
        mapper.insert(row(order));
        for (var item : order.activeItems()) mapper.insertItem(row(order.id(), item));
    }
    @Override public Optional<Order> find(UUID id) {
        return restore(id, mapper.find(id.toString()));
    }
    @Override public Optional<Order> lock(UUID id) { return restore(id, mapper.lock(id.toString())); }
    private Optional<Order> restore(UUID id, OrderMapper.Row row) {
        if (row == null) return Optional.empty();
        var items = mapper.items(id.toString()).stream().map(this::item).toList();
        return Optional.of(new Order(id, row.orderNo(), row.version(), row.status(), row.paymentStatus(), row.currentStageCode(),
                new CustomerContact(row.customerName(), row.customerPhone(), row.memberPhone(), row.buyerName()),
                new FulfillmentPlan(FulfillmentType.valueOf(row.fulfillmentType()), row.deliveryAddress(), row.requestedReceiveDate(), row.plannedHandoffAt(), row.plannedFinishAt(), row.requestedReceiveAt()),
                row.totalAmountCents(), UUID.fromString(row.createdBy()), row.createdAt(), row.confirmedAt(), row.updatedAt(), items,
                row.creditedEmployeeId() == null ? null : new Attribution(UUID.fromString(row.creditedEmployeeId()), row.creditedEmployeeNumber(), row.creditedEmployeeName()), row.paidAt(),
                row.deletedAt() == null ? null : new OrderDeletion(row.deletedAt(), UUID.fromString(row.deletedBy()), row.deletedByName(), row.deletionReason())));
    }
    @Override public void delete(Order order, long expectedVersion) {
        var row = row(order);
        if (mapper.delete(row, expectedVersion) != 1) throw new OrderFailure("CONCURRENT_MODIFICATION");
        mapper.auditDeletion(row);
    }
    @Override public void reviseItem(Order order, long expectedVersion, UUID itemId) {
        if (mapper.updateProduction(order.id().toString(), expectedVersion, order.status(), order.currentStageCode(), order.updatedAt()) != 1) throw new OrderFailure("CONCURRENT_MODIFICATION");
        if (mapper.updateItem(row(order.id(), order.requireActiveItem(itemId))) != 1) throw new OrderFailure("ORDER_NOT_FOUND");
    }
    @Override public void changePaymentStatus(Order order, long expectedVersion) {
        if (mapper.updatePaymentStatus(order.id().toString(), expectedVersion, order.paymentStatus(), order.updatedAt(), order.paidAt()) != 1)
            throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
    @Override public void reviseInformation(Order order, long expectedVersion) {
        if (mapper.updateInformation(row(order), expectedVersion) != 1) throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
    @Override public void addItem(Order order, long expectedVersion, UUID itemId) {
        if (mapper.updateProduction(order.id().toString(), expectedVersion, order.status(), order.currentStageCode(), order.updatedAt()) != 1)
            throw new OrderFailure("CONCURRENT_MODIFICATION");
        mapper.insertItem(row(order.id(), order.requireActiveItem(itemId)));
    }
    @Override public void removeItem(Order order, long expectedVersion, UUID itemId) {
        if (mapper.updateProduction(order.id().toString(), expectedVersion, order.status(), order.currentStageCode(), order.updatedAt()) != 1) throw new OrderFailure("CONCURRENT_MODIFICATION");
        if (mapper.removeItem(order.id().toString(), itemId.toString(), order.updatedAt()) != 1) throw new OrderFailure("ORDER_NOT_FOUND");
    }
    @Override public void changeProduction(Order order, long expectedVersion, List<UUID> changedItemIds) {
        if (mapper.updateProduction(order.id().toString(), expectedVersion, order.status(), order.currentStageCode(), order.updatedAt()) != 1)
            throw new OrderFailure("CONCURRENT_MODIFICATION");
        for (var itemId : changedItemIds) {
            if (mapper.updateItemProduction(row(order.id(), order.requireActiveItem(itemId))) != 1) throw new OrderFailure("ORDER_NOT_FOUND");
        }
    }
    @Override public void verifyVersion(UUID id, long expectedVersion) {
        if (mapper.lockedVersion(id.toString(), expectedVersion) == null) throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
    @Override public void changeStatus(Order order, long expectedVersion) {
        if (mapper.updateStatus(order.id().toString(), expectedVersion, order.status(), order.updatedAt()) != 1)
            throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
    private static OrderMapper.Row row(Order order) {
        var customer = order.customer(); var fulfillment = order.fulfillment();
        return new OrderMapper.Row(order.id().toString(), order.orderNo(), order.version(), order.status(), order.paymentStatus(), order.currentStageCode(),
                customer.customerName(), customer.phone(), customer.memberPhone(), customer.buyerName(), fulfillment.type().name(), fulfillment.address(),
                fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt(), order.totalAmountCents(),
                order.createdBy().toString(), order.createdAt(), order.confirmedAt(), order.updatedAt(),
                order.creditedEmployee() == null ? null : order.creditedEmployee().accountId().toString(),
                order.creditedEmployee() == null ? null : order.creditedEmployee().employeeNumber(),
                order.creditedEmployee() == null ? null : order.creditedEmployee().nickname(), fulfillment.requestedReceiveAt(), order.paidAt(),
                order.deletion() == null ? null : order.deletion().deletedAt(),
                order.deletion() == null ? null : order.deletion().deletedBy().toString(),
                order.deletion() == null ? null : order.deletion().employeeName(),
                order.deletion() == null ? null : order.deletion().reason());
    }
    private OrderMapper.ItemRow row(UUID orderId, OrderItem item) {
        return new OrderMapper.ItemRow(item.itemId().toString(), orderId.toString(), item.name(), item.productType(), item.quantity(),
                item.unitPriceCents(), item.memberPriceCents(), json.write(item.attributes()), item.productionStatus(), item.currentStageCode(),
                item.removed(), item.createdAt(), item.updatedAt());
    }
    private OrderItem item(OrderMapper.ItemRow row) {
        return new OrderItem(UUID.fromString(row.id()), row.name(), row.productType(), row.quantity(), row.unitPriceCents(), row.memberPriceCents(),
                JsonSnapshot.object(json.read(row.attributes(), Map.class)), row.productionStatus(), row.currentStageCode(), row.removed(), row.createdAt(), row.updatedAt());
    }
}

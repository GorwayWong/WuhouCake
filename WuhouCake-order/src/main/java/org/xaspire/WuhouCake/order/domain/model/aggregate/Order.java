package org.xaspire.WuhouCake.order.domain.model.aggregate;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public final class Order {
    private final UUID id;
    private final String orderNo;
    private final String status;
    private final String paymentStatus;
    private final CustomerContact customer;
    private final FulfillmentPlan fulfillment;
    private final Long totalAmountCents;
    private final UUID createdBy;
    private final Instant createdAt;
    private final Instant confirmedAt;
    private final Map<UUID, OrderItem> items = new LinkedHashMap<>();
    private long version;
    private Instant updatedAt;

    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items) {
        this.id = Objects.requireNonNull(id); this.orderNo = requiredText(orderNo, 32);
        this.version = nonNegativeInteger(version); this.status = Objects.requireNonNull(status); this.paymentStatus = Objects.requireNonNull(paymentStatus);
        this.customer = Objects.requireNonNull(customer); this.fulfillment = Objects.requireNonNull(fulfillment);
        this.totalAmountCents = money(totalAmountCents); this.createdBy = Objects.requireNonNull(createdBy);
        this.createdAt = Objects.requireNonNull(createdAt); this.confirmedAt = Objects.requireNonNull(confirmedAt); this.updatedAt = Objects.requireNonNull(updatedAt);
        if (items == null || items.isEmpty()) throw invalid();
        for (var item : items) if (this.items.putIfAbsent(item.itemId(), item) != null) throw invalid();
        if (activeItems().isEmpty()) throw invalid();
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now) {
        return new Order(id, orderNo, 0, "WAITING_PRODUCTION", "UNPAID", customer, fulfillment, total, actorId, now, now, now, items);
    }
    public OrderItem requireActiveItem(UUID itemId) {
        var item = items.get(itemId);
        if (item == null || item.removed()) throw new OrderFailure("ORDER_NOT_FOUND");
        return item;
    }
    public Map<String, Object> reviseItem(UUID itemId, Map<String, Object> changes, Instant now) {
        var previous = requireActiveItem(itemId);
        var revised = previous.revise(changes, now);
        var before = new LinkedHashMap<String, Object>();
        var after = new LinkedHashMap<String, Object>();
        var previousValues = previous.businessValues();
        revised.businessValues().forEach((field, value) -> {
            if (!Objects.equals(previousValues.get(field), value)) { before.put(field, previousValues.get(field)); after.put(field, value); }
        });
        if (before.isEmpty()) return Map.of();
        if (version == Long.MAX_VALUE) throw new OrderFailure("CONCURRENT_MODIFICATION");
        items.put(itemId, revised); version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", before, "after", after));
    }
    public UUID id() { return id; }
    public String orderNo() { return orderNo; }
    public long version() { return version; }
    public String status() { return status; }
    public String paymentStatus() { return paymentStatus; }
    public CustomerContact customer() { return customer; }
    public FulfillmentPlan fulfillment() { return fulfillment; }
    public Long totalAmountCents() { return totalAmountCents; }
    public UUID createdBy() { return createdBy; }
    public Instant createdAt() { return createdAt; }
    public Instant confirmedAt() { return confirmedAt; }
    public Instant updatedAt() { return updatedAt; }
    public List<OrderItem> activeItems() {
        return items.values().stream().filter(item -> !item.removed())
                .sorted(Comparator.comparing(OrderItem::createdAt).thenComparing(item -> item.itemId().toString())).toList();
    }
}

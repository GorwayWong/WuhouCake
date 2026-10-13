package org.xaspire.WuhouCake.order.domain.model.aggregate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.DateTimeException;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public final class Order {
    private final UUID id;
    private final String orderNo;
    private String status;
    private String paymentStatus;
    private String currentStageCode;
    private CustomerContact customer;
    private FulfillmentPlan fulfillment;
    private Long totalAmountCents;
    private final UUID createdBy;
    private final Instant createdAt;
    private final Instant confirmedAt;
    private final Map<UUID, OrderItem> items = new LinkedHashMap<>();
    private long version;
    private Instant updatedAt;

    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items) {
        this.id = Objects.requireNonNull(id); this.orderNo = requiredText(orderNo, 32);
        this.version = nonNegativeInteger(version); this.status = Objects.requireNonNull(status); this.paymentStatus = Objects.requireNonNull(paymentStatus);
        if (currentStageCode != null && !Set.of("LAYER_DONE", "FROSTING_DONE").contains(currentStageCode)) throw invalid();
        this.currentStageCode = currentStageCode;
        this.customer = Objects.requireNonNull(customer); this.fulfillment = Objects.requireNonNull(fulfillment);
        this.totalAmountCents = money(totalAmountCents); this.createdBy = Objects.requireNonNull(createdBy);
        this.createdAt = Objects.requireNonNull(createdAt); this.confirmedAt = Objects.requireNonNull(confirmedAt); this.updatedAt = Objects.requireNonNull(updatedAt);
        if (items == null || items.isEmpty()) throw invalid();
        for (var item : items) if (this.items.putIfAbsent(item.itemId(), item) != null) throw invalid();
        if (activeItems().isEmpty()) throw invalid();
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now) {
        return new Order(id, orderNo, 0, "WAITING_PRODUCTION", "UNPAID", null, customer, fulfillment, total, actorId, now, now, now, items);
    }
    public OrderItem requireActiveItem(UUID itemId) {
        var item = requireItem(itemId);
        if (item.removed()) throw new OrderFailure("ORDER_NOT_FOUND");
        return item;
    }
    public OrderItem requireItem(UUID itemId) {
        var item = items.get(itemId);
        if (item == null) throw new OrderFailure("ORDER_NOT_FOUND");
        return item;
    }
    public Map<String, Object> removeItem(UUID itemId, Instant now) {
        var previous = requireItem(itemId);
        if (previous.removed()) return Map.of();
        if (!Set.of("WAITING_PRODUCTION", "PROCESSING").contains(status)) throw new OrderFailure("ORDER_NOT_EDITABLE");
        if (activeItems().size() == 1) throw invalid();
        requireNextVersion();
        var removed = previous.remove(now);
        var details = JsonSnapshot.object(Map.of("before", itemValues(previous), "after", itemValues(removed)));
        items.put(itemId, removed); version++; updatedAt = now;
        return details;
    }
    public Map<String, Object> addItem(OrderItem item, Instant now) {
        if (!Set.of("WAITING_PRODUCTION", "PROCESSING").contains(status)) throw new OrderFailure("ORDER_NOT_EDITABLE");
        if (item == null || items.containsKey(item.itemId()) || item.removed() || !"NOT_STARTED".equals(item.productionStatus())
                || item.currentStageCode() != null) throw invalid();
        requireNextVersion();
        var added = status.equals("PROCESSING") ? item.changeProductionStatus("IN_PROGRESS", now) : item;
        var before = new LinkedHashMap<String, Object>(); var after = new LinkedHashMap<String, Object>();
        before.put("item", null); after.put("item", itemValues(added));
        if (currentStageCode != null) {
            before.put("currentStageCode", currentStageCode); after.put("currentStageCode", null);
        }
        var details = JsonSnapshot.object(Map.of("before", before, "after", after));
        items.put(added.itemId(), added); currentStageCode = null; version++; updatedAt = now;
        return details;
    }
    private static Map<String, Object> itemValues(OrderItem item) {
        var values = new LinkedHashMap<>(item.businessValues());
        values.put("itemId", item.itemId().toString()); values.put("productionStatus", item.productionStatus());
        values.put("currentStageCode", item.currentStageCode()); values.put("isRemoved", item.removed());
        return values;
    }
    public Map<String, Object> reviseItem(UUID itemId, Map<String, Object> changes, Instant now) {
        var previous = requireActiveItem(itemId);
        if (!Set.of("WAITING_PRODUCTION", "PROCESSING").contains(status)) throw new OrderFailure("ORDER_NOT_EDITABLE");
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
    public Map<String, Object> reviseInformation(Map<String, Object> changes, Instant now) {
        var fields = Set.of("customerName", "phone", "memberPhone", "buyerName", "fulfillmentType", "address", "requestedReceiveDate",
                "plannedHandoffAt", "plannedFinishAt", "totalAmountCents");
        if (changes == null || changes.isEmpty() || changes.keySet().stream().anyMatch(key -> key == null || !fields.contains(key))) throw invalid();
        var previous = informationValues(customer, fulfillment, totalAmountCents);
        var merged = new LinkedHashMap<>(previous); merged.putAll(changes);
        var contact = new CustomerContact(text(merged.get("customerName")), text(merged.get("phone")), text(merged.get("memberPhone")), text(merged.get("buyerName")));
        FulfillmentType type;
        try { type = FulfillmentType.valueOf(text(merged.get("fulfillmentType"))); }
        catch (IllegalArgumentException | NullPointerException failure) { throw invalid(); }
        var plan = new FulfillmentPlan(type, text(merged.get("address")), date(merged.get("requestedReceiveDate")),
                changes.containsKey("plannedHandoffAt") ? instant(changes.get("plannedHandoffAt")) : fulfillment.plannedHandoffAt(),
                changes.containsKey("plannedFinishAt") ? instant(changes.get("plannedFinishAt")) : fulfillment.plannedFinishAt());
        var total = money(merged.get("totalAmountCents"));
        var nextStatus = status;
        if (type != fulfillment.type() && Set.of("WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING").contains(status))
            nextStatus = type == FulfillmentType.DELIVERY ? "WAITING_DELIVERY" : "WAITING_PICKUP";
        var before = new LinkedHashMap<String, Object>(); var after = new LinkedHashMap<String, Object>();
        informationValues(contact, plan, total).forEach((field, value) -> {
            if (!Objects.equals(previous.get(field), value)) { before.put(field, previous.get(field)); after.put(field, value); }
        });
        if (!status.equals(nextStatus)) { before.put("status", status); after.put("status", nextStatus); }
        if (before.isEmpty()) return Map.of();
        requireNextVersion();
        var details = JsonSnapshot.object(Map.of("before", before, "after", after));
        customer = contact; fulfillment = plan; totalAmountCents = total; status = nextStatus; version++; updatedAt = now;
        return details;
    }
    private static Map<String, Object> informationValues(CustomerContact customer, FulfillmentPlan fulfillment, Long total) {
        var values = new LinkedHashMap<String, Object>();
        values.put("customerName", customer.customerName()); values.put("phone", customer.phone());
        values.put("memberPhone", customer.memberPhone()); values.put("buyerName", customer.buyerName());
        values.put("fulfillmentType", fulfillment.type().name());
        values.put("address", fulfillment.address()); values.put("requestedReceiveDate", fulfillment.requestedReceiveDate().toString());
        values.put("plannedHandoffAt", fulfillment.plannedHandoffAt().toString());
        values.put("plannedFinishAt", fulfillment.plannedFinishAt() == null ? null : fulfillment.plannedFinishAt().toString());
        values.put("totalAmountCents", total);
        return values;
    }
    private static String text(Object value) {
        if (value == null) return null;
        if (!(value instanceof String text)) throw invalid();
        return text;
    }
    private static LocalDate date(Object value) {
        if (value == null) return null;
        try { return LocalDate.parse(text(value)); }
        catch (DateTimeException failure) { throw invalid(); }
    }
    private static Instant instant(Object value) {
        if (value == null) return null;
        try { return Instant.parse(text(value)).truncatedTo(ChronoUnit.MICROS); }
        catch (DateTimeException failure) { throw invalid(); }
    }
    public Map<String, Object> changePaymentStatus(String paymentStatus, Instant now) {
        if (paymentStatus == null || !Set.of("UNPAID", "PAID").contains(paymentStatus)) throw invalid();
        if (this.paymentStatus.equals(paymentStatus)) return Map.of();
        requireNextVersion();
        var before = this.paymentStatus;
        this.paymentStatus = paymentStatus; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", Map.of("paymentStatus", before), "after", Map.of("paymentStatus", paymentStatus)));
    }
    public Map<String, Object> applyProductionAction(String action, Instant now) {
        if (action == null) throw invalid();
        String nextStatus = status, nextStage = currentStageCode, itemStatus = null;
        switch (action) {
            case "START_PRODUCTION" -> {
                requireProductionState(status.equals("WAITING_PRODUCTION"));
                nextStatus = "PROCESSING"; itemStatus = "IN_PROGRESS";
            }
            case "COMPLETE_LAYER" -> {
                requireProductionState(status.equals("PROCESSING") && currentStageCode == null);
                nextStage = "LAYER_DONE";
            }
            case "COMPLETE_FROSTING" -> {
                requireProductionState(status.equals("PROCESSING") && "LAYER_DONE".equals(currentStageCode));
                nextStage = "FROSTING_DONE";
            }
            case "COMPLETE_PRODUCTION" -> {
                requireProductionState(status.equals("PROCESSING"));
                nextStatus = fulfillment.type() == FulfillmentType.DELIVERY ? "WAITING_DELIVERY" : "WAITING_PICKUP";
                itemStatus = "COMPLETED";
            }
            case "REOPEN_PRODUCTION" -> {
                requireProductionState(Set.of("WAITING_DELIVERY", "WAITING_PICKUP").contains(status));
                nextStatus = "PROCESSING"; nextStage = null; itemStatus = "IN_PROGRESS";
            }
            default -> throw invalid();
        }
        requireNextVersion();
        var before = productionValues();
        var itemChanges = new ArrayList<Map<String, Object>>();
        if (itemStatus != null) {
            for (var item : activeItems()) {
                var changed = item.changeProductionStatus(itemStatus, now);
                if (changed.equals(item)) continue;
                items.put(item.itemId(), changed);
                itemChanges.add(Map.of("itemId", item.itemId().toString(), "before", Map.of("productionStatus", item.productionStatus()),
                        "after", Map.of("productionStatus", changed.productionStatus())));
            }
        }
        status = nextStatus; currentStageCode = nextStage; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("action", action, "before", before, "after", productionValues(), "itemChanges", itemChanges));
    }
    public Map<String, Object> applyFulfillmentAction(String action, Instant now) {
        if (action == null) throw invalid();
        String nextStatus;
        switch (action) {
            case "START_DELIVERY" -> {
                requireFulfillmentState(fulfillment.type() == FulfillmentType.DELIVERY && status.equals("WAITING_DELIVERY"));
                nextStatus = "DELIVERING";
            }
            case "COMPLETE_DELIVERY" -> {
                requireFulfillmentState(fulfillment.type() == FulfillmentType.DELIVERY && status.equals("DELIVERING"));
                nextStatus = "COMPLETED";
            }
            case "CONFIRM_PICKUP" -> {
                requireFulfillmentState(fulfillment.type() == FulfillmentType.PICKUP && status.equals("WAITING_PICKUP"));
                nextStatus = "COMPLETED";
            }
            default -> throw invalid();
        }
        requireNextVersion();
        var before = status; status = nextStatus; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("action", action, "before", Map.of("status", before), "after", Map.of("status", status)));
    }
    public Map<String, Object> cancel(String reason, Instant now) {
        requiredText(reason, Integer.MAX_VALUE);
        if (!Set.of("WAITING_PRODUCTION", "PROCESSING", "WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING").contains(status))
            throw new OrderFailure("ORDER_NOT_CANCELLABLE");
        requireNextVersion();
        var before = status; status = "CANCELLED"; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", Map.of("status", before), "after", Map.of("status", status)));
    }
    private Map<String, Object> productionValues() {
        var values = new LinkedHashMap<String, Object>();
        values.put("status", status); values.put("currentStageCode", currentStageCode);
        return values;
    }
    private void requireNextVersion() {
        if (version == Long.MAX_VALUE) throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
    private static void requireProductionState(boolean allowed) {
        if (!allowed) throw new OrderFailure("INVALID_PRODUCTION_TRANSITION");
    }
    private static void requireFulfillmentState(boolean allowed) {
        if (!allowed) throw new OrderFailure("INVALID_FULFILLMENT_TRANSITION");
    }
    public UUID id() { return id; }
    public String orderNo() { return orderNo; }
    public long version() { return version; }
    public String status() { return status; }
    public String paymentStatus() { return paymentStatus; }
    public String currentStageCode() { return currentStageCode; }
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

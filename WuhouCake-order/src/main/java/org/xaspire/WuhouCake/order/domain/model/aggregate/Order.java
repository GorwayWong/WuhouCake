package org.xaspire.WuhouCake.order.domain.model.aggregate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.DateTimeException;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderDeletion;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public final class Order {
    private final UUID id;
    private final String orderNo;
    private String status;
    private String paymentStatus;
    private Instant paidAt;
    private String currentStageCode;
    private CustomerContact customer;
    private FulfillmentPlan fulfillment;
    private Long totalAmountCents;
    private final UUID createdBy;
    private Attribution creditedEmployee;
    private final Instant createdAt;
    private final Instant confirmedAt;
    private final Map<UUID, OrderItem> items = new LinkedHashMap<>();
    private long version;
    private Instant updatedAt;
    private OrderDeletion deletion;

    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items) {
        this(id, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                createdBy, createdAt, confirmedAt, updatedAt, items, null);
    }
    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items, Attribution creditedEmployee) {
        this(id, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, null);
    }
    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items, Attribution creditedEmployee, Instant paidAt) {
        this(id, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, paidAt, null);
    }
    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items, Attribution creditedEmployee, Instant paidAt, OrderDeletion deletion) {
        this.id = Objects.requireNonNull(id); this.orderNo = requiredText(orderNo, 32);
        this.version = nonNegativeInteger(version); this.status = Objects.requireNonNull(status); this.paymentStatus = Objects.requireNonNull(paymentStatus);
        if (currentStageCode != null && !Set.of("LAYER_DONE", "FROSTING_DONE", "OTHER_DONE").contains(currentStageCode)) throw invalid();
        this.paidAt = paidAt;
        this.deletion = deletion;
        this.currentStageCode = currentStageCode;
        this.customer = Objects.requireNonNull(customer); this.fulfillment = Objects.requireNonNull(fulfillment);
        this.totalAmountCents = money(totalAmountCents); this.createdBy = Objects.requireNonNull(createdBy);
        this.creditedEmployee = creditedEmployee;
        this.createdAt = Objects.requireNonNull(createdAt); this.confirmedAt = Objects.requireNonNull(confirmedAt); this.updatedAt = Objects.requireNonNull(updatedAt);
        if (items == null || items.isEmpty()) throw invalid();
        for (var item : items) if (this.items.putIfAbsent(item.itemId(), item) != null) throw invalid();
        if (activeItems().isEmpty()) throw invalid();
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now) {
        return new Order(id, orderNo, 0, "WAITING_PRODUCTION", "UNPAID", null, customer, fulfillment, total, actorId, now, now, now, items);
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now, Attribution creditedEmployee) {
        return new Order(id, orderNo, 0, "WAITING_PRODUCTION", "UNPAID", null, customer, fulfillment, total, actorId, now, now, now, items, creditedEmployee);
    }
    public OrderItem requireActiveItem(UUID itemId) {
        var item = requireItem(itemId);
        if (item.removed()) throw new OrderFailure("ORDER_NOT_FOUND");
        return item;
    }
    public OrderDeletion deletion() { return deletion; }
    public void requireWritable() {
        if (deletion != null) throw new OrderFailure("ORDER_DELETED");
    }
    public void delete(String reason, Actor actor, Instant now) {
        if (deletion != null) return;
        requireNextVersion();
        deletion = new OrderDeletion(now, actor.accountId(), actor.nickname(), reason);
        version++; updatedAt = now;
    }
    public OrderItem requireItem(UUID itemId) {
        var item = items.get(itemId);
        if (item == null) throw new OrderFailure("ORDER_NOT_FOUND");
        return item;
    }
    public Map<String, Object> removeItem(UUID itemId, Instant now) {
        requireWritable();
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
        requireWritable();
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
        requireWritable();
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
        if (status.equals("PROCESSING")
                && before.keySet().stream().anyMatch(Set.of("name", "productType", "quantity", "attributes")::contains)) {
            revised = revised.changeProductionStatus("IN_PROGRESS", now);
            if ("OTHER_DONE".equals(currentStageCode)) currentStageCode = "FROSTING_DONE";
        }
        items.put(itemId, revised); version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", before, "after", after));
    }
    public Map<String, Object> reviseInformation(Map<String, Object> changes, Instant now) {
        return reviseInformation(changes, now, creditedEmployee);
    }
    public Map<String, Object> reviseInformation(Map<String, Object> changes, Instant now, Attribution employee) {
        requireWritable();
        var fields = Set.of("customerName", "phone", "memberPhone", "buyerName", "fulfillmentType", "address", "requestedReceiveDate",
                "requestedReceiveAt", "plannedHandoffAt", "plannedFinishAt", "totalAmountCents", "creditedEmployeeId");
        if (changes == null || changes.isEmpty() || changes.keySet().stream().anyMatch(key -> key == null || !fields.contains(key))) throw invalid();
        var previous = informationValues(customer, fulfillment, totalAmountCents);
        previous.put("creditedEmployeeId", creditedEmployee == null ? null : creditedEmployee.accountId().toString());
        var merged = new LinkedHashMap<>(previous); merged.putAll(changes);
        var contact = new CustomerContact(text(merged.get("customerName")), text(merged.get("phone")), text(merged.get("memberPhone")), text(merged.get("buyerName")));
        FulfillmentType type;
        try { type = FulfillmentType.valueOf(text(merged.get("fulfillmentType"))); }
        catch (IllegalArgumentException | NullPointerException failure) { throw invalid(); }
        var requestedDate = date(merged.get("requestedReceiveDate"));
        var requestedAt = changes.containsKey("requestedReceiveAt") ? instant(changes.get("requestedReceiveAt")) : fulfillment.requestedReceiveAt();
        if (changes.containsKey("requestedReceiveAt") && requestedAt != null) {
            var derivedDate = receiveDate(requestedAt);
            if (changes.containsKey("requestedReceiveDate") && !derivedDate.equals(requestedDate)) throw invalid();
            requestedDate = derivedDate;
        } else if (requestedAt != null && !Objects.equals(requestedDate, fulfillment.requestedReceiveDate())) throw invalid();
        var plan = new FulfillmentPlan(type, text(merged.get("address")), requestedDate,
                changes.containsKey("plannedHandoffAt") ? instant(changes.get("plannedHandoffAt")) : fulfillment.plannedHandoffAt(),
                changes.containsKey("plannedFinishAt") ? instant(changes.get("plannedFinishAt")) : fulfillment.plannedFinishAt(), requestedAt);
        var total = money(merged.get("totalAmountCents"));
        var nextStatus = status;
        if (type != fulfillment.type() && Set.of("WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING").contains(status))
            nextStatus = type == FulfillmentType.DELIVERY ? "WAITING_DELIVERY" : "WAITING_PICKUP";
        var before = new LinkedHashMap<String, Object>(); var after = new LinkedHashMap<String, Object>();
        var nextValues = informationValues(contact, plan, total);
        nextValues.put("creditedEmployeeId", employee == null ? null : employee.accountId().toString());
        nextValues.forEach((field, value) -> {
            if (!Objects.equals(previous.get(field), value)) { before.put(field, previous.get(field)); after.put(field, value); }
        });
        if (!status.equals(nextStatus)) { before.put("status", status); after.put("status", nextStatus); }
        if (before.containsKey("creditedEmployeeId")) {
            before.put("creditedEmployeeName", creditedEmployee == null ? "未归属" : creditedEmployee.nickname() + " · " + creditedEmployee.employeeNumber());
            after.put("creditedEmployeeName", employee == null ? "未归属" : employee.nickname() + " · " + employee.employeeNumber());
        }
        if (before.isEmpty()) return Map.of();
        requireNextVersion();
        var details = JsonSnapshot.object(Map.of("before", before, "after", after));
        customer = contact; fulfillment = plan; totalAmountCents = total; status = nextStatus; creditedEmployee = employee; version++; updatedAt = now;
        return details;
    }
    private static Map<String, Object> informationValues(CustomerContact customer, FulfillmentPlan fulfillment, Long total) {
        var values = new LinkedHashMap<String, Object>();
        values.put("customerName", customer.customerName()); values.put("phone", customer.phone());
        values.put("memberPhone", customer.memberPhone()); values.put("buyerName", customer.buyerName());
        values.put("fulfillmentType", fulfillment.type().name());
        values.put("address", fulfillment.address()); values.put("requestedReceiveDate", fulfillment.requestedReceiveDate().toString());
        values.put("requestedReceiveAt", fulfillment.requestedReceiveAt() == null ? null : fulfillment.requestedReceiveAt().toString());
        values.put("plannedHandoffAt", fulfillment.plannedHandoffAt() == null ? null : fulfillment.plannedHandoffAt().toString());
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
        requireWritable();
        if (paymentStatus == null || !Set.of("UNPAID", "PAID").contains(paymentStatus)) throw invalid();
        if (this.paymentStatus.equals(paymentStatus)) return Map.of();
        requireNextVersion();
        var before = new LinkedHashMap<String, Object>(); before.put("paymentStatus", this.paymentStatus); before.put("paidAt", paidAt == null ? null : paidAt.toString());
        this.paymentStatus = paymentStatus; paidAt = "PAID".equals(paymentStatus) ? now : null; version++; updatedAt = now;
        var after = new LinkedHashMap<String, Object>(); after.put("paymentStatus", paymentStatus); after.put("paidAt", paidAt == null ? null : paidAt.toString());
        return JsonSnapshot.object(Map.of("before", before, "after", after));
    }
    public Map<String, Object> applyProductionAction(String action, Instant now) {
        requireWritable();
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
            case "COMPLETE_OTHER" -> {
                requireProductionState(status.equals("PROCESSING") && "FROSTING_DONE".equals(currentStageCode));
                if (!allItemsComplete()) throw new OrderFailure("OTHER_ITEMS_INCOMPLETE");
                nextStage = "OTHER_DONE";
            }
            case "COMPLETE_PRODUCTION" -> {
                requireProductionState(status.equals("PROCESSING") && "OTHER_DONE".equals(currentStageCode));
                if (!allItemsComplete()) throw new OrderFailure("OTHER_ITEMS_INCOMPLETE");
                nextStatus = fulfillment.type() == FulfillmentType.DELIVERY ? "WAITING_DELIVERY" : "WAITING_PICKUP";
                itemStatus = "COMPLETED";
            }
            case "REOPEN_PRODUCTION" -> {
                requireProductionState(Set.of("WAITING_DELIVERY", "WAITING_PICKUP").contains(status));
                nextStatus = "PROCESSING"; nextStage = "OTHER_DONE";
            }
            case "ROLLBACK_PRODUCTION" -> {
                requireProductionState(status.equals("PROCESSING"));
                if (currentStageCode == null) {
                    nextStatus = "WAITING_PRODUCTION"; itemStatus = "NOT_STARTED";
                } else {
                    nextStage = switch (currentStageCode) {
                        case "OTHER_DONE" -> "FROSTING_DONE";
                        case "FROSTING_DONE" -> "LAYER_DONE";
                        case "LAYER_DONE" -> null;
                        default -> throw invalid();
                    };
                }
            }
            default -> throw invalid();
        }
        return changeProduction(action, nextStatus, nextStage, itemStatus, now);
    }
    public Map<String, Object> restartCancelled(Instant now) {
        requireWritable();
        requireProductionState(status.equals("CANCELLED"));
        return changeProduction("RESTART_CANCELLED", "WAITING_PRODUCTION", null, "NOT_STARTED", now);
    }
    private Map<String, Object> changeProduction(String action, String nextStatus, String nextStage, String itemStatus, Instant now) {
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
        requireWritable();
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
            case "ROLLBACK_FULFILLMENT" -> {
                requireFulfillmentState(status.equals("COMPLETED") || status.equals("DELIVERING") && fulfillment.type() == FulfillmentType.DELIVERY);
                nextStatus = status.equals("DELIVERING") ? "WAITING_DELIVERY"
                        : fulfillment.type() == FulfillmentType.DELIVERY ? "DELIVERING" : "WAITING_PICKUP";
            }
            default -> throw invalid();
        }
        requireNextVersion();
        var before = status; status = nextStatus; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("action", action, "before", Map.of("status", before), "after", Map.of("status", status)));
    }
    public Map<String, Object> cancel(String reason, Instant now) {
        requireWritable();
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
    public Map<String, Object> completeSimpleItem(UUID itemId, boolean completed, Instant now) {
        requireWritable();
        requireProductionState(status.equals("PROCESSING"));
        var item = requireActiveItem(itemId);
        var changed = item.changeProductionStatus(completed ? "COMPLETED" : "IN_PROGRESS", now);
        if (changed.equals(item)) return Map.of();
        requireNextVersion();
        items.put(itemId, changed);
        if (!completed && "OTHER_DONE".equals(currentStageCode)) currentStageCode = "FROSTING_DONE";
        version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("itemId", itemId.toString(), "before", Map.of("productionStatus", item.productionStatus()),
                "after", Map.of("productionStatus", changed.productionStatus())));
    }
    private boolean allItemsComplete() { return activeItems().stream().allMatch(item -> "COMPLETED".equals(item.productionStatus())); }
    private void requireNextVersion() {
        requireWritable();
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
    public Instant paidAt() { return paidAt; }
    public String currentStageCode() { return currentStageCode; }
    public CustomerContact customer() { return customer; }
    public FulfillmentPlan fulfillment() { return fulfillment; }
    public Long totalAmountCents() { return totalAmountCents; }
    public UUID createdBy() { return createdBy; }
    public Attribution creditedEmployee() { return creditedEmployee; }
    public Instant createdAt() { return createdAt; }
    public Instant confirmedAt() { return confirmedAt; }
    public Instant updatedAt() { return updatedAt; }
    public List<OrderItem> activeItems() {
        return items.values().stream().filter(item -> !item.removed())
                .sorted(Comparator.comparing(OrderItem::createdAt).thenComparing(item -> item.itemId().toString())).toList();
    }
}

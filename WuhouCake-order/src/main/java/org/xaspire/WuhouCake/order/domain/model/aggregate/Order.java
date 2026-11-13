package org.xaspire.WuhouCake.order.domain.model.aggregate;

import java.time.Instant;
import org.xaspire.WuhouCake.order.domain.model.valobj.ItemPricing;
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
    private String orderingMethod;
    private CustomerContact customer;
    private FulfillmentPlan fulfillment;
    private Long totalAmountCents;
    private Long originalAmountCents;
    private Long memberAmountCents;
    private String paymentMethod;
    private final String pricingMode;
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
        this(id, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, paidAt, deletion, null);
    }
    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items, Attribution creditedEmployee, Instant paidAt, OrderDeletion deletion, String orderingMethod) {
        this(id, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, paidAt, deletion, orderingMethod, null, null, null);
    }
    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items, Attribution creditedEmployee, Instant paidAt, OrderDeletion deletion, String orderingMethod,
            Long originalAmountCents, Long memberAmountCents, String paymentMethod) {
        this(id, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, paidAt, deletion, orderingMethod,
                originalAmountCents, memberAmountCents, paymentMethod, "MANUAL");
    }
    public Order(UUID id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, CustomerContact customer,
            FulfillmentPlan fulfillment, Long totalAmountCents, UUID createdBy, Instant createdAt, Instant confirmedAt,
            Instant updatedAt, List<OrderItem> items, Attribution creditedEmployee, Instant paidAt, OrderDeletion deletion, String orderingMethod,
            Long originalAmountCents, Long memberAmountCents, String paymentMethod, String pricingMode) {
        this.pricingMode = ItemPricing.mode(pricingMode);
        this.originalAmountCents = money(originalAmountCents); this.memberAmountCents = money(memberAmountCents);
        this.paymentMethod = normalizePaymentMethod(paymentMethod);
        if (this.paymentMethod != null && !paymentStatus.equals(this.paymentMethod.equals("UNPAID") ? "UNPAID" : "PAID")) throw invalid();
        if ((originalAmountCents != null || memberAmountCents != null) && !Objects.equals(totalAmountCents, memberAmountCents != null ? memberAmountCents : originalAmountCents)) throw invalid();
        this.orderingMethod = normalizeOrderingMethod(orderingMethod);
        this.id = Objects.requireNonNull(id); this.orderNo = requiredText(orderNo, 32);
        this.version = nonNegativeInteger(version); this.status = Objects.requireNonNull(status); this.paymentStatus = Objects.requireNonNull(paymentStatus);
        if (currentStageCode != null || !ORDER_STATUSES.contains(status)) throw invalid();
        this.paidAt = paidAt;
        this.deletion = deletion;
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
        return new Order(id, orderNo, 0, "CAKE_BASE", "UNPAID", null, customer, fulfillment, total, actorId, now, now, now, items);
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now, Attribution creditedEmployee) {
        return new Order(id, orderNo, 0, "CAKE_BASE", "UNPAID", null, customer, fulfillment, total, actorId, now, now, now, items, creditedEmployee);
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now, Attribution creditedEmployee, String orderingMethod) {
        return new Order(id, orderNo, 0, "CAKE_BASE", "UNPAID", null, customer, fulfillment, total, actorId, now, now, now,
                items, creditedEmployee, null, null, orderingMethod);
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now, Attribution creditedEmployee, String orderingMethod,
            Long originalAmountCents, Long memberAmountCents, String paymentMethod) {
        Long original = money(originalAmountCents), member = money(memberAmountCents);
        Long effective = member != null ? member : original;
        if (original != null || member != null) {
            if (total != null && !Objects.equals(total, effective)) throw invalid();
        } else effective = money(total);
        var method = normalizePaymentMethod(paymentMethod);
        boolean paid = method != null && !method.equals("UNPAID");
        return new Order(id, orderNo, 0, "CAKE_BASE", paid ? "PAID" : "UNPAID", null, customer, fulfillment, effective,
                actorId, now, now, now, items, creditedEmployee, paid ? now : null, null, orderingMethod, original, member, method);
    }
    public static Order create(UUID id, String orderNo, CustomerContact customer, FulfillmentPlan fulfillment, Long total,
            List<OrderItem> items, UUID actorId, Instant now, Attribution employee, String orderingMethod,
            Long original, Long member, String method, String pricingMode) {
        if (ItemPricing.mode(pricingMode).equals("MANUAL"))
            return create(id, orderNo, customer, fulfillment, total, items, actorId, now, employee, orderingMethod, original, member, method);
        var totals = totals(items);
        var payment = normalizePaymentMethod(method);
        boolean paid = payment != null && !payment.equals("UNPAID");
        if (paid && totals.total() == null) throw new OrderFailure("ORDER_QUOTE_INCOMPLETE");
        return new Order(id, orderNo, 0, "CAKE_BASE", paid ? "PAID" : "UNPAID", null, customer, fulfillment, totals.total(),
                actorId, now, now, now, items, employee, paid ? now : null, null, orderingMethod,
                totals.original(), totals.member(), payment, "ITEM_SUM");
    }
    public String pricingMode() { return pricingMode; }
    private static ItemPricing.Totals totals(List<OrderItem> items) {
        return ItemPricing.calculate(items.stream().filter(item -> !item.removed())
                .map(item -> new ItemPricing.Quote(item.quantity(), item.unitPriceCents(), item.memberPriceCents())).toList());
    }
    private ItemPricing.Totals previewPrices(UUID replaced, OrderItem replacement) {
        if (!pricingMode.equals("ITEM_SUM")) return null;
        var next = new ArrayList<>(activeItems().stream().filter(item -> !item.itemId().equals(replaced)).toList());
        if (replacement != null && !replacement.removed()) next.add(replacement);
        var prices = totals(next);
        if ("PAID".equals(paymentStatus) && !Objects.equals(totalAmountCents, prices.total()))
            throw new OrderFailure("ORDER_PAID_AMOUNT_LOCKED");
        return prices;
    }
    private void applyPrices(ItemPricing.Totals prices, Map<String, Object> before, Map<String, Object> after) {
        if (prices == null) return;
        before.put("originalAmountCents", originalAmountCents); before.put("memberAmountCents", memberAmountCents);
        before.put("totalAmountCents", totalAmountCents);
        originalAmountCents = prices.original(); memberAmountCents = prices.member(); totalAmountCents = prices.total();
        after.put("originalAmountCents", originalAmountCents); after.put("memberAmountCents", memberAmountCents);
        after.put("totalAmountCents", totalAmountCents);
    }
    public Long originalAmountCents() { return originalAmountCents; }
    public Long memberAmountCents() { return memberAmountCents; }
    public String paymentMethod() { return paymentMethod; }
    private static String normalizePaymentMethod(String value) {
        if (value == null) return null;
        if (!Set.of("UNIONPAY", "MEMBER_CARD", "BANK_TRANSFER", "SERVICE_WECHAT", "CASH", "UNPAID").contains(value)) throw invalid();
        return value;
    }
    public String orderingMethod() { return orderingMethod; }
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
    private void requireEditableItems() {
        if (!PRODUCTION_STATUSES.contains(status) && !"WAITING_DELIVERY".equals(status))
            throw new OrderFailure("ORDER_NOT_EDITABLE");
    }

    private void reopenAfterItemChange(Map<String, Object> before, Map<String, Object> after) {
        if (!"WAITING_DELIVERY".equals(status)) return;
        before.put("status", status);
        after.put("status", "DECORATING");
        status = "DECORATING";
    }

    public Map<String, Object> removeItem(UUID itemId, Instant now) {
        requireWritable();
        var previous = requireItem(itemId);
        if (previous.removed()) return Map.of();
        requireEditableItems();
        if (activeItems().size() == 1) throw invalid();
        requireNextVersion();
        var prices = previewPrices(itemId, null);
        var removed = previous.remove(now);
        var before = itemValues(previous);
        var after = itemValues(removed);
        reopenAfterItemChange(before, after);
        applyPrices(prices, before, after);
        var details = JsonSnapshot.object(Map.of("before", before, "after", after));
        items.put(itemId, removed); version++; updatedAt = now;
        return details;
    }
    public Map<String, Object> addItem(OrderItem item, Instant now) {
        requireWritable();
        requireEditableItems();
        if (item == null || items.containsKey(item.itemId()) || item.removed() || !"NOT_STARTED".equals(item.productionStatus())
                || item.currentStageCode() != null) throw invalid();
        requireNextVersion();
        var before = new LinkedHashMap<String, Object>();
        var after = new LinkedHashMap<String, Object>();
        var prices = previewPrices(null, item);
        before.put("item", null);
        after.put("item", itemValues(item));
        var itemChanges = List.<Map<String, Object>>of();
        if ("WAITING_DELIVERY".equals(status)) {
            reopenAfterItemChange(before, after);
        } else if (!"CAKE_BASE".equals(status)) {
            itemChanges = updateItemStatuses("NOT_STARTED", false, now);
            before.put("status", status);
            after.put("status", "CAKE_BASE");
            status = "CAKE_BASE";
        }
        applyPrices(prices, before, after);
        items.put(item.itemId(), item);
        version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", before, "after", after, "itemChanges", itemChanges));
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
        requireEditableItems();
        if (pricingMode.equals("ITEM_SUM") && changes != null) {
            changes = new LinkedHashMap<>(changes);
            for (var field : List.of("unitPriceCents", "memberPriceCents")) {
                if (!changes.containsKey(field)) continue;
                String reference = field.equals("unitPriceCents") ? "referenceUnitPriceCents" : "referenceMemberPriceCents";
                if (changes.containsKey(reference)) throw invalid();
                changes.put(reference, changes.remove(field));
            }
        }
        var revised = previous.revise(changes, now);
        var before = new LinkedHashMap<String, Object>();
        var after = new LinkedHashMap<String, Object>();
        var previousValues = previous.businessValues();
        revised.businessValues().forEach((field, value) -> {
            if (!Objects.equals(previousValues.get(field), value)) { before.put(field, previousValues.get(field)); after.put(field, value); }
        });
        if (before.isEmpty()) return Map.of();
        if (version == Long.MAX_VALUE) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var prices = previewPrices(itemId, revised);
        boolean affectsProduction = before.keySet().stream().anyMatch(Set.of("name", "productType", "quantity", "attributes")::contains);
        if (affectsProduction) reopenAfterItemChange(before, after);
        if (affectsProduction && "COMPLETED".equals(previous.productionStatus())) {
            revised = revised.changeProductionStatus("IN_PROGRESS", now);
            before.put("productionStatus", previous.productionStatus());
            after.put("productionStatus", revised.productionStatus());
        }
        applyPrices(prices, before, after);
        items.put(itemId, revised); version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", before, "after", after));
    }
    public Map<String, Object> reviseInformation(Map<String, Object> changes, Instant now) {
        return reviseInformation(changes, now, creditedEmployee);
    }
    public Map<String, Object> reviseInformation(Map<String, Object> changes, Instant now, Attribution employee) {
        requireWritable();
        var fields = Set.of("customerName", "phone", "memberPhone", "buyerName", "fulfillmentType", "address", "requestedReceiveDate",
                "requestedReceiveAt", "plannedHandoffAt", "plannedFinishAt", "totalAmountCents", "originalAmountCents", "memberAmountCents", "creditedEmployeeId", "orderingMethod");
        if (changes == null || changes.isEmpty() || changes.keySet().stream().anyMatch(key -> key == null || !fields.contains(key))) throw invalid();
        if (pricingMode.equals("ITEM_SUM") && changes.keySet().stream().anyMatch(Set.of("totalAmountCents", "originalAmountCents", "memberAmountCents")::contains)) throw invalid();
        var previous = informationValues(customer, fulfillment, totalAmountCents);
        previous.put("originalAmountCents", originalAmountCents); previous.put("memberAmountCents", memberAmountCents);
        previous.put("orderingMethod", orderingMethod);
        previous.put("creditedEmployeeId", creditedEmployee == null ? null : creditedEmployee.accountId().toString());
        var merged = new LinkedHashMap<>(previous); merged.putAll(changes);
        var contact = new CustomerContact(text(merged.get("customerName")), text(merged.get("phone")), text(merged.get("memberPhone")), text(merged.get("buyerName")));
        FulfillmentType type;
        try { type = FulfillmentType.valueOf(text(merged.get("fulfillmentType"))); }
        catch (IllegalArgumentException | NullPointerException failure) { throw invalid(); }
        var requestedDate = date(merged.get("requestedReceiveDate"));
        var requestedAt = fulfillment.requestedReceiveAt();
        var handoffAt = fulfillment.plannedHandoffAt();
        boolean pickupChanged = changes.containsKey("plannedHandoffAt")
                ? !Objects.equals(instant(changes.get("plannedHandoffAt")), fulfillment.plannedHandoffAt())
                    || changes.get("plannedHandoffAt") == null && fulfillment.requestedReceiveAt() != null
                    || changes.containsKey("requestedReceiveAt") && !Objects.equals(instant(changes.get("requestedReceiveAt")), fulfillment.requestedReceiveAt())
                : changes.containsKey("requestedReceiveAt") && !Objects.equals(instant(changes.get("requestedReceiveAt")), fulfillment.requestedReceiveAt());
        if (pickupChanged) {
            handoffAt = instant(changes.get(changes.containsKey("plannedHandoffAt") ? "plannedHandoffAt" : "requestedReceiveAt"));
            requestedAt = handoffAt;
            if (handoffAt != null) {
                requestedDate = receiveDate(handoffAt);
                if (changes.containsKey("requestedReceiveDate") && !requestedDate.equals(date(changes.get("requestedReceiveDate")))) throw invalid();
            } else if (!changes.containsKey("requestedReceiveDate")) requestedDate = fulfillment.pickupDate();
        } else if (!Objects.equals(requestedDate, fulfillment.requestedReceiveDate())) {
            if (requestedAt != null) throw invalid();
            handoffAt = null;
        }
        var plan = new FulfillmentPlan(type, text(merged.get("address")), requestedDate, handoffAt,
                changes.containsKey("plannedFinishAt") ? instant(changes.get("plannedFinishAt")) : fulfillment.plannedFinishAt(), requestedAt);
        if (!Objects.equals(plan.pickupAt(), fulfillment.pickupAt())
                || !Objects.equals(plan.plannedFinishAt(), fulfillment.plannedFinishAt())) {
            requireFinishLeadTime(plan.pickupAt(), plan.plannedFinishAt());
        }
        Long original = originalAmountCents, member = memberAmountCents;
        Long total = totalAmountCents;
        if (changes.containsKey("originalAmountCents") || changes.containsKey("memberAmountCents")) {
            original = changes.containsKey("originalAmountCents") ? money(changes.get("originalAmountCents"))
                    : originalAmountCents == null && memberAmountCents == null ? totalAmountCents : originalAmountCents;
            member = money(merged.get("memberAmountCents"));
            total = member != null ? member : original;
            if (changes.containsKey("totalAmountCents") && !Objects.equals(money(changes.get("totalAmountCents")), total)) throw invalid();
        } else if (changes.containsKey("totalAmountCents") && !Objects.equals(money(changes.get("totalAmountCents")), totalAmountCents)) {
            if (memberAmountCents != null) throw invalid();
            total = money(changes.get("totalAmountCents")); original = total;
        }
        var before = new LinkedHashMap<String, Object>(); var after = new LinkedHashMap<String, Object>();
        if ("PAID".equals(paymentStatus) && !Objects.equals(totalAmountCents, total)) {
            throw new OrderFailure("ORDER_PAID_AMOUNT_LOCKED");
        }
        var nextMethod = normalizeOrderingMethod(merged.get("orderingMethod"));
        var nextValues = informationValues(contact, plan, total);
        nextValues.put("originalAmountCents", original); nextValues.put("memberAmountCents", member);
        nextValues.put("orderingMethod", nextMethod);
        nextValues.put("creditedEmployeeId", employee == null ? null : employee.accountId().toString());
        nextValues.forEach((field, value) -> {
            if (!Objects.equals(previous.get(field), value)) { before.put(field, previous.get(field)); after.put(field, value); }
        });
        if (before.containsKey("creditedEmployeeId")) {
            before.put("creditedEmployeeName", creditedEmployee == null ? "未归属" : creditedEmployee.nickname() + " · " + creditedEmployee.employeeNumber());
            after.put("creditedEmployeeName", employee == null ? "未归属" : employee.nickname() + " · " + employee.employeeNumber());
        }
        if (before.isEmpty()) return Map.of();
        requireNextVersion();
        var details = JsonSnapshot.object(Map.of("before", before, "after", after));
        orderingMethod = nextMethod; customer = contact; fulfillment = plan; totalAmountCents = total; originalAmountCents = original; memberAmountCents = member; creditedEmployee = employee; version++; updatedAt = now;
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
    private static String normalizeOrderingMethod(Object value) {
        return optionalText(value == null ? null : text(value).strip(), 80);
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
        return changePaymentStatus(paymentStatus, null, now);
    }
    public Map<String, Object> changePaymentStatus(String paymentStatus, String method, Instant now) {
        requireWritable();
        if (paymentStatus == null || !Set.of("UNPAID", "PAID").contains(paymentStatus)) throw invalid();
        var nextMethod = normalizePaymentMethod(method);
        if (nextMethod == null) nextMethod = this.paymentStatus.equals(paymentStatus) ? paymentMethod
                : paymentStatus.equals("UNPAID") ? (paymentMethod == null ? null : "UNPAID") : "UNPAID".equals(paymentMethod) ? null : paymentMethod;
        if (nextMethod != null && !paymentStatus.equals(nextMethod.equals("UNPAID") ? "UNPAID" : "PAID")) throw invalid();
        if (pricingMode.equals("ITEM_SUM") && paymentStatus.equals("PAID") && totalAmountCents == null) throw new OrderFailure("ORDER_QUOTE_INCOMPLETE");
        if (this.paymentStatus.equals(paymentStatus) && Objects.equals(paymentMethod, nextMethod)) return Map.of();
        requireNextVersion();
        var before = new LinkedHashMap<String, Object>(); if (totalAmountCents != null) before.put("totalAmountCents", totalAmountCents); before.put("paymentStatus", this.paymentStatus); before.put("paidAt", paidAt == null ? null : paidAt.toString()); if (!Objects.equals(paymentMethod, nextMethod)) before.put("paymentMethod", paymentMethod);
        if (!this.paymentStatus.equals(paymentStatus)) paidAt = "PAID".equals(paymentStatus) ? now : null;
        this.paymentStatus = paymentStatus; this.paymentMethod = nextMethod; version++; updatedAt = now;
        var after = new LinkedHashMap<String, Object>(); if (totalAmountCents != null) after.put("totalAmountCents", totalAmountCents); after.put("paymentStatus", paymentStatus); after.put("paidAt", paidAt == null ? null : paidAt.toString()); if (before.containsKey("paymentMethod")) after.put("paymentMethod", paymentMethod);
        return JsonSnapshot.object(Map.of("before", before, "after", after));
    }
    public Map<String, Object> applyProductionAction(String action, Instant now) {
        requireWritable();
        if (action == null) throw invalid();
        String nextStatus = switch (action) {
            case "COMPLETE_BASE" -> {
                requireProductionState(status.equals("CAKE_BASE"));
                yield "LAYER";
            }
            case "COMPLETE_LAYER" -> {
                requireProductionState(status.equals("LAYER"));
                yield "FROSTING";
            }
            case "COMPLETE_FROSTING" -> {
                requireProductionState(status.equals("FROSTING"));
                yield "DECORATING";
            }
            case "COMPLETE_DECORATION" -> {
                requireProductionState(status.equals("DECORATING"));
                if (!allItemsComplete()) throw new OrderFailure("OTHER_ITEMS_INCOMPLETE");
                yield "WAITING_DELIVERY";
            }
            case "REOPEN_PRODUCTION" -> {
                requireProductionState(status.equals("WAITING_DELIVERY"));
                yield "DECORATING";
            }
            case "ROLLBACK_PRODUCTION" -> switch (status) {
                case "LAYER" -> "CAKE_BASE";
                case "FROSTING" -> "LAYER";
                case "DECORATING" -> "FROSTING";
                default -> throw new OrderFailure("INVALID_PRODUCTION_TRANSITION");
            };
            default -> throw invalid();
        };
        return changeProduction(action, nextStatus, now);
    }
    public Map<String, Object> restartCancelled(Instant now) {
        requireWritable();
        requireProductionState(status.equals("CANCELLED"));
        return changeProduction("RESTART_CANCELLED", "CAKE_BASE", now);
    }
    private Map<String, Object> changeProduction(String action, String nextStatus, Instant now) {
        requireNextVersion();
        var before = status;
        var itemChanges = nextStatus.equals("CAKE_BASE") ? updateItemStatuses("NOT_STARTED", false, now)
                : action.equals("COMPLETE_BASE") ? updateItemStatuses("IN_PROGRESS", true, now) : List.<Map<String, Object>>of();
        status = nextStatus; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("action", action, "before", Map.of("status", before),
                "after", Map.of("status", status), "itemChanges", itemChanges, "workflowVersion", 2));
    }
    private List<Map<String, Object>> updateItemStatuses(String itemStatus, boolean onlyNotStarted, Instant now) {
        var changes = new ArrayList<Map<String, Object>>();
        for (var item : activeItems()) {
            if (onlyNotStarted && !"NOT_STARTED".equals(item.productionStatus())) continue;
            var changed = item.changeProductionStatus(itemStatus, now);
            if (changed.equals(item)) continue;
            items.put(item.itemId(), changed);
            changes.add(Map.of("itemId", item.itemId().toString(), "before", Map.of("productionStatus", item.productionStatus()),
                    "after", Map.of("productionStatus", changed.productionStatus())));
        }
        return changes;
    }
    public Map<String, Object> applyFulfillmentAction(String action, Instant now) {
        requireWritable();
        if (action == null) throw invalid();
        String nextStatus = switch (action) {
            case "COMPLETE_DELIVERY" -> {
                requireFulfillmentState(fulfillment.type() == FulfillmentType.DELIVERY && status.equals("WAITING_DELIVERY"));
                yield "COMPLETED";
            }
            case "CONFIRM_PICKUP" -> {
                requireFulfillmentState(fulfillment.type() == FulfillmentType.PICKUP && status.equals("WAITING_DELIVERY"));
                yield "COMPLETED";
            }
            case "ROLLBACK_FULFILLMENT" -> {
                requireFulfillmentState(status.equals("COMPLETED"));
                yield "WAITING_DELIVERY";
            }
            default -> throw invalid();
        };
        requireNextVersion();
        var before = status; status = nextStatus; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("action", action, "before", Map.of("status", before),
                "after", Map.of("status", status), "workflowVersion", 2));
    }
    public Map<String, Object> cancel(String reason, Instant now) {
        requireWritable();
        requiredText(reason, Integer.MAX_VALUE);
        if (!PRODUCTION_STATUSES.contains(status) && !status.equals("WAITING_DELIVERY"))
            throw new OrderFailure("ORDER_NOT_CANCELLABLE");
        requireNextVersion();
        var before = status; status = "CANCELLED"; version++; updatedAt = now;
        return JsonSnapshot.object(Map.of("before", Map.of("status", before), "after", Map.of("status", status), "workflowVersion", 2));
    }
    public Map<String, Object> completeSimpleItem(UUID itemId, boolean completed, Instant now) {
        requireWritable();
        requireProductionState(PRODUCTION_STATUSES.contains(status));
        var item = requireActiveItem(itemId);
        var changed = item.changeProductionStatus(completed ? "COMPLETED" : "IN_PROGRESS", now);
        if (changed.equals(item)) return Map.of();
        requireNextVersion();
        items.put(itemId, changed);
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
    public String currentStageCode() { return null; }
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

package org.xaspire.WuhouCake.order.api.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Customer;

public final class OrderQueryViews {
    private OrderQueryViews() { }
    public record PaymentOrder(UUID orderId, String orderNo, Instant createdAt, LocalDate calendarDate,
            Instant paidAt, String amountCents, String paymentStatus, String status, String currentStageCode) { }
    public record PaymentOrders(LocalDate date, String kind, int page, long total, List<PaymentOrder> orders) { }

    public record PaymentGroup(long orderCount, String amountCents, long missingAmountOrderCount) { }
    public record ReceiptSummary(LocalDate date, long orderCount, String amountCents, long missingAmountOrderCount) { }
    public record CakeBase(String size, String flavor, long quantity) { }
    public record CakeBaseSummary(LocalDate date, List<CakeBase> items) { }
    public record PaymentSummary(LocalDate date, long totalOrderCount, long waitingDeliveryOrderCount,
            PaymentGroup paid, PaymentGroup unpaid, long paidWithoutDateOrderCount) { }

    public record CalendarOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerPhoneLast4, List<CalendarItem> items) {
        public CalendarOrder { items = List.copyOf(items); }
    }
    public record CalendarItem(UUID itemId, String name, int quantity) { }
    public record Workbench(LocalDate date, Metrics metrics, List<PendingOrder> pendingOrders) {
        public Workbench { pendingOrders = List.copyOf(pendingOrders); }
    }
    public record Metrics(long totalOrders, long createdOnDate, long deliveryDueOnDate) { }
    public record PendingOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            Customer customer, String address, Instant plannedFinishAt, List<Item> items, Note latestNote) {
        public PendingOrder { items = List.copyOf(items); }
    }
    public record Item(UUID itemId, String name, String productType, int quantity, Long unitPriceCents,
            Long memberPriceCents, Map<String, Object> attributes, List<Note> recentNotes) {
        public Item { recentNotes = List.copyOf(recentNotes); }
    }
    public record Note(long id, UUID itemId, UUID actorId, String actorNameSnapshot, Instant createdAt, String content) { }
}

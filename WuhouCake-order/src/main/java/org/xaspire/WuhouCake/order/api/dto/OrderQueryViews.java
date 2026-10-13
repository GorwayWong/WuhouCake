package org.xaspire.WuhouCake.order.api.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Customer;

public final class OrderQueryViews {
    private OrderQueryViews() { }

    public record CalendarOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            List<CalendarItem> items) {
        public CalendarOrder { items = List.copyOf(items); }
    }
    public record CalendarItem(UUID itemId, String name, int quantity) { }
    public record Workbench(LocalDate date, Metrics metrics, List<PendingOrder> pendingOrders) {
        public Workbench { pendingOrders = List.copyOf(pendingOrders); }
    }
    public record Metrics(long totalOrders, long createdOnDate, long deliveryDueOnDate) { }
    public record PendingOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            Customer customer, String address, Instant plannedFinishAt, List<Item> items) {
        public PendingOrder { items = List.copyOf(items); }
    }
    public record Item(UUID itemId, String name, String productType, int quantity, Long unitPriceCents,
            Long memberPriceCents, Map<String, Object> attributes, List<Note> recentNotes) {
        public Item { recentNotes = List.copyOf(recentNotes); }
    }
    public record Note(long id, UUID itemId, UUID actorId, String actorNameSnapshot, Instant createdAt, String content) { }
}

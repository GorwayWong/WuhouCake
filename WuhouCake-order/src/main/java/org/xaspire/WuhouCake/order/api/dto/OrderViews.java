package org.xaspire.WuhouCake.order.api.dto;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Customer;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Fulfillment;

public final class OrderViews {
    private OrderViews() { }

    public record Detail(UUID orderId, String orderNo, long version, String status, String paymentStatus, String currentStageCode,
            Customer customer, Fulfillment fulfillment, Long totalAmountCents, UUID createdBy,
            Instant createdAt, Instant confirmedAt, Instant updatedAt, List<Item> items, Employee creditedEmployee, Instant paidAt, Deletion deletion) {
        public Detail(UUID orderId, String orderNo, long version, String status, String paymentStatus, String currentStageCode,
                Customer customer, Fulfillment fulfillment, Long totalAmountCents, UUID createdBy,
                Instant createdAt, Instant confirmedAt, Instant updatedAt, List<Item> items, Employee creditedEmployee, Instant paidAt) {
            this(orderId, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                    createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, paidAt, null);
        }
        public Detail(UUID orderId, String orderNo, long version, String status, String paymentStatus, String currentStageCode,
                Customer customer, Fulfillment fulfillment, Long totalAmountCents, UUID createdBy,
                Instant createdAt, Instant confirmedAt, Instant updatedAt, List<Item> items, Employee creditedEmployee) {
            this(orderId, orderNo, version, status, paymentStatus, currentStageCode, customer, fulfillment, totalAmountCents,
                    createdBy, createdAt, confirmedAt, updatedAt, items, creditedEmployee, null);
        }
        public Detail { items = List.copyOf(items); }
    }
    public record Employee(UUID accountId, String employeeNumber, String nickname) { }
    public record Deletion(Instant deletedAt, UUID deletedBy, String employeeName, String reason, Instant expiresAt) { }
    public record Item(UUID itemId, String name, String productType, int quantity, Long unitPriceCents, Long memberPriceCents,
            Map<String, Object> attributes, String productionStatus, String currentStageCode,
            Instant createdAt, Instant updatedAt, List<Activity> recentNotes) {
        public Item { recentNotes = List.copyOf(recentNotes); }
    }
    public record Activity(long id, UUID orderId, UUID itemId, String type, String content, Map<String, Object> details,
            UUID actorId, String actorNameSnapshot, Instant createdAt) { }
}

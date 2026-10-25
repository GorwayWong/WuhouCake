package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderQueryMapper;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public final class PostgresOrderQueries implements OrderQueries {
    @Override public long paymentOrderCount(LocalDate date, String kind, Instant from, Instant to) {
        return mapper.paymentOrderCount(date, kind, from, to);
    }
    @Override public List<PaymentOrder> paymentOrders(LocalDate date, String kind, Instant from, Instant to, long offset) {
        return mapper.paymentOrders(date, kind, from, to, offset).stream().map(row -> new PaymentOrder(
                UUID.fromString(row.orderId()), row.orderNo(), row.createdAt(), row.calendarDate(), row.paidAt(),
                row.amountCents(), row.paymentStatus(), row.status(), row.currentStageCode())).toList();
    }
    private final OrderQueryMapper mapper;
    private final JsonCodec json;
    public PostgresOrderQueries(OrderQueryMapper mapper, JsonCodec json) { this.mapper = mapper; this.json = json; }

    @Override public List<CalendarOrder> calendar(LocalDate from, LocalDate to) {
        return mapper.calendar(from, to).stream().map(row -> new CalendarOrder(UUID.fromString(row.orderId()), row.orderNo(),
                row.calendarDate(), row.status(), row.currentStageCode(), row.paymentStatus(), row.fulfillmentType(), row.plannedHandoffAt(), row.customerPhoneLast4())).toList();
    }
    @Override public List<PendingOrder> pending(LocalDate date) {
        return mapper.pending(date).stream().map(row -> new PendingOrder(UUID.fromString(row.orderId()), row.orderNo(),
                row.calendarDate(), row.status(), row.currentStageCode(), row.paymentStatus(), row.fulfillmentType(), row.plannedHandoffAt(),
                row.customerName(), row.phone(), row.memberPhone(), row.buyerName(), row.address(), row.plannedFinishAt())).toList();
    }
    @Override public List<CalendarItem> calendarItems(List<UUID> orderIds) {
        if (orderIds.isEmpty()) return List.of();
        return mapper.calendarItems(ids(orderIds)).stream().map(row -> new CalendarItem(UUID.fromString(row.orderId()),
                UUID.fromString(row.itemId()), row.name(), row.quantity())).toList();
    }
    @Override public List<Item> items(List<UUID> orderIds) {
        if (orderIds.isEmpty()) return List.of();
        return mapper.items(ids(orderIds)).stream().map(row -> new Item(UUID.fromString(row.orderId()), UUID.fromString(row.itemId()),
                row.name(), row.productType(), row.quantity(), row.unitPriceCents(), row.memberPriceCents(),
                CakeSpecifications.effective(row.productType(), JsonSnapshot.object(json.read(row.attributes(), Map.class))))).toList();
    }
    @Override public List<Note> recentNotes(List<UUID> orderIds, List<UUID> itemIds) {
        if (orderIds.isEmpty() || itemIds.isEmpty()) return List.of();
        return mapper.recentNotes(ids(orderIds), ids(itemIds)).stream().map(row -> new Note(row.id(), UUID.fromString(row.itemId()),
                UUID.fromString(row.actorId()), row.actorNameSnapshot(), row.createdAt(), row.content())).toList();
    }
    @Override public List<OrderNote> latestNotes(List<UUID> orderIds) {
        if (orderIds.isEmpty()) return List.of();
        return mapper.latestNotes(ids(orderIds)).stream().map(row -> new OrderNote(UUID.fromString(row.orderId()),
                new Note(row.id(), row.itemId() == null ? null : UUID.fromString(row.itemId()), UUID.fromString(row.actorId()),
                        row.actorNameSnapshot(), row.createdAt(), row.content()))).toList();
    }
    @Override public Metrics metrics(LocalDate date, Instant createdFrom, Instant createdTo) {
        var row = mapper.metrics(date, createdFrom, createdTo);
        return new Metrics(row.totalOrders(), row.createdOnDate(), row.deliveryDueOnDate());
    }
    @Override public PaymentSummary paymentSummary(LocalDate date) {
        var row = mapper.paymentSummary(date);
        return new PaymentSummary(row.totalOrderCount(), row.waitingDeliveryOrderCount(),
                row.paidOrderCount(), row.paidAmountCents(), row.paidMissingAmountOrderCount(),
                row.unpaidOrderCount(), row.unpaidAmountCents(), row.unpaidMissingAmountOrderCount(), row.paidWithoutDateOrderCount());
    }
    private static List<String> ids(List<UUID> ids) { return ids.stream().map(UUID::toString).toList(); }
    @Override public ReceiptSummary receiptSummary(Instant from, Instant to) {
        var row = mapper.receiptSummary(from, to);
        return new ReceiptSummary(row.orderCount(), row.amountCents(), row.missingAmountOrderCount());
    }
    @Override public List<CakeBase> cakeBases(LocalDate date) {
        return mapper.cakeBases(date).stream().map(row -> new CakeBase(row.size(), row.flavor(), row.quantity())).toList();
    }
}

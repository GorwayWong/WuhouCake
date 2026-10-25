package org.xaspire.WuhouCake.order.application.service;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Customer;
import org.xaspire.WuhouCake.order.api.dto.OrderQueryViews;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public class OrderQueryService {
    private static final ZoneId STORE_ZONE = ZoneId.of("Asia/Shanghai");
    private final OrderQueries queries;
    public OrderQueryService(OrderQueries queries) { this.queries = queries; }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.PaymentOrders paymentOrders(LocalDate date, String kind, int page) {
        if (date == null || kind == null || !Set.of("RECEIPT", "SHIPPING_PAID", "SHIPPING_UNPAID").contains(kind) || page < 1) throw invalid();
        Instant from, to;
        try {
            from = date.atStartOfDay(STORE_ZONE).toInstant();
            to = date.plusDays(1).atStartOfDay(STORE_ZONE).toInstant();
        } catch (DateTimeException failure) { throw invalid(); }
        long total = queries.paymentOrderCount(date, kind, from, to);
        int current = (int) Math.min(page, Math.max(1, (total + 9) / 10));
        var rows = queries.paymentOrders(date, kind, from, to, (current - 1L) * 10).stream()
                .map(row -> new OrderQueryViews.PaymentOrder(row.orderId(), row.orderNo(), row.createdAt(), row.calendarDate(),
                        row.paidAt(), row.amountCents(), row.paymentStatus(), row.status(), row.currentStageCode())).toList();
        return new OrderQueryViews.PaymentOrders(date, kind, current, total, rows);
    }

    @Transactional(readOnly = true)
    public OrderQueryViews.ReceiptSummary receiptSummary(LocalDate date) {
        if (date == null) throw invalid();
        var result = queries.receiptSummary(date.atStartOfDay(STORE_ZONE).toInstant(), date.plusDays(1).atStartOfDay(STORE_ZONE).toInstant());
        return new OrderQueryViews.ReceiptSummary(date, result.orderCount(), result.amountCents(), result.missingAmountOrderCount());
    }
    @Transactional(readOnly = true)
    public OrderQueryViews.CakeBaseSummary cakeBases(LocalDate date) {
        if (date == null) throw invalid();
        return new OrderQueryViews.CakeBaseSummary(date, queries.cakeBases(date).stream()
                .map(row -> new OrderQueryViews.CakeBase(row.size(), row.flavor(), row.quantity())).toList());
    }

    @Transactional(readOnly = true)
    public OrderQueryViews.PaymentSummary paymentSummary(LocalDate date) {
        if (date == null) throw invalid();
        var summary = queries.paymentSummary(date);
        return new OrderQueryViews.PaymentSummary(date, summary.totalOrderCount(), summary.waitingDeliveryOrderCount(),
                new OrderQueryViews.PaymentGroup(summary.paidOrderCount(), summary.paidAmountCents(), summary.paidMissingAmountOrderCount()),
                new OrderQueryViews.PaymentGroup(summary.unpaidOrderCount(), summary.unpaidAmountCents(), summary.unpaidMissingAmountOrderCount()), summary.paidWithoutDateOrderCount());
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<OrderQueryViews.CalendarOrder> calendar(LocalDate from, LocalDate to) {
        if (from == null || to == null || !from.isBefore(to) || ChronoUnit.DAYS.between(from, to) > 42) throw invalid();
        var orders = queries.calendar(from, to);
        if (orders.isEmpty()) return List.of();
        var items = queries.calendarItems(orders.stream().map(OrderQueries.CalendarOrder::orderId).toList()).stream()
                .collect(Collectors.groupingBy(OrderQueries.CalendarItem::orderId,
                        Collectors.mapping(item -> new OrderQueryViews.CalendarItem(item.itemId(), item.name(), item.quantity()), Collectors.toList())));
        return orders.stream().map(order -> new OrderQueryViews.CalendarOrder(order.orderId(), order.orderNo(), order.calendarDate(),
                order.status(), order.currentStageCode(), order.paymentStatus(), order.fulfillmentType(), order.plannedHandoffAt(),
                order.customerPhoneLast4(), items.getOrDefault(order.orderId(), List.of()))).toList();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.Workbench workbench(LocalDate date) {
        return workbench(date, true);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.Workbench workbench(LocalDate date, boolean includeMetrics) {
        if (date == null) throw invalid();
        Instant from, to;
        try {
            from = date.atStartOfDay(STORE_ZONE).toInstant();
            to = date.plusDays(1).atStartOfDay(STORE_ZONE).toInstant();
        } catch (DateTimeException failure) { throw invalid(); }
        var metrics = includeMetrics ? queries.metrics(date, from, to) : null;
        var orders = queries.pending(date);
        var orderIds = orders.stream().map(OrderQueries.PendingOrder::orderId).toList();
        var latestNotes = orderIds.isEmpty() ? Map.<UUID, OrderQueryViews.Note>of()
                : queries.latestNotes(orderIds).stream().collect(Collectors.toMap(OrderQueries.OrderNote::orderId, entry -> {
                    var note = entry.note();
                    return new OrderQueryViews.Note(note.id(), note.itemId(), note.actorId(), note.actorNameSnapshot(), note.createdAt(), note.content());
                }));
        var items = orderIds.isEmpty() ? List.<OrderQueries.Item>of() : queries.items(orderIds);
        var notes = items.isEmpty() ? List.<OrderQueries.Note>of()
                : queries.recentNotes(orderIds, items.stream().map(OrderQueries.Item::itemId).toList());
        var notesByItem = notes.stream().collect(Collectors.groupingBy(OrderQueries.Note::itemId,
                Collectors.mapping(note -> new OrderQueryViews.Note(note.id(), note.itemId(), note.actorId(), note.actorNameSnapshot(),
                        note.createdAt(), note.content()), Collectors.toList())));
        var itemsByOrder = items.stream().collect(Collectors.groupingBy(OrderQueries.Item::orderId,
                Collectors.mapping(item -> new OrderQueryViews.Item(item.itemId(), item.name(), item.productType(), item.quantity(),
                        item.unitPriceCents(), item.memberPriceCents(), item.attributes(), notesByItem.getOrDefault(item.itemId(), List.of())), Collectors.toList())));
        var pending = orders.stream().map(order -> new OrderQueryViews.PendingOrder(order.orderId(), order.orderNo(), order.calendarDate(),
                order.status(), order.currentStageCode(), order.paymentStatus(), order.fulfillmentType(), order.plannedHandoffAt(),
                new Customer(order.customerName(), order.phone(), order.memberPhone(), order.buyerName()), order.address(), order.plannedFinishAt(),
                itemsByOrder.getOrDefault(order.orderId(), List.of()), latestNotes.get(order.orderId()))).toList();
        return new OrderQueryViews.Workbench(date, metrics == null ? null
                : new OrderQueryViews.Metrics(metrics.totalOrders(), metrics.createdOnDate(), metrics.deliveryDueOnDate()), pending);
    }
}

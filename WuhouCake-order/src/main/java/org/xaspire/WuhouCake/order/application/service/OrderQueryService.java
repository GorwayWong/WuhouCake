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
    public List<OrderQueryViews.CalendarOrder> calendar(LocalDate from, LocalDate to) {
        if (from == null || to == null || !from.isBefore(to) || ChronoUnit.DAYS.between(from, to) > 42) throw invalid();
        var orders = queries.calendar(from, to);
        if (orders.isEmpty()) return List.of();
        var items = queries.calendarItems(orders.stream().map(OrderQueries.CalendarOrder::orderId).toList()).stream()
                .collect(Collectors.groupingBy(OrderQueries.CalendarItem::orderId,
                        Collectors.mapping(item -> new OrderQueryViews.CalendarItem(item.itemId(), item.name(), item.quantity()), Collectors.toList())));
        return orders.stream().map(order -> new OrderQueryViews.CalendarOrder(order.orderId(), order.orderNo(), order.calendarDate(),
                order.status(), order.currentStageCode(), order.paymentStatus(), order.fulfillmentType(), order.plannedHandoffAt(),
                items.getOrDefault(order.orderId(), List.of()))).toList();
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
                itemsByOrder.getOrDefault(order.orderId(), List.of()))).toList();
        return new OrderQueryViews.Workbench(date, metrics == null ? null
                : new OrderQueryViews.Metrics(metrics.totalOrders(), metrics.createdOnDate(), metrics.deliveryDueOnDate()), pending);
    }
}

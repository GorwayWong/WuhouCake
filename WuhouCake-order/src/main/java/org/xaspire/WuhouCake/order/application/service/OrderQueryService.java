package org.xaspire.WuhouCake.order.application.service;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Customer;
import org.xaspire.WuhouCake.order.api.dto.OrderQueryViews;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.PRODUCTION_STATUSES;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public class OrderQueryService {
    private static final ZoneId STORE_ZONE = ZoneId.of("Asia/Shanghai");
    private final OrderQueries queries;
    private final Clock clock;

    public OrderQueryService(OrderQueries queries, Clock clock) {
        this.queries = queries;
        this.clock = clock;
    }

    private static final int PRODUCTION_PAGE_SIZE = 20;

    @Transactional(readOnly = true)
    public OrderQueryViews.ProductionSummary productionSummary(LocalDate from, LocalDate to, String stage) {
        if (!productionDate(from) || !productionDate(to) || !from.isBefore(to) || ChronoUnit.DAYS.between(from, to) > 42) throw invalid();
        var counts = new HashMap<LocalDate, Long>();
        for (var row : queries.productionCounts(storeDayStart(from), storeDayStart(to), productionStages(stage))) {
            counts.put(row.date(), row.orderCount());
        }
        var days = from.datesUntil(to).map(date -> new OrderQueryViews.ProductionDay(date, counts.getOrDefault(date, 0L))).toList();
        return new OrderQueryViews.ProductionSummary(days.stream().mapToLong(OrderQueryViews.ProductionDay::orderCount).sum(),
                counts.getOrDefault(null, 0L), days);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.ProductionOrders productionOrders(LocalDate date, boolean unscheduled, String stage, int page) {
        if (page < 1 || (unscheduled ? date != null : !productionDate(date))) throw invalid();
        var stages = productionStages(stage);
        Instant from = unscheduled ? null : storeDayStart(date);
        Instant to = unscheduled ? null : storeDayStart(date.plusDays(1));
        long total = queries.productionOrderCount(from, to, stages);
        int current = (int) Math.min(page, total == 0 ? 1 : 1 + (total - 1) / PRODUCTION_PAGE_SIZE);
        var orders = total == 0 ? List.<OrderQueryViews.ProductionOrder>of()
                : queries.productionOrders(from, to, stages, PRODUCTION_PAGE_SIZE, (current - 1L) * PRODUCTION_PAGE_SIZE).stream()
                        .map(row -> new OrderQueryViews.ProductionOrder(row.orderId(), row.orderNo(), row.itemName(),
                                row.status(), row.plannedFinishAt(), row.pickupAt(), row.pickupDate())).toList();
        return new OrderQueryViews.ProductionOrders(current, total, orders);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.ProductionReminders productionReminders() {
        var now = clock.instant();
        var date = now.atZone(STORE_ZONE).toLocalDate();
        return new OrderQueryViews.ProductionReminders(date,
                queries.countScheduledProduction(now, storeDayStart(date.plusDays(1)), PRODUCTION_STATUSES),
                queries.countScheduledProduction(null, now, PRODUCTION_STATUSES));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.ProductionReminderOrders productionReminderOrders(String group, int page) {
        if (page < 1 || !Set.of("today", "overdue").contains(group)) throw invalid();
        var now = clock.instant();
        var date = now.atZone(STORE_ZONE).toLocalDate();
        boolean overdue = "overdue".equals(group);
        var from = overdue ? null : now;
        var to = overdue ? now : storeDayStart(date.plusDays(1));
        long total = queries.countScheduledProduction(from, to, PRODUCTION_STATUSES);
        int current = (int) Math.min(page, total == 0 ? 1 : 1 + (total - 1) / PRODUCTION_PAGE_SIZE);
        var rows = total == 0 ? List.<OrderQueries.PendingOrder>of()
                : queries.scheduledProduction(from, to, PRODUCTION_STATUSES, PRODUCTION_PAGE_SIZE, (current - 1L) * PRODUCTION_PAGE_SIZE);
        return new OrderQueryViews.ProductionReminderOrders(date, current, total, pendingViews(rows));
    }

    private static Set<String> productionStages(String stage) {
        if (stage == null) return PRODUCTION_STATUSES;
        if (!PRODUCTION_STATUSES.contains(stage)) throw invalid();
        return Set.of(stage);
    }

    private static boolean productionDate(LocalDate date) {
        return date != null && date.getYear() >= 1 && date.getYear() <= 9999;
    }

    private static Instant storeDayStart(LocalDate date) {
        return date.atStartOfDay(STORE_ZONE).toInstant();
    }

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
                        row.paidAt(), row.amountCents(), row.paymentStatus(), row.status(), row.currentStageCode(), row.fulfillmentType())).toList();
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
    public List<OrderQueryViews.CalendarDay> calendar(LocalDate from, LocalDate to) {
        if (from == null || to == null || !from.isBefore(to) || ChronoUnit.DAYS.between(from, to) > 42) throw invalid();
        return queries.calendar(from, to).stream().map(row -> new OrderQueryViews.CalendarDay(
                row.calendarDate(), row.orderCount(), row.unfinishedCount(), row.firstOrderId(), row.firstItemName(), row.customerPhoneLast4())).toList();
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
        var budget = queries.workbenchBudget(date);
        if (budget.orders() > 100 || budget.bytes() > 4 * 1024 * 1024) throw new OrderFailure("WORKBENCH_RESULT_TOO_LARGE");
        var metrics = includeMetrics ? queries.metrics(date, from, to) : null;
        return new OrderQueryViews.Workbench(date, metrics == null ? null
                : new OrderQueryViews.Metrics(metrics.totalOrders(), metrics.createdOnDate(), metrics.deliveryDueOnDate()),
                pendingViews(queries.pending(date)));
    }

    private static final int CARD_PAGE_SIZE = 50;

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderQueryViews.WorkbenchCards cards(LocalDate date, String status, String paymentStatus,
            String fulfillmentType, String view, String cursor, UUID focusOrderId, boolean showPayment, boolean showPhone, boolean showAddress) {
        if (!productionDate(date)
                || view != null && !"delivery".equals(view)
                || status != null && !org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.ORDER_STATUSES.contains(status)
                || fulfillmentType != null && !Set.of("DELIVERY", "PICKUP").contains(fulfillmentType)
                || paymentStatus != null && !Set.of("PAID", "UNPAID").contains(paymentStatus)) throw invalid();
        if (paymentStatus != null && !showPayment) throw new OrderFailure("FORBIDDEN");

        var filter = new OrderQueries.CardFilter(date, status, paymentStatus, fulfillmentType, "delivery".equals(view), showAddress);
        var rows = queries.cards(filter, cardPosition(filter, cursor), null, CARD_PAGE_SIZE + 1);
        var visible = rows.stream().limit(CARD_PAGE_SIZE).map(row -> card(row, date, showPayment, showPhone)).toList();
        var focus = focusOrderId == null || cursor != null || visible.stream().anyMatch(row -> row.orderId().equals(focusOrderId))
                ? null : queries.cards(filter, null, focusOrderId, 1).stream().findFirst()
                        .map(row -> card(row, date, showPayment, showPhone)).orElse(null);
        var counts = queries.cardCounts(filter);
        var groups = Map.of("pending", counts.pending(), "completed", counts.completed(),
                "cancelled", counts.cancelled(), "unknown", counts.unknown());
        String next = rows.size() > CARD_PAGE_SIZE ? encodePosition(filter, rows.get(CARD_PAGE_SIZE - 1)) : null;
        return new OrderQueryViews.WorkbenchCards(date, visible, focus, next,
                counts.pending() + counts.completed() + counts.cancelled() + counts.unknown(), groups,
                new OrderQueryViews.OperationalCounts(counts.totalOrderCount(), counts.waitingDeliveryOrderCount()));
    }

    private static OrderQueryViews.Card card(OrderQueries.Card row, LocalDate date, boolean showPayment, boolean showPhone) {
        var first = row.firstItemId() == null ? null : new OrderQueryViews.CardItem(row.firstItemId(), row.firstItemName(),
                row.firstProductType(), row.firstAttributes());
        return new OrderQueryViews.Card(row.orderId(), row.orderNo(), date, row.status(), showPayment ? row.paymentStatus() : null,
                row.fulfillmentType(), row.pickupAt(), row.plannedFinishAt(), row.itemCount(), row.quantity(), first, row.latestNote(), showPhone ? row.customerPhone() : null,
                row.deliveryAddressPreview());
    }

    private static String encodePosition(OrderQueries.CardFilter filter, OrderQueries.Card row) {
        var raw = cursorScope(filter) + "\n" + Objects.toString(row.pickupAt(), "") + "\n" + row.orderNo() + "\n" + row.orderId();
        if (filter.deliveryView()) raw += "COMPLETED".equals(row.status()) ? "\n1" : "\n0";
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static OrderQueries.CardPosition cardPosition(OrderQueries.CardFilter filter, String cursor) {
        if (cursor == null) return null;
        if (cursor.length() > 512) throw invalid();
        try {
            var fields = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8).split("\n", -1);
            if (fields.length != (filter.deliveryView() ? 5 : 4) || !fields[0].equals(cursorScope(filter))
                    || fields[2].isBlank() || fields[2].length() > 32
                    || filter.deliveryView() && !Set.of("0", "1").contains(fields[4]))
                throw invalid();
            var pickup = fields[1].isEmpty() ? null : Instant.parse(fields[1]);
            if (pickup != null && !pickup.atZone(STORE_ZONE).toLocalDate().equals(filter.date())) throw invalid();
            return new OrderQueries.CardPosition(pickup, fields[2], UUID.fromString(fields[3]),
                    filter.deliveryView() && "1".equals(fields[4]));
        } catch (IllegalArgumentException | DateTimeException failure) { throw invalid(); }
    }

    private static String cursorScope(OrderQueries.CardFilter filter) {
        return filter.date() + "|" + Objects.toString(filter.status(), "") + "|" + Objects.toString(filter.paymentStatus(), "")
                + (filter.fulfillmentType() == null ? "" : "|" + filter.fulfillmentType())
                + (filter.deliveryView() ? "|delivery" : "");
    }

    private List<OrderQueryViews.PendingOrder> pendingViews(List<OrderQueries.PendingOrder> orders) {
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
        return orders.stream().map(order -> new OrderQueryViews.PendingOrder(order.orderId(), order.orderNo(), order.calendarDate(),
                order.status(), order.currentStageCode(), order.paymentStatus(), order.fulfillmentType(), order.plannedHandoffAt(),
                new Customer(order.customerName(), order.phone(), order.memberPhone(), order.buyerName()), order.address(), order.plannedFinishAt(),
                itemsByOrder.getOrDefault(order.orderId(), List.of()), latestNotes.get(order.orderId()), order.requestedReceiveAt())).toList();
    }
}

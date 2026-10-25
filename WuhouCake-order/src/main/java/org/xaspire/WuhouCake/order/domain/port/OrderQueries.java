package org.xaspire.WuhouCake.order.domain.port;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/** 订单只读投影；批量结果保留日期、交接时间、订单号或商品创建顺序。 */
public interface OrderQueries {
    long paymentOrderCount(LocalDate date, String kind, Instant from, Instant to);
    List<PaymentOrder> paymentOrders(LocalDate date, String kind, Instant from, Instant to, long offset);
    record PaymentOrder(UUID orderId, String orderNo, Instant createdAt, LocalDate calendarDate,
            Instant paidAt, String amountCents, String paymentStatus, String status, String currentStageCode) { }
    List<CalendarOrder> calendar(LocalDate from, LocalDate to);
    List<PendingOrder> pending(LocalDate date);
    List<CalendarItem> calendarItems(List<UUID> orderIds);
    List<Item> items(List<UUID> orderIds);
    /** 按商品独立取三条 NOTE，以 createdAt、id 倒序返回，不含订单级备注。 */
    List<Note> recentNotes(List<UUID> orderIds, List<UUID> itemIds);
    /** 每单取整单及有效商品中最新的一条 NOTE，以 createdAt、id 倒序确定。 */
    List<OrderNote> latestNotes(List<UUID> orderIds);
    Metrics metrics(LocalDate date, Instant createdFrom, Instant createdTo);
    PaymentSummary paymentSummary(LocalDate date);
    ReceiptSummary receiptSummary(Instant from, Instant to);
    List<CakeBase> cakeBases(LocalDate date);
    record ReceiptSummary(long orderCount, String amountCents, long missingAmountOrderCount) { }
    record CakeBase(String size, String flavor, long quantity) { }

    record PaymentSummary(long totalOrderCount, long waitingDeliveryOrderCount,
            long paidOrderCount, String paidAmountCents, long paidMissingAmountOrderCount,
            long unpaidOrderCount, String unpaidAmountCents, long unpaidMissingAmountOrderCount, long paidWithoutDateOrderCount) { }

    record CalendarOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt, String customerPhoneLast4) { }
    record PendingOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerName, String phone, String memberPhone, String buyerName, String address, Instant plannedFinishAt) { }
    record CalendarItem(UUID orderId, UUID itemId, String name, int quantity) { }
    record Item(UUID orderId, UUID itemId, String name, String productType, int quantity, Long unitPriceCents,
            Long memberPriceCents, Map<String, Object> attributes) { }
    record Note(long id, UUID itemId, UUID actorId, String actorNameSnapshot, Instant createdAt, String content) { }
    record OrderNote(UUID orderId, Note note) { }
    record Metrics(long totalOrders, long createdOnDate, long deliveryDueOnDate) { }
}

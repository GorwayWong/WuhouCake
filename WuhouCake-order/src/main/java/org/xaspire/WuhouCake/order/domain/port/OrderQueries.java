package org.xaspire.WuhouCake.order.domain.port;

import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

/** 订单只读投影；批量结果保留日期、交接时间、订单号或商品创建顺序。 */
public interface OrderQueries {
    List<CalendarOrder> calendar(LocalDate from, LocalDate to);
    List<PendingOrder> pending(LocalDate date);
    List<CalendarItem> calendarItems(List<UUID> orderIds);
    List<Item> items(List<UUID> orderIds);
    /** 按商品独立取三条 NOTE，以 createdAt、id 倒序返回，不含订单级备注。 */
    List<Note> recentNotes(List<UUID> orderIds, List<UUID> itemIds);
    Metrics metrics(LocalDate date, Instant createdFrom, Instant createdTo);

    record CalendarOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt) { }
    record PendingOrder(UUID orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerName, String phone, String memberPhone, String buyerName, String address, Instant plannedFinishAt) { }
    record CalendarItem(UUID orderId, UUID itemId, String name, int quantity) { }
    record Item(UUID orderId, UUID itemId, String name, String productType, int quantity, Long unitPriceCents,
            Long memberPriceCents, Map<String, Object> attributes) { }
    record Note(long id, UUID itemId, UUID actorId, String actorNameSnapshot, Instant createdAt, String content) { }
    record Metrics(long totalOrders, long createdOnDate, long deliveryDueOnDate) { }
}

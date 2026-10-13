package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderQueryMapper {
    record CalendarRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt) { }
    record PendingRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerName, String phone, String memberPhone, String buyerName, String address, Instant plannedFinishAt) { }
    record CalendarItemRow(String orderId, String itemId, String name, int quantity) { }
    record ItemRow(String orderId, String itemId, String name, String productType, int quantity,
            Long unitPriceCents, Long memberPriceCents, String attributes) { }
    record NoteRow(long id, String itemId, String actorId, String actorNameSnapshot, Instant createdAt, String content) { }
    record MetricsRow(long totalOrders, long createdOnDate, long deliveryDueOnDate) { }

    String ORDER_COLUMNS = "id::text AS order_id, order_no, requested_receive_date AS calendar_date, status,"
            + " current_stage_code, payment_status, fulfillment_type, planned_handoff_at";
    String ORDER_SORT = " ORDER BY requested_receive_date, planned_handoff_at, order_no";
    String ORDER_IDS = "<foreach collection='orderIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";
    String ITEM_IDS = "<foreach collection='itemIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";

    @Select("SELECT " + ORDER_COLUMNS + " FROM cake_order WHERE requested_receive_date >= #{from} AND requested_receive_date < #{to}" + ORDER_SORT)
    List<CalendarRow> calendar(@Param("from") LocalDate from, @Param("to") LocalDate to);

    @Select("SELECT " + ORDER_COLUMNS + ", customer_name, customer_phone AS phone, member_phone, buyer_name,"
            + " delivery_address AS address, planned_finish_at FROM cake_order WHERE requested_receive_date=#{date}"
            + " AND status NOT IN ('COMPLETED', 'CANCELLED')" + ORDER_SORT)
    List<PendingRow> pending(LocalDate date);

    @Select("<script>SELECT order_id::text, id::text AS item_id, name, quantity FROM cake_order_item"
            + " WHERE NOT is_removed AND order_id IN " + ORDER_IDS + " ORDER BY order_id, created_at, id</script>")
    List<CalendarItemRow> calendarItems(@Param("orderIds") List<String> orderIds);

    @Select("<script>SELECT order_id::text, id::text AS item_id, name, product_type, quantity, unit_price_cents, member_price_cents,"
            + " attributes::text FROM cake_order_item WHERE NOT is_removed AND order_id IN " + ORDER_IDS
            + " ORDER BY order_id, created_at, id</script>")
    List<ItemRow> items(@Param("orderIds") List<String> orderIds);

    @Select("<script>SELECT id, item_id::text, actor_id::text, actor_name_snapshot, created_at, content FROM ("
            + " SELECT id, item_id, actor_id, actor_name_snapshot, created_at, content,"
            + " row_number() OVER (PARTITION BY item_id ORDER BY created_at DESC, id DESC) AS note_rank"
            + " FROM cake_order_activity WHERE type='NOTE' AND order_id IN " + ORDER_IDS + " AND item_id IN " + ITEM_IDS
            + ") AS notes WHERE note_rank &lt;= 3 ORDER BY created_at DESC, id DESC</script>")
    List<NoteRow> recentNotes(@Param("orderIds") List<String> orderIds, @Param("itemIds") List<String> itemIds);

    @Select("SELECT count(*) AS total_orders,"
            + " count(*) FILTER (WHERE created_at >= #{createdFrom} AND created_at < #{createdTo}) AS created_on_date,"
            + " count(*) FILTER (WHERE requested_receive_date=#{date} AND fulfillment_type='DELIVERY'"
            + " AND status NOT IN ('COMPLETED', 'CANCELLED')) AS delivery_due_on_date FROM cake_order")
    MetricsRow metrics(@Param("date") LocalDate date, @Param("createdFrom") Instant createdFrom, @Param("createdTo") Instant createdTo);
}

package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import static org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderTimeSql.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.apache.ibatis.annotations.*;

public interface OrderQueryMapper {
    record ProductionDayRow(LocalDate date, long orderCount) { }
    record ProductionOrderRow(String orderId, String orderNo, String itemName, String status,
            Instant plannedFinishAt, Instant pickupAt, LocalDate pickupDate) { }

    String PRODUCTION_WHERE = " FROM cake_order WHERE deleted_at IS NULL AND status IN "
            + "<foreach collection='stages' item='stage' open='(' separator=',' close=')'>#{stage}</foreach>";
    String FINISH_RANGE = "planned_finish_at &gt;= #{from} AND planned_finish_at &lt; #{to}";
    String PRODUCTION_BUCKET = " AND <choose><when test='from == null'>planned_finish_at IS NULL</when><otherwise>"
            + FINISH_RANGE + "</otherwise></choose>";

    @Select("<script>SELECT (planned_finish_at AT TIME ZONE 'Asia/Shanghai')::date AS date, count(*) AS order_count"
            + PRODUCTION_WHERE + " AND (planned_finish_at IS NULL OR (" + FINISH_RANGE + ")) GROUP BY 1</script>")
    List<ProductionDayRow> productionCounts(@Param("from") Instant from, @Param("to") Instant to, @Param("stages") Set<String> stages);

    @Select("<script>SELECT count(*)" + PRODUCTION_WHERE + PRODUCTION_BUCKET + "</script>")
    long productionOrderCount(@Param("from") Instant from, @Param("to") Instant to, @Param("stages") Set<String> stages);

    @Select("<script>SELECT id::text AS order_id, order_no,"
            + " (SELECT i.name FROM cake_order_item i WHERE i.order_id=cake_order.id AND NOT i.is_removed ORDER BY i.created_at,i.id LIMIT 1) AS item_name,"
            + " status, planned_finish_at, " + PICKUP_AT + " AS pickup_at, " + PICKUP_DATE + " AS pickup_date"
            + PRODUCTION_WHERE + PRODUCTION_BUCKET
            + " ORDER BY <choose><when test='from == null'>pickup_date, pickup_at NULLS LAST</when>"
            + "<otherwise>planned_finish_at</otherwise></choose>, order_no, id LIMIT #{limit} OFFSET #{offset}</script>")
    List<ProductionOrderRow> productionOrders(@Param("from") Instant from, @Param("to") Instant to,
            @Param("stages") Set<String> stages, @Param("limit") int limit, @Param("offset") long offset);

    record PaymentOrderRow(String orderId, String orderNo, Instant createdAt, LocalDate calendarDate,
            Instant paidAt, String amountCents, String paymentStatus, String status, String currentStageCode) { }
    String PAYMENT_WHERE = " FROM cake_order WHERE deleted_at IS NULL AND <choose><when test=\"kind == 'RECEIPT'\">"
            + "payment_status='PAID' AND paid_at &gt;= #{from} AND paid_at &lt; #{to}"
            + "</when><otherwise>" + PICKUP_DATE + "=#{date} AND status&lt;&gt;'CANCELLED'"
            + " AND fulfillment_type IN ('PICKUP','DELIVERY') AND payment_status="
            + "<choose><when test=\"kind == 'SHIPPING_PAID'\">'PAID'</when><otherwise>'UNPAID'</otherwise></choose>"
            + "</otherwise></choose>";
    @Select("<script>SELECT count(*)" + PAYMENT_WHERE + "</script>")
    long paymentOrderCount(@Param("date") LocalDate date, @Param("kind") String kind, @Param("from") Instant from, @Param("to") Instant to);
    @Select("<script>SELECT id::text AS order_id, order_no, created_at, " + PICKUP_DATE + " AS calendar_date,"
            + " paid_at, total_amount_cents::text AS amount_cents, payment_status, status, current_stage_code" + PAYMENT_WHERE
            + " ORDER BY <choose><when test=\"kind == 'RECEIPT'\">paid_at DESC, order_no</when>"
            + "<otherwise>" + PICKUP_AT + " NULLS LAST, order_no</otherwise></choose> LIMIT 10 OFFSET #{offset}</script>")
    List<PaymentOrderRow> paymentOrders(@Param("date") LocalDate date, @Param("kind") String kind,
            @Param("from") Instant from, @Param("to") Instant to, @Param("offset") long offset);
    record CalendarRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt, String customerPhoneLast4) { }
    record PendingRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerName, String phone, String memberPhone, String buyerName, String address, Instant plannedFinishAt, Instant requestedReceiveAt) { }
    record CalendarItemRow(String orderId, String itemId, String name, int quantity) { }
    record ItemRow(String orderId, String itemId, String name, String productType, int quantity,
            Long unitPriceCents, Long memberPriceCents, String attributes) { }
    record NoteRow(long id, String itemId, String actorId, String actorNameSnapshot, Instant createdAt, String content) { }
    record OrderNoteRow(String orderId, long id, String itemId, String actorId, String actorNameSnapshot, Instant createdAt, String content) { }
    record MetricsRow(long totalOrders, long createdOnDate, long deliveryDueOnDate) { }
    record ReceiptSummaryRow(long orderCount, String amountCents, long missingAmountOrderCount) { }
    record CakeBaseRow(String size, String flavor, long quantity) { }
    record PaymentSummaryRow(long totalOrderCount, long waitingDeliveryOrderCount,
            long paidOrderCount, String paidAmountCents, long paidMissingAmountOrderCount,
            long unpaidOrderCount, String unpaidAmountCents, long unpaidMissingAmountOrderCount, long paidWithoutDateOrderCount) { }
    record ContentSizeRow(long bytes, long rows) { }

    String ORDER_COLUMNS = "id::text AS order_id, order_no, " + PICKUP_DATE + " AS calendar_date, status,"
            + " current_stage_code, payment_status, fulfillment_type, " + PICKUP_AT + " AS planned_handoff_at";
    String ORDER_SORT = " ORDER BY " + PICKUP_DATE + ", " + PICKUP_AT + ", order_no";
    String ORDER_IDS = "<foreach collection='orderIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";
    String ITEM_IDS = "<foreach collection='itemIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";

    @Select("SELECT " + ORDER_COLUMNS + ", RIGHT(customer_phone, 4) AS customer_phone_last4 FROM cake_order WHERE deleted_at IS NULL AND " + PICKUP_DATE + " >= #{from} AND " + PICKUP_DATE + " < #{to}" + ORDER_SORT)
    List<CalendarRow> calendar(@Param("from") LocalDate from, @Param("to") LocalDate to);

    @Select("<script>SELECT id::text FROM cake_order WHERE deleted_at IS NULL AND " + PICKUP_DATE + " &gt;= #{from} AND " + PICKUP_DATE + " &lt; #{to}"
            + "<if test='status != null'> AND status=#{status}</if>"
            + "<if test='fulfillmentType != null'> AND fulfillment_type=#{fulfillmentType}</if>"
            + "<if test='paymentStatus != null'> AND payment_status=#{paymentStatus}</if>" + ORDER_SORT + " LIMIT #{limit}</script>")
    List<String> exportIds(@Param("from") LocalDate from, @Param("to") LocalDate to, @Param("status") String status,
            @Param("fulfillmentType") String fulfillmentType, @Param("paymentStatus") String paymentStatus, @Param("limit") int limit);

    @Select("<script>WITH selected_orders AS (SELECT * FROM cake_order WHERE id IN " + ORDER_IDS + "),"
            + " loaded_items AS (SELECT * FROM cake_order_item WHERE order_id IN " + ORDER_IDS + "),"
            + " selected_notes AS (SELECT * FROM (SELECT a.*, row_number() OVER"
            + " (PARTITION BY order_id, item_id ORDER BY created_at DESC, id DESC) AS note_rank"
            + " FROM cake_order_activity a WHERE type='NOTE' AND order_id IN " + ORDER_IDS
            + ") n WHERE item_id IS NULL OR note_rank &lt;= 3)"
            + " SELECT (SELECT COALESCE(sum(octet_length(row_to_json(o)::text)),0) FROM selected_orders o)"
            + " + (SELECT COALESCE(sum(octet_length(row_to_json(i)::text)),0) FROM loaded_items i)"
            + " + (SELECT COALESCE(sum(octet_length(row_to_json(n)::text)),0) FROM selected_notes n) AS bytes,"
            + " (SELECT count(*) FROM loaded_items) + (SELECT count(*) FROM selected_notes) AS rows</script>")
    ContentSizeRow exportContentSize(@Param("orderIds") List<String> orderIds);

    String PENDING_COLUMNS = ORDER_COLUMNS + ", customer_name, customer_phone AS phone, member_phone, buyer_name,"
            + " delivery_address AS address, planned_finish_at, requested_receive_at";
    String SCHEDULED_PRODUCTION = PRODUCTION_WHERE + " AND planned_finish_at &lt; #{to}"
            + "<if test='from != null'> AND planned_finish_at &gt;= #{from}</if>";

    @Select("<script>SELECT count(*)" + SCHEDULED_PRODUCTION + "</script>")
    long countScheduledProduction(@Param("from") Instant from, @Param("to") Instant to, @Param("stages") Set<String> stages);

    @Select("<script>SELECT " + PENDING_COLUMNS + SCHEDULED_PRODUCTION
            + " ORDER BY planned_finish_at, order_no, id LIMIT #{limit} OFFSET #{offset}</script>")
    List<PendingRow> scheduledProduction(@Param("from") Instant from, @Param("to") Instant to,
            @Param("stages") Set<String> stages, @Param("limit") int limit, @Param("offset") long offset);

    @Select("SELECT " + PENDING_COLUMNS + " FROM cake_order WHERE deleted_at IS NULL AND " + PICKUP_DATE + "=#{date}"
            + ORDER_SORT)
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

    @Select("<script>SELECT DISTINCT ON (a.order_id) a.order_id::text,a.id,a.item_id::text,a.actor_id::text,a.actor_name_snapshot,a.created_at,a.content"
            + " FROM cake_order_activity a LEFT JOIN cake_order_item i ON i.id=a.item_id AND i.order_id=a.order_id"
            + " WHERE a.type='NOTE' AND a.order_id IN " + ORDER_IDS
            + " AND (a.item_id IS NULL OR NOT i.is_removed) ORDER BY a.order_id,a.created_at DESC,a.id DESC</script>")
    List<OrderNoteRow> latestNotes(@Param("orderIds") List<String> orderIds);

    @Select("SELECT count(*) AS total_orders,"
            + " count(*) FILTER (WHERE created_at >= #{createdFrom} AND created_at < #{createdTo}) AS created_on_date,"
            + " count(*) FILTER (WHERE " + PICKUP_DATE + "=#{date} AND fulfillment_type='DELIVERY'"
            + " AND status NOT IN ('COMPLETED', 'CANCELLED')) AS delivery_due_on_date FROM cake_order WHERE deleted_at IS NULL")
    MetricsRow metrics(@Param("date") LocalDate date, @Param("createdFrom") Instant createdFrom, @Param("createdTo") Instant createdTo);

    @Select("SELECT count(*) AS total_order_count,"
            + " count(*) FILTER (WHERE status='WAITING_DELIVERY' AND fulfillment_type='DELIVERY') AS waiting_delivery_order_count,"
            + " count(*) FILTER (WHERE payment_status='PAID') AS paid_order_count,"
            + " COALESCE(sum(total_amount_cents) FILTER (WHERE payment_status='PAID'),0)::text AS paid_amount_cents,"
            + " count(*) FILTER (WHERE payment_status='PAID' AND total_amount_cents IS NULL) AS paid_missing_amount_order_count,"
            + " count(*) FILTER (WHERE payment_status='UNPAID') AS unpaid_order_count,"
            + " COALESCE(sum(total_amount_cents) FILTER (WHERE payment_status='UNPAID'),0)::text AS unpaid_amount_cents,"
            + " count(*) FILTER (WHERE payment_status='UNPAID' AND total_amount_cents IS NULL) AS unpaid_missing_amount_order_count,"
            + " count(*) FILTER (WHERE payment_status='PAID' AND paid_at IS NULL) AS paid_without_date_order_count"
            + " FROM cake_order WHERE deleted_at IS NULL AND " + PICKUP_DATE + "=#{date} AND status<>'CANCELLED' AND fulfillment_type IN ('PICKUP','DELIVERY')")
    PaymentSummaryRow paymentSummary(LocalDate date);

    @Select("SELECT count(*) AS order_count, COALESCE(sum(total_amount_cents),0)::text AS amount_cents,"
            + " count(*) FILTER (WHERE total_amount_cents IS NULL) AS missing_amount_order_count"
            + " FROM cake_order WHERE deleted_at IS NULL AND payment_status='PAID' AND paid_at>=#{from} AND paid_at<#{to}")
    ReceiptSummaryRow receiptSummary(@Param("from") Instant from, @Param("to") Instant to);

    @Select("SELECT cake_size_inches(i.attributes)::text AS size,"
            + " COALESCE(NULLIF(btrim(i.attributes->>'base'),''),NULLIF(btrim(i.attributes->>'cakeBase'),''),'原味') AS flavor,"
            + " sum(i.quantity)::bigint AS quantity FROM cake_order o JOIN cake_order_item i ON i.order_id=o.id"
            + " WHERE o.deleted_at IS NULL AND " + ORDER_PICKUP_DATE + "=#{date} AND o.status<>'CANCELLED' AND NOT i.is_removed AND upper(i.product_type)='CAKE'"
            + " GROUP BY cake_size_inches(i.attributes), COALESCE(NULLIF(btrim(i.attributes->>'base'),''),NULLIF(btrim(i.attributes->>'cakeBase'),''),'原味')"
            + " ORDER BY cake_size_inches(i.attributes) NULLS LAST, flavor")
    List<CakeBaseRow> cakeBases(LocalDate date);
}

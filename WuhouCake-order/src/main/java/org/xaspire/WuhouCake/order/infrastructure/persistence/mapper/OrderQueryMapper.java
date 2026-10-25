package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderQueryMapper {
    record PaymentOrderRow(String orderId, String orderNo, Instant createdAt, LocalDate calendarDate,
            Instant paidAt, String amountCents, String paymentStatus, String status, String currentStageCode) { }
    String PAYMENT_WHERE = " FROM cake_order WHERE deleted_at IS NULL AND <choose><when test=\"kind == 'RECEIPT'\">"
            + "payment_status='PAID' AND paid_at &gt;= #{from} AND paid_at &lt; #{to}"
            + "</when><otherwise>requested_receive_date=#{date} AND status&lt;&gt;'CANCELLED'"
            + " AND fulfillment_type IN ('PICKUP','DELIVERY') AND payment_status="
            + "<choose><when test=\"kind == 'SHIPPING_PAID'\">'PAID'</when><otherwise>'UNPAID'</otherwise></choose>"
            + "</otherwise></choose>";
    @Select("<script>SELECT count(*)" + PAYMENT_WHERE + "</script>")
    long paymentOrderCount(@Param("date") LocalDate date, @Param("kind") String kind, @Param("from") Instant from, @Param("to") Instant to);
    @Select("<script>SELECT id::text AS order_id, order_no, created_at, requested_receive_date AS calendar_date,"
            + " paid_at, total_amount_cents::text AS amount_cents, payment_status, status, current_stage_code" + PAYMENT_WHERE
            + " ORDER BY <choose><when test=\"kind == 'RECEIPT'\">paid_at DESC, order_no</when>"
            + "<otherwise>planned_handoff_at NULLS LAST, order_no</otherwise></choose> LIMIT 10 OFFSET #{offset}</script>")
    List<PaymentOrderRow> paymentOrders(@Param("date") LocalDate date, @Param("kind") String kind,
            @Param("from") Instant from, @Param("to") Instant to, @Param("offset") long offset);
    record CalendarRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt, String customerPhoneLast4) { }
    record PendingRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerName, String phone, String memberPhone, String buyerName, String address, Instant plannedFinishAt) { }
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

    String ORDER_COLUMNS = "id::text AS order_id, order_no, requested_receive_date AS calendar_date, status,"
            + " current_stage_code, payment_status, fulfillment_type, planned_handoff_at";
    String ORDER_SORT = " ORDER BY requested_receive_date, planned_handoff_at, order_no";
    String ORDER_IDS = "<foreach collection='orderIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";
    String ITEM_IDS = "<foreach collection='itemIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";

    @Select("SELECT " + ORDER_COLUMNS + ", RIGHT(customer_phone, 4) AS customer_phone_last4 FROM cake_order WHERE deleted_at IS NULL AND requested_receive_date >= #{from} AND requested_receive_date < #{to}" + ORDER_SORT)
    List<CalendarRow> calendar(@Param("from") LocalDate from, @Param("to") LocalDate to);

    @Select("<script>SELECT id::text FROM cake_order WHERE deleted_at IS NULL AND requested_receive_date &gt;= #{from} AND requested_receive_date &lt; #{to}"
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

    @Select("SELECT " + ORDER_COLUMNS + ", customer_name, customer_phone AS phone, member_phone, buyer_name,"
            + " delivery_address AS address, planned_finish_at FROM cake_order WHERE deleted_at IS NULL AND requested_receive_date=#{date}"
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
            + " count(*) FILTER (WHERE requested_receive_date=#{date} AND fulfillment_type='DELIVERY'"
            + " AND status NOT IN ('COMPLETED', 'CANCELLED')) AS delivery_due_on_date FROM cake_order WHERE deleted_at IS NULL")
    MetricsRow metrics(@Param("date") LocalDate date, @Param("createdFrom") Instant createdFrom, @Param("createdTo") Instant createdTo);

    @Select("SELECT count(*) AS total_order_count,"
            + " count(*) FILTER (WHERE status='WAITING_DELIVERY') AS waiting_delivery_order_count,"
            + " count(*) FILTER (WHERE payment_status='PAID') AS paid_order_count,"
            + " COALESCE(sum(total_amount_cents) FILTER (WHERE payment_status='PAID'),0)::text AS paid_amount_cents,"
            + " count(*) FILTER (WHERE payment_status='PAID' AND total_amount_cents IS NULL) AS paid_missing_amount_order_count,"
            + " count(*) FILTER (WHERE payment_status='UNPAID') AS unpaid_order_count,"
            + " COALESCE(sum(total_amount_cents) FILTER (WHERE payment_status='UNPAID'),0)::text AS unpaid_amount_cents,"
            + " count(*) FILTER (WHERE payment_status='UNPAID' AND total_amount_cents IS NULL) AS unpaid_missing_amount_order_count,"
            + " count(*) FILTER (WHERE payment_status='PAID' AND paid_at IS NULL) AS paid_without_date_order_count"
            + " FROM cake_order WHERE deleted_at IS NULL AND requested_receive_date=#{date} AND status<>'CANCELLED' AND fulfillment_type IN ('PICKUP','DELIVERY')")
    PaymentSummaryRow paymentSummary(LocalDate date);

    @Select("SELECT count(*) AS order_count, COALESCE(sum(total_amount_cents),0)::text AS amount_cents,"
            + " count(*) FILTER (WHERE total_amount_cents IS NULL) AS missing_amount_order_count"
            + " FROM cake_order WHERE deleted_at IS NULL AND payment_status='PAID' AND paid_at>=#{from} AND paid_at<#{to}")
    ReceiptSummaryRow receiptSummary(@Param("from") Instant from, @Param("to") Instant to);

    @Select("SELECT cake_size_inches(i.attributes)::text AS size,"
            + " COALESCE(NULLIF(btrim(i.attributes->>'base'),''),NULLIF(btrim(i.attributes->>'cakeBase'),''),'原味') AS flavor,"
            + " sum(i.quantity)::bigint AS quantity FROM cake_order o JOIN cake_order_item i ON i.order_id=o.id"
            + " WHERE o.deleted_at IS NULL AND o.requested_receive_date=#{date} AND o.status<>'CANCELLED' AND NOT i.is_removed AND upper(i.product_type)='CAKE'"
            + " GROUP BY cake_size_inches(i.attributes), COALESCE(NULLIF(btrim(i.attributes->>'base'),''),NULLIF(btrim(i.attributes->>'cakeBase'),''),'原味')"
            + " ORDER BY cake_size_inches(i.attributes) NULLS LAST, flavor")
    List<CakeBaseRow> cakeBases(LocalDate date);
}

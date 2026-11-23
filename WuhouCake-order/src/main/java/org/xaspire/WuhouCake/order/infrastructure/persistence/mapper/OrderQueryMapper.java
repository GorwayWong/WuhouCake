package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import static org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderTimeSql.*;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.apache.ibatis.annotations.*;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries.CardFilter;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries.CardPosition;

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
            + " (SELECT i.name FROM cake_order_item i WHERE i.order_id=cake_order.id AND NOT i.is_removed ORDER BY i.position NULLS LAST,i.created_at,i.id LIMIT 1) AS item_name,"
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
    record CalendarRow(LocalDate calendarDate, long orderCount, long unfinishedCount,
            String firstOrderId, String firstItemName, String customerPhoneLast4) { }
    record PendingRow(String orderId, String orderNo, LocalDate calendarDate, String status,
            String currentStageCode, String paymentStatus, String fulfillmentType, Instant plannedHandoffAt,
            String customerName, String phone, String memberPhone, String buyerName, String address, Instant plannedFinishAt, Instant requestedReceiveAt) { }
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

    String PENDING_STATUSES = "('CAKE_BASE','LAYER','FROSTING','DECORATING','WAITING_DELIVERY')";
    String ORDER_COLUMNS = "id::text AS order_id, order_no, " + PICKUP_DATE + " AS calendar_date, status,"
            + " current_stage_code, payment_status, fulfillment_type, " + PICKUP_AT + " AS planned_handoff_at";
    String ORDER_SORT = " ORDER BY " + PICKUP_DATE + ", " + PICKUP_AT + ", order_no";
    String ORDER_IDS = "<foreach collection='orderIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";
    String ITEM_IDS = "<foreach collection='itemIds' item='id' open='(' separator=',' close=')'>CAST(#{id} AS uuid)</foreach>";

    @Select("WITH days AS (SELECT DISTINCT ON (" + PICKUP_DATE + ") " + PICKUP_DATE + " AS calendar_date,"
            + " id, RIGHT(customer_phone,4) AS customer_phone_last4, count(*) OVER day AS order_count,"
            + " count(*) FILTER (WHERE status IN " + PENDING_STATUSES + ") OVER day AS unfinished_count"
            + " FROM cake_order WHERE deleted_at IS NULL AND " + PICKUP_DATE + " >= #{from} AND " + PICKUP_DATE + " < #{to}"
            + " WINDOW day AS (PARTITION BY " + PICKUP_DATE + ")" + ORDER_SORT + ")"
            + " SELECT calendar_date,order_count,unfinished_count,id::text AS first_order_id,(SELECT name FROM cake_order_item WHERE order_id=days.id"
            + " AND NOT is_removed ORDER BY position NULLS LAST,created_at,id LIMIT 1) AS first_item_name,customer_phone_last4"
            + " FROM days ORDER BY calendar_date")
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

    record WorkbenchBudgetRow(long orders, long bytes) { }
    record CardCountsRow(long pending, long completed, long cancelled, long unknown,
            long totalOrderCount, long waitingDeliveryOrderCount) { }
    record CardRow(String orderId, String orderNo, String status, String paymentStatus, String fulfillmentType,
            Instant pickupAt, Instant plannedFinishAt, long itemCount, long quantity, String firstItemId, String firstItemName,
            String firstProductType, String firstAttributes, String latestNote, String customerPhone, String deliveryAddressPreview) { }

    @Select("WITH selected AS MATERIALIZED (SELECT id FROM cake_order WHERE deleted_at IS NULL AND " + PICKUP_DATE + "=#{date} LIMIT 101),"
            + " live_items AS (SELECT i.id,i.order_id,octet_length(i.attributes::text)+octet_length(i.name)+256 AS bytes"
            + " FROM cake_order_item i JOIN selected s ON s.id=i.order_id WHERE NOT i.is_removed)"
            + " SELECT count(*) AS orders,CASE WHEN count(*)>100 THEN 0 ELSE"
            + " (SELECT COALESCE(sum(octet_length(row_to_json(o)::text)+256),0) FROM cake_order o JOIN selected s2 ON s2.id=o.id)"
            + " + (SELECT COALESCE(sum(bytes),0) FROM live_items)"
            + " + (SELECT COALESCE(sum(n.bytes),0) FROM live_items i CROSS JOIN LATERAL"
            + " (SELECT octet_length(content)+256 AS bytes FROM cake_order_activity"
            + " WHERE type='NOTE' AND order_id=i.order_id AND item_id=i.id ORDER BY created_at DESC,id DESC LIMIT 3) n)"
            + " + (SELECT COALESCE(sum(n.bytes),0) FROM selected s2 CROSS JOIN LATERAL"
            + " (SELECT octet_length(a.content)+256 AS bytes FROM cake_order_activity a"
            + " LEFT JOIN cake_order_item i ON i.id=a.item_id AND i.order_id=a.order_id"
            + " WHERE a.type='NOTE' AND a.order_id=s2.id AND (a.item_id IS NULL OR NOT i.is_removed)"
            + " ORDER BY a.created_at DESC,a.id DESC LIMIT 1) n) END AS bytes FROM selected")
    WorkbenchBudgetRow workbenchBudget(LocalDate date);

    String CARD_MATCH = " COALESCE(o.status=#{filter.status},true) AND COALESCE(o.payment_status=#{filter.paymentStatus},true)"
            + " AND COALESCE(o.fulfillment_type=#{filter.fulfillmentType},true)"
            + " AND (NOT #{filter.deliveryView} OR (o.fulfillment_type='DELIVERY'"
            + " AND (o.status IN " + PENDING_STATUSES + " OR o.status='COMPLETED')))";
    String CARD_DAY = " FROM cake_order o WHERE o.deleted_at IS NULL AND " + ORDER_PICKUP_DATE + "=#{filter.date}";
    @Select("WITH daily AS (SELECT o.status,o.fulfillment_type,(" + CARD_MATCH + ") AS matches" + CARD_DAY + ")"
            + " SELECT count(*) FILTER (WHERE matches AND status IN " + PENDING_STATUSES + ") AS pending,"
            + " count(*) FILTER (WHERE matches AND status='COMPLETED') AS completed,"
            + " count(*) FILTER (WHERE matches AND status='CANCELLED') AS cancelled,"
            + " count(*) FILTER (WHERE matches AND status NOT IN " + PENDING_STATUSES + " AND status NOT IN ('COMPLETED','CANCELLED')) AS unknown,"
            + " count(*) FILTER (WHERE status<>'CANCELLED') AS total_order_count,"
            + " count(*) FILTER (WHERE status='WAITING_DELIVERY' AND fulfillment_type='DELIVERY') AS waiting_delivery_order_count FROM daily")
    CardCountsRow cardCounts(@Param("filter") CardFilter filter);

    String CARD_PICKUP_SORT = "COALESCE(" + ORDER_PICKUP_AT + ",'infinity'::timestamptz)";
    String CARD_DELIVERY_SORT = "<if test='filter.deliveryView'>(o.status='COMPLETED'),</if>";
    @Select("<script>WITH selected AS MATERIALIZED (SELECT o.id,o.order_no,o.status,o.payment_status,o.fulfillment_type,o.customer_phone,"
            + " CASE WHEN #{filter.showAddress} AND o.fulfillment_type='DELIVERY' THEN left(o.delivery_address,120) END AS delivery_address_preview,"
            + ORDER_PICKUP_AT + " AS pickup_at,o.planned_finish_at" + CARD_DAY + " AND " + CARD_MATCH
            + "<if test='onlyOrder != null'> AND o.id=CAST(#{onlyOrder} AS uuid)</if>"
            + "<if test='after != null'> AND (" + CARD_DELIVERY_SORT + CARD_PICKUP_SORT + ",o.order_no,o.id)"
            + " &gt; (<if test='filter.deliveryView'>#{after.delivered},</if>"
            + " COALESCE(CAST(#{after.pickupAt} AS timestamptz),'infinity'::timestamptz),#{after.orderNo},CAST(#{after.orderId} AS uuid))</if>"
            + " ORDER BY " + CARD_DELIVERY_SORT + CARD_PICKUP_SORT + ",o.order_no,o.id LIMIT #{limit})"
            + " SELECT o.id::text AS order_id,o.order_no,o.status,o.payment_status,o.fulfillment_type,o.pickup_at,o.planned_finish_at,"
            + " counts.item_count,counts.quantity,first_item.id::text AS first_item_id,first_item.name AS first_item_name,"
            + " first_item.product_type AS first_product_type,COALESCE(preview.attributes,'{}'::jsonb)::text AS first_attributes,"
            + " CASE WHEN note.content IS NULL OR octet_length(note.content)&lt;=4096 THEN note.content ELSE '打开订单查看全文' END AS latest_note,o.customer_phone,o.delivery_address_preview"
            + " FROM selected o"
            + " CROSS JOIN LATERAL (SELECT count(*) AS item_count,COALESCE(sum(quantity),0) AS quantity"
            + " FROM cake_order_item WHERE order_id=o.id AND NOT is_removed) counts"
            + " LEFT JOIN LATERAL (SELECT id,name,product_type,attributes FROM cake_order_item"
            + " WHERE order_id=o.id AND NOT is_removed ORDER BY position NULLS LAST,created_at,id LIMIT 1) first_item ON true"
            + " LEFT JOIN LATERAL (SELECT jsonb_object_agg(k, CASE WHEN octet_length((first_item.attributes-&gt;k)::text)&lt;=4096"
            + " THEN first_item.attributes-&gt;k ELSE to_jsonb('打开订单查看全文'::text) END) AS attributes"
            + " FROM unnest(CASE WHEN upper(btrim(first_item.product_type))='CAKE' THEN ARRAY['size','base','cakeBase']"
            + " ELSE ARRAY['specification'] END) AS keys(k) WHERE jsonb_exists(first_item.attributes,k)) preview ON true"
            + " LEFT JOIN LATERAL (SELECT a.content FROM cake_order_activity a"
            + " LEFT JOIN cake_order_item i ON i.id=a.item_id AND i.order_id=a.order_id"
            + " WHERE a.order_id=o.id AND a.type='NOTE' AND (a.item_id IS NULL OR NOT i.is_removed)"
            + " ORDER BY a.created_at DESC,a.id DESC LIMIT 1) note ON true"
            + " ORDER BY " + CARD_DELIVERY_SORT + "o.pickup_at NULLS LAST,o.order_no,o.id</script>")
    List<CardRow> cards(@Param("filter") CardFilter filter,
            @Param("after") CardPosition after,
            @Param("onlyOrder") String onlyOrder, @Param("limit") int limit);


    @Select("<script>SELECT order_id::text, id::text AS item_id, name, product_type, quantity, unit_price_cents, member_price_cents,"
            + " attributes::text FROM cake_order_item WHERE NOT is_removed AND order_id IN " + ORDER_IDS
            + " ORDER BY order_id, position NULLS LAST, created_at, id</script>")
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

    @Select("SELECT cake_size_text(i.attributes) AS size,"
            + " COALESCE(NULLIF(btrim(i.attributes->>'base'),''),NULLIF(btrim(i.attributes->>'cakeBase'),''),'原味') AS flavor,"
            + " sum(i.quantity)::bigint AS quantity FROM cake_order o JOIN cake_order_item i ON i.order_id=o.id"
            + " WHERE o.deleted_at IS NULL AND " + ORDER_PICKUP_DATE + "=#{date} AND o.status<>'CANCELLED' AND NOT i.is_removed AND upper(i.product_type)='CAKE'"
            + " GROUP BY cake_size_text(i.attributes), COALESCE(NULLIF(btrim(i.attributes->>'base'),''),NULLIF(btrim(i.attributes->>'cakeBase'),''),'原味')"
            + " ORDER BY cake_size_text(i.attributes) NULLS LAST, flavor")
    List<CakeBaseRow> cakeBases(LocalDate date);
}

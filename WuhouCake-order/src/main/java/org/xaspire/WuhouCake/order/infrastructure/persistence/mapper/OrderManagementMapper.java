package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.util.List;
import org.apache.ibatis.annotations.*;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.*;

public interface OrderManagementMapper {
    String ITEM_MATCH = "<if test='filter.size != null'> AND upper(i.product_type)='CAKE' AND cake_size_inches(i.attributes)=CAST(#{filter.size} AS numeric)</if>";
    String AMOUNTS = "COALESCE(sum(o.total_amount_cents),0)::text AS total_amount_cents,"
            + " COALESCE(sum(o.total_amount_cents) FILTER (WHERE o.payment_status='PAID'),0)::text AS paid_amount_cents,"
            + " COALESCE(sum(o.total_amount_cents) FILTER (WHERE o.payment_status='UNPAID'),0)::text AS unpaid_amount_cents,"
            + " count(*) FILTER (WHERE o.total_amount_cents IS NULL) AS missing_amount_orders";
    String SOURCE = " FROM cake_order o LEFT JOIN LATERAL (SELECT COALESCE(sum(i.quantity),0) AS quantity,"
            + " COALESCE(sum(i.quantity) FILTER (WHERE upper(i.product_type)='CAKE'),0) AS cakes,"
            + " COALESCE(sum(i.quantity) FILTER (WHERE upper(i.product_type)='CAKE' AND cake_size_inches(i.attributes) IS NULL),0) AS unknown_size,"
            + " string_agg(i.name || ' ×' || i.quantity || CASE WHEN i.attributes->>'size' IS NULL THEN '' ELSE '（' || (i.attributes->>'size') || '）' END, '、' ORDER BY i.created_at,i.id) AS products"
            + " FROM cake_order_item i WHERE i.order_id=o.id AND NOT i.is_removed"
            + ITEM_MATCH + ") p ON TRUE WHERE "
            + "<choose><when test='filter.deleted'>o.deleted_at IS NOT NULL AND o.deleted_at &gt; CURRENT_TIMESTAMP - INTERVAL '720 hours' AND o.deleted_at &gt;= (CAST(#{filter.from} AS date)::timestamp AT TIME ZONE 'Asia/Shanghai') AND o.deleted_at &lt; (CAST(#{filter.to} AS date)::timestamp AT TIME ZONE 'Asia/Shanghai')</when>"
            + "<otherwise>o.deleted_at IS NULL</otherwise></choose> AND "
            + "<choose><when test='filter.deleted or filter.allUnpaid'>1=1</when><when test='filter.dateBasis == \"CREATED\"'>o.created_at &gt;= (CAST(#{filter.from} AS date)::timestamp AT TIME ZONE 'Asia/Shanghai') AND o.created_at &lt; (CAST(#{filter.to} AS date)::timestamp AT TIME ZONE 'Asia/Shanghai')</when>"
            + "<otherwise>o.requested_receive_date &gt;= #{filter.from} AND o.requested_receive_date &lt; #{filter.to}</otherwise></choose>"
            + "<if test='filter.status != null'> AND o.status=#{filter.status}</if>"
            + "<if test='filter.status == null and !filter.includeCancelled'> AND o.status&lt;&gt;'CANCELLED'</if>"
            + "<if test='filter.paymentStatus != null'> AND o.payment_status=#{filter.paymentStatus}</if>"
            + "<if test='filter.fulfillmentType != null'> AND o.fulfillment_type=#{filter.fulfillmentType}</if>"
            + "<if test='filter.creditedEmployeeId != null'> AND o.credited_employee_id=CAST(#{filter.creditedEmployeeId} AS uuid)</if>"
            + "<if test='filter.unassigned'> AND o.credited_employee_id IS NULL</if>"
            + "<if test='filter.size != null'> AND p.quantity&gt;0</if>"
            + "<if test='filter.keyword != null'> AND (position(#{filter.keyword} IN o.order_no)&gt;0 OR position(#{filter.keyword} IN o.customer_phone)&gt;0 OR position(#{filter.keyword} IN COALESCE(o.customer_name,''))&gt;0)</if>";
    @Select("<script>SELECT o.id::text AS order_id,o.order_no,o.requested_receive_date AS receive_date,o.status,o.payment_status,"
            + " o.customer_phone AS phone,o.customer_name,o.credited_employee_number AS employee_number,o.credited_employee_name AS employee_name,"
            + " o.created_by::text,o.total_amount_cents,p.quantity AS matching_quantity,p.cakes AS cake_quantity,p.products,"
            + " (SELECT COALESCE(jsonb_agg(DISTINCT upper(COALESCE(category.product_type,'')) ORDER BY upper(COALESCE(category.product_type,''))),'[]'::jsonb)::text"
            + " FROM cake_order_item category WHERE category.order_id=o.id AND NOT category.is_removed) AS product_types" + SOURCE
            + "<choose><when test='filter.allUnpaid'> ORDER BY o.created_at ASC,o.order_no ASC,o.id ASC</when><otherwise> ORDER BY o.requested_receive_date,o.planned_handoff_at,o.order_no,o.id</otherwise></choose> LIMIT #{limit} OFFSET #{offset}</script>")
    List<Row> search(@Param("filter") Filter filter, @Param("limit") int limit, @Param("offset") long offset);
    @Select("<script>SELECT count(*)" + SOURCE + "</script>")
    long count(@Param("filter") Filter filter);
    @Select("<script>SELECT count(*) AS order_count,COALESCE(sum(p.quantity),0) AS matching_quantity,COALESCE(sum(p.cakes),0) AS cake_quantity,"
            + " COALESCE(sum(p.unknown_size),0) AS unclassified_cake_quantity," + AMOUNTS + SOURCE + "</script>")
    Totals totals(@Param("filter") Filter filter);
    @Select("<script>SELECT cake_size_inches(i.attributes)::text AS size,count(DISTINCT selected.id) AS order_count,sum(i.quantity) AS cake_quantity"
            + " FROM (SELECT o.id" + SOURCE + ") selected JOIN cake_order_item i ON i.order_id=selected.id"
            + " WHERE NOT i.is_removed AND upper(i.product_type)='CAKE'" + ITEM_MATCH
            + " GROUP BY cake_size_inches(i.attributes) ORDER BY cake_size_inches(i.attributes) NULLS LAST</script>")
    List<SizeSummary> sizes(@Param("filter") Filter filter);
    @Select("<script>SELECT o.credited_employee_id::text AS employee_id,"
            + " (array_agg(o.credited_employee_number ORDER BY o.created_at DESC,o.id))[1] AS employee_number,"
            + " (array_agg(o.credited_employee_name ORDER BY o.created_at DESC,o.id))[1] AS employee_name,"
            + " count(*) AS order_count,COALESCE(sum(p.quantity),0) AS matching_quantity,COALESCE(sum(p.cakes),0) AS cake_quantity,"
            + AMOUNTS + SOURCE + " GROUP BY o.credited_employee_id ORDER BY employee_number NULLS LAST,o.credited_employee_id</script>")
    List<EmployeeSummary> employees(@Param("filter") Filter filter);
    @Select("<script>SELECT selected.order_no,i.name,i.product_type,i.quantity::bigint AS quantity,i.attributes->>'size' AS size,"
            + " i.attributes->>'flavor' AS flavor,CASE WHEN upper(i.product_type)='CAKE' THEN COALESCE(NULLIF(btrim(i.attributes->>'base'),''),'原味') ELSE i.attributes->>'base' END AS base,"
            + " CASE WHEN upper(i.product_type)='CAKE' THEN COALESCE(NULLIF(btrim(i.attributes->>'filling'),''),'芒果') ELSE i.attributes->>'filling' END AS filling,"
            + " i.attributes->>'message' AS message,i.attributes->>'requirements' AS requirements,i.unit_price_cents,i.member_price_cents"
            + " FROM (SELECT o.id,o.order_no,o.requested_receive_date" + SOURCE + ") selected JOIN cake_order_item i ON i.order_id=selected.id"
            + " WHERE NOT i.is_removed" + ITEM_MATCH + " ORDER BY selected.requested_receive_date,selected.order_no,i.created_at,i.id LIMIT #{limit}</script>")
    List<ProductRow> products(@Param("filter") Filter filter, @Param("limit") int limit);
}

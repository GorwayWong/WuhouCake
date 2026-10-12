package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderMapper {
    record Row(String id, String orderNo, long version, String status, String paymentStatus, String currentStageCode, String customerName,
            String customerPhone, String memberPhone, String buyerName, String fulfillmentType, String deliveryAddress,
            LocalDate requestedReceiveDate, Instant plannedHandoffAt, Instant plannedFinishAt, Long totalAmountCents,
            String createdBy, Instant createdAt, Instant confirmedAt, Instant updatedAt) { }
    record ItemRow(String id, String orderId, String name, String productType, int quantity, Long unitPriceCents,
            Long memberPriceCents, String attributes, String productionStatus, String currentStageCode,
            boolean removed, Instant createdAt, Instant updatedAt) { }

    @Select("SELECT nextval('cake_order_no_seq')") long nextNumber();
    @Select("SELECT id::text, order_no, version, status, payment_status, current_stage_code, customer_name, customer_phone, member_phone, buyer_name,"
            + " fulfillment_type, delivery_address, requested_receive_date, planned_handoff_at, planned_finish_at, total_amount_cents,"
            + " created_by::text, created_at, confirmed_at, updated_at FROM cake_order WHERE id=CAST(#{id} AS uuid)")
    Row find(String id);
    @Select("SELECT id::text, order_id::text, name, product_type, quantity, unit_price_cents, member_price_cents, attributes::text,"
            + " production_status, current_stage_code, is_removed AS removed, created_at, updated_at FROM cake_order_item"
            + " WHERE order_id=CAST(#{id} AS uuid) AND NOT is_removed ORDER BY created_at, id")
    List<ItemRow> items(String id);
    @Insert("INSERT INTO cake_order (id, order_no, version, status, payment_status, current_stage_code, customer_name, customer_phone, member_phone, buyer_name,"
            + " fulfillment_type, delivery_address, requested_receive_date, planned_handoff_at, planned_finish_at, total_amount_cents,"
            + " created_by, created_at, confirmed_at, updated_at) VALUES (CAST(#{id} AS uuid), #{orderNo}, #{version}, #{status}, #{paymentStatus}, #{currentStageCode},"
            + " #{customerName}, #{customerPhone}, #{memberPhone}, #{buyerName}, #{fulfillmentType}, #{deliveryAddress}, #{requestedReceiveDate},"
            + " #{plannedHandoffAt}, #{plannedFinishAt}, #{totalAmountCents}, CAST(#{createdBy} AS uuid), #{createdAt}, #{confirmedAt}, #{updatedAt})")
    void insert(Row row);
    @Insert("INSERT INTO cake_order_item (id, order_id, name, product_type, quantity, unit_price_cents, member_price_cents, attributes,"
            + " production_status, current_stage_code, is_removed, created_at, updated_at) VALUES (CAST(#{id} AS uuid), CAST(#{orderId} AS uuid),"
            + " #{name}, #{productType}, #{quantity}, #{unitPriceCents}, #{memberPriceCents}, CAST(#{attributes} AS jsonb), #{productionStatus},"
            + " #{currentStageCode}, #{removed}, #{createdAt}, #{updatedAt})")
    void insertItem(ItemRow row);
    @Update("UPDATE cake_order SET version=version+1, updated_at=#{updatedAt} WHERE id=CAST(#{id} AS uuid) AND version=#{expected}")
    int advanceVersion(@Param("id") String id, @Param("expected") long expected, @Param("updatedAt") Instant updatedAt);
    @Update("UPDATE cake_order_item SET name=#{name}, product_type=#{productType}, quantity=#{quantity}, unit_price_cents=#{unitPriceCents},"
            + " member_price_cents=#{memberPriceCents}, attributes=CAST(#{attributes} AS jsonb), updated_at=#{updatedAt}"
            + " WHERE id=CAST(#{id} AS uuid) AND order_id=CAST(#{orderId} AS uuid) AND NOT is_removed")
    int updateItem(ItemRow row);
    @Update("UPDATE cake_order SET payment_status=#{paymentStatus}, version=version+1, updated_at=#{updatedAt}"
            + " WHERE id=CAST(#{id} AS uuid) AND version=#{expected}")
    int updatePaymentStatus(@Param("id") String id, @Param("expected") long expected, @Param("paymentStatus") String paymentStatus,
            @Param("updatedAt") Instant updatedAt);
    @Update("UPDATE cake_order SET status=#{status}, current_stage_code=#{currentStageCode}, version=version+1, updated_at=#{updatedAt}"
            + " WHERE id=CAST(#{id} AS uuid) AND version=#{expected}")
    int updateProduction(@Param("id") String id, @Param("expected") long expected, @Param("status") String status,
            @Param("currentStageCode") String currentStageCode, @Param("updatedAt") Instant updatedAt);
    @Update("UPDATE cake_order SET status=#{status}, version=version+1, updated_at=#{updatedAt}"
            + " WHERE id=CAST(#{id} AS uuid) AND version=#{expected}")
    int updateStatus(@Param("id") String id, @Param("expected") long expected, @Param("status") String status, @Param("updatedAt") Instant updatedAt);
    @Update("UPDATE cake_order_item SET production_status=#{productionStatus}, updated_at=#{updatedAt}"
            + " WHERE id=CAST(#{id} AS uuid) AND order_id=CAST(#{orderId} AS uuid) AND NOT is_removed")
    int updateItemProduction(ItemRow row);
    @Select("SELECT version FROM cake_order WHERE id=CAST(#{id} AS uuid) AND version=#{expected} FOR SHARE")
    Long lockedVersion(@Param("id") String id, @Param("expected") long expected);
}

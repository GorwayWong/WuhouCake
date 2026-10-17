package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import org.apache.ibatis.annotations.*;

public interface OrderCreationMapper {
    record Row(String fingerprint, String orderId) { }
    @Insert("INSERT INTO cake_order_creation(actor_id,request_id,fingerprint) VALUES(CAST(#{actor} AS uuid),CAST(#{request} AS uuid),#{fingerprint}) ON CONFLICT DO NOTHING")
    void reserve(@Param("actor") String actor, @Param("request") String request, @Param("fingerprint") String fingerprint);
    @Select("SELECT fingerprint,order_id::text FROM cake_order_creation WHERE actor_id=CAST(#{actor} AS uuid) AND request_id=CAST(#{request} AS uuid) FOR UPDATE")
    Row lock(@Param("actor") String actor, @Param("request") String request);
    @Update("UPDATE cake_order_creation SET order_id=CAST(#{order} AS uuid) WHERE actor_id=CAST(#{actor} AS uuid) AND request_id=CAST(#{request} AS uuid) AND order_id IS NULL")
    int complete(@Param("actor") String actor, @Param("request") String request, @Param("order") String order);
}

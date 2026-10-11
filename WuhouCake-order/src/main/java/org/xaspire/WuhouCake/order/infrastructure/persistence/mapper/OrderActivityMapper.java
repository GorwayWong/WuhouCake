package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderActivityMapper {
    record Row(long id, String orderId, String itemId, String type, String content, String details,
            String actorId, String actorNameSnapshot, Instant createdAt) { }
    String COLUMNS = "id, order_id::text, item_id::text, type, content, details::text, actor_id::text, actor_name_snapshot, created_at";
    String FILTER = " FROM cake_order_activity WHERE order_id=CAST(#{orderId} AS uuid)"
            + "<if test='itemId != null'> AND item_id=CAST(#{itemId} AS uuid)</if>"
            + "<if test='type != null'> AND type=#{type}</if>";

    @Select(value = "INSERT INTO cake_order_activity (order_id, item_id, type, content, details, actor_id, actor_name_snapshot, created_at)"
            + " VALUES (CAST(#{orderId} AS uuid), CAST(#{itemId} AS uuid), #{type}, #{content}, CAST(#{details} AS jsonb),"
            + " CAST(#{actorId} AS uuid), #{actorNameSnapshot}, #{createdAt}) RETURNING id", affectData = true)
    long append(Row row);
    @Select("SELECT " + COLUMNS + " FROM (SELECT *, row_number() OVER (PARTITION BY item_id ORDER BY created_at DESC, id DESC) AS note_rank"
            + " FROM cake_order_activity WHERE order_id=CAST(#{orderId} AS uuid) AND item_id IS NOT NULL AND type='NOTE') AS notes"
            + " WHERE note_rank <= 3 ORDER BY created_at DESC, id DESC")
    List<Row> recentItemNotes(String orderId);
    @Select("<script>SELECT " + COLUMNS + FILTER + " ORDER BY created_at DESC, id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<Row> search(@Param("orderId") String orderId, @Param("itemId") String itemId, @Param("type") String type,
            @Param("size") int size, @Param("offset") long offset);
    @Select("<script>SELECT count(*)" + FILTER + "</script>")
    long count(@Param("orderId") String orderId, @Param("itemId") String itemId, @Param("type") String type);
}

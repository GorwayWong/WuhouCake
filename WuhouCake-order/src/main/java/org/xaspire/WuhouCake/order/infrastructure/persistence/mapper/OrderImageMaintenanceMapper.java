package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderImageMaintenanceMapper {
    record Row(String id, String filename, byte[] content) { }
    @Select("SELECT id::text FROM cake_order_image WHERE processing_version=0 AND (CAST(#{after} AS uuid) IS NULL OR id>CAST(#{after} AS uuid)) ORDER BY id LIMIT #{limit}")
    List<String> candidates(@Param("after") String after, @Param("limit") int limit);
    @Select("SELECT id::text,filename,content FROM cake_order_image WHERE id=CAST(#{id} AS uuid) AND processing_version=0")
    Row load(String id);
    @Update("UPDATE cake_order_image SET content=#{content},content_type=#{type},filename=#{filename},size=#{size},width=#{width},height=#{height},processing_version=1"
            + " WHERE id=CAST(#{id} AS uuid) AND processing_version=0")
    int replace(@Param("id") String id, @Param("content") byte[] content, @Param("type") String type, @Param("filename") String filename,
            @Param("size") long size, @Param("width") int width, @Param("height") int height);
}

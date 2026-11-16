package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderImageMapper {
    record Row(String imageId, String orderId, String itemId, String contentType, String filename, long size,
            int width, int height, String uploadedBy, String uploaderNameSnapshot, Instant uploadedAt) { }
    record ContentRow(byte[] content) { }
    String COLUMNS = "id::text AS image_id, order_id::text, item_id::text, content_type, filename, size, width, height,"
            + " uploaded_by::text, uploader_name_snapshot, uploaded_at";
    @Select("SELECT id::text FROM cake_order WHERE id=CAST(#{id} AS uuid) FOR UPDATE")
    String lockOrder(String id);
    @Select("SELECT EXISTS(SELECT 1 FROM cake_order_item WHERE order_id=CAST(#{orderId} AS uuid) AND id=CAST(#{itemId} AS uuid) AND NOT is_removed)")
    boolean activeItem(@Param("orderId") String orderId, @Param("itemId") String itemId);
    @Select("SELECT count(*) FROM cake_order_image WHERE order_id=CAST(#{id} AS uuid) AND NOT is_removed")
    int count(String id);
    @Select("SELECT count(*) FROM cake_order_image WHERE order_id=CAST(#{orderId} AS uuid) AND item_id=CAST(#{itemId} AS uuid) AND NOT is_removed")
    int countItem(@Param("orderId") String orderId, @Param("itemId") String itemId);
    record UploadRow(String imageId, String fingerprint) { }
    @Select("SELECT image_id::text,fingerprint FROM cake_order_image_upload WHERE order_id=CAST(#{orderId} AS uuid) AND request_id=CAST(#{requestId} AS uuid)")
    UploadRow findUpload(@Param("orderId") String orderId, @Param("requestId") String requestId);
    @Insert("INSERT INTO cake_order_image_upload(order_id,request_id,image_id,fingerprint) VALUES(CAST(#{orderId} AS uuid),CAST(#{requestId} AS uuid),CAST(#{imageId} AS uuid),#{fingerprint})")
    void recordUpload(@Param("orderId") String orderId, @Param("requestId") String requestId, @Param("imageId") String imageId, @Param("fingerprint") String fingerprint);
    @Insert("INSERT INTO cake_order_image (id, order_id, item_id, content_type, filename, size, width, height, uploaded_by,"
            + " uploader_name_snapshot, uploaded_at, content, processing_version) VALUES (CAST(#{image.imageId} AS uuid), CAST(#{image.orderId} AS uuid),"
            + " CAST(#{image.itemId} AS uuid), #{image.contentType}, #{image.filename}, #{image.size}, #{image.width}, #{image.height},"
            + " CAST(#{image.uploadedBy} AS uuid), #{image.uploaderNameSnapshot}, #{image.uploadedAt}, #{content}, 1)")
    void insert(@Param("image") Row image, @Param("content") byte[] content);
    @Select("SELECT " + COLUMNS + " FROM cake_order_image WHERE order_id=CAST(#{id} AS uuid) AND NOT is_removed ORDER BY uploaded_at, id")
    List<Row> list(String id);
    @Select("SELECT " + COLUMNS + " FROM cake_order_image WHERE order_id=CAST(#{orderId} AS uuid) AND id=CAST(#{imageId} AS uuid) AND NOT is_removed")
    Row find(@Param("orderId") String orderId, @Param("imageId") String imageId);
    @Select("SELECT EXISTS(SELECT 1 FROM cake_order_image WHERE order_id=CAST(#{orderId} AS uuid) AND id=CAST(#{imageId} AS uuid))")
    boolean contains(@Param("orderId") String orderId, @Param("imageId") String imageId);
    @Select("SELECT content FROM cake_order_image WHERE order_id=CAST(#{orderId} AS uuid) AND id=CAST(#{imageId} AS uuid)")
    ContentRow content(@Param("orderId") String orderId, @Param("imageId") String imageId);
    @Update("UPDATE cake_order_image SET is_removed=true WHERE order_id=CAST(#{orderId} AS uuid) AND id=CAST(#{imageId} AS uuid) AND NOT is_removed")
    void remove(@Param("orderId") String orderId, @Param("imageId") String imageId);
}

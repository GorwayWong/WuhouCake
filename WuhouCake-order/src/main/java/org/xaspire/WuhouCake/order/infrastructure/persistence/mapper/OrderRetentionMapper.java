package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderRetentionMapper {
    @Select("SELECT id::text FROM cake_order WHERE deleted_at<=#{cutoff} AND (CAST(#{after} AS uuid) IS NULL OR id>CAST(#{after} AS uuid)) ORDER BY id LIMIT #{limit}")
    List<String> expired(@Param("cutoff") Instant cutoff, @Param("after") String after, @Param("limit") int limit);
    @Select("SELECT id::text FROM cake_order WHERE id=CAST(#{id} AS uuid) AND deleted_at<=#{cutoff} FOR UPDATE SKIP LOCKED")
    String lock(@Param("id") String id, @Param("cutoff") Instant cutoff);
    @Select("SELECT id::text FROM customer_order_submission WHERE order_id=CAST(#{id} AS uuid)"
            + " OR id=(SELECT source_submission_id FROM cake_order WHERE id=CAST(#{id} AS uuid)) ORDER BY id FOR UPDATE")
    List<String> submissions(String id);
    @Delete("DELETE FROM customer_submission_activity WHERE submission_id=CAST(#{id} AS uuid)")
    void removeSubmissionActivities(String id);
    @Update("UPDATE customer_order_submission SET status='PURGED',order_id=NULL,original='{}'::jsonb,reviewed=NULL,"
            + " original_phone='',requested_date=NULL,owner_name='',version=version+1,updated_at=#{now} WHERE id=CAST(#{id} AS uuid)")
    void scrubSubmission(@Param("id") String id, @Param("now") Instant now);
    @Update("UPDATE cake_order SET source_submission_id=NULL WHERE id=CAST(#{id} AS uuid)")
    void detach(String id);
    @Update("UPDATE cake_order_creation SET purged_order_id=order_id,order_id=NULL WHERE order_id=CAST(#{id} AS uuid)")
    void preserveCreationReceipt(String id);
    @Delete("DELETE FROM cake_order_image WHERE order_id=CAST(#{id} AS uuid)") void images(String id);
    @Delete("DELETE FROM cake_order_activity WHERE order_id=CAST(#{id} AS uuid)") void activities(String id);
    @Delete("DELETE FROM cake_order_item WHERE order_id=CAST(#{id} AS uuid)") void items(String id);
    @Update("UPDATE cake_order_deletion_audit SET purged_at=#{now} WHERE order_id=CAST(#{id} AS uuid)")
    void audit(@Param("id") String id, @Param("now") Instant now);
    @Delete("DELETE FROM cake_order WHERE id=CAST(#{id} AS uuid) AND deleted_at<=#{cutoff}")
    int order(@Param("id") String id, @Param("cutoff") Instant cutoff);
    @Select("SELECT count(*) FROM cake_order WHERE deleted_at<=#{cutoff}") long pending(Instant cutoff);
}

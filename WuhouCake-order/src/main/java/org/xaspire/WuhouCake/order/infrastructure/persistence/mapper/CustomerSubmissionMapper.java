package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.*;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface CustomerSubmissionMapper {
    String COLUMNS = "id::text,entry_id::text,owner_id::text,owner_name,version,status,original::text,reviewed::text,order_id::text,created_at,updated_at";
    record EntryRow(String id, String ownerId, String ownerName, String token, boolean enabled) { }
    record Row(String id, String entryId, String ownerId, String ownerName, long version, String status,
            String original, String reviewed, String orderId, Instant createdAt, Instant updatedAt) { }
    record ActivityRow(long id, String type, String actorType, String actorId, String actorName, String details, Instant createdAt) { }
    record Claim(String id, String fingerprint) { }
    @Select("SELECT id::text,owner_id::text,owner_name,token,enabled FROM customer_order_entry WHERE owner_id=CAST(#{owner} AS uuid)")
    EntryRow entryForOwner(String owner);
    @Select("SELECT id::text,owner_id::text,owner_name,token,enabled FROM customer_order_entry WHERE token=#{token}")
    EntryRow entryByToken(String token);
    @Select("SELECT id::text,owner_id::text,owner_name,token,enabled FROM customer_order_entry WHERE token=#{token} FOR SHARE")
    EntryRow lockEntry(String token);
    @Insert("INSERT INTO customer_order_entry(id,owner_id,owner_name,token,enabled) VALUES(CAST(#{id} AS uuid),CAST(#{ownerId} AS uuid),#{ownerName},#{token},#{enabled})"
            + " ON CONFLICT(owner_id) DO UPDATE SET owner_name=EXCLUDED.owner_name,token=EXCLUDED.token,enabled=EXCLUDED.enabled")
    void saveEntry(EntryRow row);
    @Insert("INSERT INTO customer_order_submission(id,entry_id,owner_id,owner_name,request_id,fingerprint,original,original_phone,requested_date,status,created_at,updated_at)"
            + " VALUES(CAST(#{id} AS uuid),CAST(#{entryId} AS uuid),CAST(#{ownerId} AS uuid),#{ownerName},CAST(#{requestId} AS uuid),#{fingerprint},CAST(#{original} AS jsonb),#{phone},#{date},'PENDING',#{now},#{now})"
            + " ON CONFLICT(entry_id,request_id) DO NOTHING")
    int insert(@Param("id") String id, @Param("entryId") String entryId, @Param("ownerId") String ownerId, @Param("ownerName") String ownerName,
            @Param("requestId") String requestId, @Param("fingerprint") String fingerprint, @Param("original") String original,
            @Param("phone") String phone, @Param("date") LocalDate date, @Param("now") Instant now);
    @Select("SELECT id::text,fingerprint FROM customer_order_submission WHERE entry_id=CAST(#{entry} AS uuid) AND request_id=CAST(#{request} AS uuid)")
    Claim claim(@Param("entry") String entry, @Param("request") String request);
    @Select("SELECT " + COLUMNS + " FROM customer_order_submission WHERE id=CAST(#{id} AS uuid)") Row find(String id);
    @Select("SELECT " + COLUMNS + " FROM customer_order_submission WHERE id=CAST(#{id} AS uuid) FOR UPDATE") Row lock(String id);
    @Select("SELECT " + COLUMNS + " FROM customer_order_submission WHERE order_id=CAST(#{id} AS uuid)") Row byOrder(String id);
    @Select("SELECT " + COLUMNS + " FROM customer_order_submission WHERE status=#{status} AND (CAST(#{owner} AS uuid) IS NULL OR owner_id=CAST(#{owner} AS uuid)) ORDER BY created_at DESC,id DESC LIMIT #{limit} OFFSET #{offset}")
    List<Row> search(@Param("owner") String owner, @Param("status") String status, @Param("limit") int limit, @Param("offset") long offset);
    @Select("SELECT count(*) FROM customer_order_submission WHERE status=#{status} AND (CAST(#{owner} AS uuid) IS NULL OR owner_id=CAST(#{owner} AS uuid))")
    long count(@Param("owner") String owner, @Param("status") String status);
    @Select("SELECT id::text FROM customer_order_submission WHERE status='PENDING' AND original_phone=#{phone} AND requested_date=#{date}"
            + " AND (created_at,id) > (#{time},CAST(#{id} AS uuid)) ORDER BY created_at DESC,id DESC LIMIT 1")
    String newer(@Param("id") String id, @Param("phone") String phone, @Param("date") LocalDate date, @Param("time") Instant time);
    @Update("UPDATE customer_order_submission SET reviewed=CAST(#{review} AS jsonb),status=#{status},order_id=CAST(#{orderId} AS uuid),version=version+1,updated_at=#{now}"
            + " WHERE id=CAST(#{id} AS uuid) AND version=#{version} AND status='PENDING'")
    int update(@Param("id") String id, @Param("version") long version, @Param("review") String review, @Param("status") String status, @Param("orderId") String orderId, @Param("now") Instant now);
    @Insert("INSERT INTO customer_submission_activity(submission_id,type,actor_type,actor_id,actor_name,details,created_at)"
            + " VALUES(CAST(#{id} AS uuid),#{type},#{actorType},CAST(#{actorId} AS uuid),#{actorName},CAST(#{details} AS jsonb),#{now})")
    void append(@Param("id") String id, @Param("type") String type, @Param("actorType") String actorType, @Param("actorId") String actorId,
            @Param("actorName") String actorName, @Param("details") String details, @Param("now") Instant now);
    @Select("SELECT id,type,actor_type,actor_id::text,actor_name,details::text,created_at FROM customer_submission_activity WHERE submission_id=CAST(#{id} AS uuid) ORDER BY id DESC")
    List<ActivityRow> activities(String id);
    @Update("UPDATE cake_order SET source='CUSTOMER_SUBMITTED',source_submission_id=CAST(#{submission} AS uuid) WHERE id=CAST(#{order} AS uuid)")
    void markOrder(@Param("order") String order, @Param("submission") String submission);
}

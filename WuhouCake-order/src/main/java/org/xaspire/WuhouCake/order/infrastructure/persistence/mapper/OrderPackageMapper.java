package org.xaspire.WuhouCake.order.infrastructure.persistence.mapper;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OrderPackageMapper {
    String COLUMNS = "id::text, name, items::text, version, updated_at, deleted_at";
    record Row(String id, String name, String items, long version, Instant updatedAt, Instant deletedAt) { }
    @Select("SELECT " + COLUMNS + " FROM cake_order_package WHERE deleted_at IS NULL AND strpos(name, #{keyword}) > 0 ORDER BY updated_at DESC, id LIMIT #{limit} OFFSET #{offset}")
    List<Row> list(@Param("keyword") String keyword, @Param("limit") int limit, @Param("offset") long offset);
    @Select("SELECT count(*) FROM cake_order_package WHERE deleted_at IS NULL AND strpos(name, #{keyword}) > 0")
    long count(@Param("keyword") String keyword);
    @Select("SELECT " + COLUMNS + " FROM cake_order_package WHERE id=CAST(#{id} AS uuid)")
    Row find(@Param("id") String id);
    @Select("SELECT " + COLUMNS + " FROM cake_order_package WHERE creation_key=CAST(#{key} AS uuid)")
    Row findCreation(@Param("key") String key);
    @Select("SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('order-package:' || #{key}, 0))")
    int lockCreation(@Param("key") String key);
    @Insert("INSERT INTO cake_order_package(id,name,items,creation_key,updated_at) VALUES(CAST(#{id} AS uuid),#{name},CAST(#{items} AS jsonb),CAST(#{key} AS uuid),#{now}) ON CONFLICT (creation_key) DO NOTHING")
    int create(@Param("id") String id, @Param("name") String name, @Param("items") String items, @Param("key") String key, @Param("now") Instant now);
    @Update("UPDATE cake_order_package SET name=#{name},items=CAST(#{items} AS jsonb),version=version+1,updated_at=#{now} WHERE id=CAST(#{id} AS uuid) AND version=#{version} AND deleted_at IS NULL")
    int update(@Param("id") String id, @Param("name") String name, @Param("items") String items, @Param("version") long version, @Param("now") Instant now);
    @Update("UPDATE cake_order_package SET deleted_at=#{now},updated_at=#{now},version=version+1 WHERE id=CAST(#{id} AS uuid) AND version=#{version} AND deleted_at IS NULL")
    int delete(@Param("id") String id, @Param("version") long version, @Param("now") Instant now);
    @Insert("INSERT INTO cake_order_package_change(id,package_id,actor_id,occurred_at,before_content,after_content) VALUES(CAST(#{id} AS uuid),CAST(#{packageId} AS uuid),CAST(#{actorId} AS uuid),#{now},CAST(#{before} AS jsonb),CAST(#{after} AS jsonb))")
    void recordChange(@Param("id") String id, @Param("packageId") String packageId, @Param("actorId") String actorId,
            @Param("now") Instant now, @Param("before") String before, @Param("after") String after);
}

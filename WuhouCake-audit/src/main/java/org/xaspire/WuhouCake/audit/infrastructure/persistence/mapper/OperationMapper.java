package org.xaspire.WuhouCake.audit.infrastructure.persistence.mapper;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface OperationMapper {
    record Row(String id, Instant occurredAt, String action, String result, String actorId, String actorEmployeeNumber,
            String actorNickname, String targetId, String requestId, String details) { }
    String FILTER = " FROM audit_operation WHERE 1=1 "
            + "<if test='actorId != null'> AND actor_id=CAST(#{actorId} AS uuid)</if>"
            + "<if test='action != null'> AND action=#{action}</if><if test='result != null'> AND result=#{result}</if>"
            + "<if test='from != null'> AND occurred_at &gt;= #{from}</if><if test='to != null'> AND occurred_at &lt; #{to}</if>";
    @Insert("INSERT INTO audit_operation (id,occurred_at,action,result,actor_id,actor_employee_number,actor_nickname,target_id,request_id,details) VALUES (CAST(#{id} AS uuid), #{occurredAt}, #{action}, #{result}, "
            + "CAST(#{actorId} AS uuid), #{actorEmployeeNumber}, #{actorNickname}, #{targetId}, #{requestId}, CAST(#{details} AS jsonb))")
    void insert(Row row);
    @Select("<script>SELECT id::text, occurred_at, action, result, actor_id::text, actor_employee_number, actor_nickname, target_id, request_id, details::text"
            + FILTER + " ORDER BY occurred_at DESC, id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<Row> search(@Param("actorId") String actorId, @Param("action") String action, @Param("result") String result,
            @Param("from") Instant from, @Param("to") Instant to, @Param("size") int size, @Param("offset") int offset);
    @Select("<script>SELECT count(*)" + FILTER + "</script>")
    long count(@Param("actorId") String actorId, @Param("action") String action, @Param("result") String result,
            @Param("from") Instant from, @Param("to") Instant to);
}

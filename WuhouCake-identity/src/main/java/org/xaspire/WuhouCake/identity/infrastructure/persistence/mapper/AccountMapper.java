package org.xaspire.WuhouCake.identity.infrastructure.persistence.mapper;

import java.time.Instant;
import java.util.List;
import org.apache.ibatis.annotations.*;

public interface AccountMapper {
    record Row(String id, String employeeNumber, String nickname, String systemRole, String status, String passwordHash,
            boolean passwordChangeRequired, long credentialVersion, long version, Instant createdAt, Instant updatedAt,
            Instant archivedAt, String archivedBy) { }
    String COLUMNS = "id::text, employee_number, nickname, system_role, status, password_hash, password_change_required, "
            + "credential_version, version, created_at, updated_at, archived_at, archived_by::text";
    String FILTER = " FROM identity_account a WHERE 1=1"
            + "<if test='number != null'> AND employee_number=#{number}</if>"
            + "<if test='nickname != null'> AND position(#{nickname} IN nickname)&gt;0</if>"
            + "<if test='status != null'> AND status=#{status}</if>"
            + "<if test='role != null'> AND EXISTS (SELECT 1 FROM identity_account_role r WHERE r.account_id=a.id AND r.role=#{role})</if>";
    @Select("SELECT " + COLUMNS + " FROM identity_account WHERE id=CAST(#{id} AS uuid)") Row find(String id);
    @Select("SELECT " + COLUMNS + " FROM identity_account WHERE employee_number=#{number}") Row byNumber(String number);
    @Select("SELECT " + COLUMNS + " FROM identity_account WHERE id=CAST(#{id} AS uuid) FOR UPDATE") Row lock(String id);
    @Select("SELECT TRUE FROM (SELECT pg_advisory_xact_lock(711001)) AS lifecycle_lock") boolean lockAdministrators();
    @Select("SELECT count(*) FROM identity_account WHERE system_role='SUPER_ADMIN' AND status='ACTIVE'") long activeAdministrators();
    @Select("SELECT count(*) FROM identity_account WHERE system_role='SUPER_ADMIN'") long administrators();
    @Select("SELECT role FROM identity_account_role WHERE account_id=CAST(#{id} AS uuid) ORDER BY role") List<String> roles(String id);
    @Insert("INSERT INTO identity_account VALUES (CAST(#{id} AS uuid), #{employeeNumber}, #{nickname}, #{systemRole}, #{status}, #{passwordHash},"
            + "#{passwordChangeRequired}, #{credentialVersion}, #{version}, #{createdAt}, #{updatedAt}, #{archivedAt}, CAST(#{archivedBy} AS uuid))") void insert(Row row);
    @Insert("INSERT INTO identity_account_role VALUES (CAST(#{id} AS uuid), #{role})") void insertRole(@Param("id") String id, @Param("role") String role);
    @Update("UPDATE identity_account SET nickname=#{row.nickname}, status=#{row.status}, password_hash=#{row.passwordHash},"
            + " password_change_required=#{row.passwordChangeRequired}, credential_version=#{row.credentialVersion}, version=#{row.version},"
            + " updated_at=#{row.updatedAt}, archived_at=#{row.archivedAt}, archived_by=CAST(#{row.archivedBy} AS uuid)"
            + " WHERE id=CAST(#{row.id} AS uuid) AND version=#{expected}") int update(@Param("row") Row row, @Param("expected") long expected);
    @Select("<script>SELECT " + COLUMNS + FILTER + " ORDER BY created_at DESC, id DESC LIMIT #{size} OFFSET #{offset}</script>")
    List<Row> search(@Param("number") String number, @Param("nickname") String nickname, @Param("status") String status,
            @Param("role") String role, @Param("size") int size, @Param("offset") int offset);
    @Select("<script>SELECT count(*)" + FILTER + "</script>")
    long count(@Param("number") String number, @Param("nickname") String nickname, @Param("status") String status, @Param("role") String role);
}

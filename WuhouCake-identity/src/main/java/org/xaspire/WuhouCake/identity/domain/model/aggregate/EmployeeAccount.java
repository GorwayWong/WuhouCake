package org.xaspire.WuhouCake.identity.domain.model.aggregate;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;

public record EmployeeAccount(UUID id, String employeeNumber, String nickname, Set<JobRole> jobRoles,
        SystemRole systemRole, Status status, String passwordHash, boolean passwordChangeRequired,
        long credentialVersion, long version, Instant createdAt, Instant updatedAt,
        Instant archivedAt, UUID archivedBy) {
    public EmployeeAccount {
        employeeNumber = AccountValues.employeeNumber(employeeNumber);
        nickname = AccountValues.nickname(nickname);
        if (jobRoles == null || jobRoles.isEmpty() || jobRoles.stream().anyMatch(java.util.Objects::isNull)) throw new IdentityFailure("VALIDATION_FAILED");
        jobRoles = Set.copyOf(jobRoles);
        if (id == null || systemRole == null || status == null || passwordHash == null || passwordHash.isBlank())
            throw new IdentityFailure("VALIDATION_FAILED");
    }
    public static EmployeeAccount create(UUID id, String number, String nickname, Set<JobRole> roles,
            SystemRole role, String hash, Instant now) {
        return new EmployeeAccount(id, number, nickname, roles, role, Status.ACTIVE, hash, true, 0, 0, now, now, null, null);
    }
    public void requireActive() {
        if (status != Status.ACTIVE) throw new IdentityFailure("AUTHENTICATION_FAILED");
    }
    public void requireAdministrator() {
        requireActive();
        if (passwordChangeRequired) throw new IdentityFailure("PASSWORD_CHANGE_REQUIRED");
        if (systemRole != SystemRole.SUPER_ADMIN) throw new IdentityFailure("FORBIDDEN");
    }
    public EmployeeAccount rename(String value, Instant now) {
        requireActive();
        return changed(AccountValues.nickname(value), passwordHash, passwordChangeRequired, status, credentialVersion, now, archivedAt, archivedBy);
    }
    public EmployeeAccount replacePassword(String hash, boolean temporary, Instant now) {
        requireActive();
        return changed(nickname, hash, temporary, status, credentialVersion + 1, now, archivedAt, archivedBy);
    }
    public EmployeeAccount archive(UUID actor, long activeAdministrators, Instant now) {
        if (id.equals(actor)) throw new IdentityFailure("SELF_ARCHIVE_FORBIDDEN");
        if (status == Status.ARCHIVED) return this;
        if (systemRole == SystemRole.SUPER_ADMIN && activeAdministrators <= 1) throw new IdentityFailure("LAST_ADMINISTRATOR");
        return changed(nickname, passwordHash, passwordChangeRequired, Status.ARCHIVED, credentialVersion + 1, now, now, actor);
    }
    private EmployeeAccount changed(String name, String hash, boolean required, Status state, long credentials,
            Instant now, Instant archived, UUID actor) {
        return new EmployeeAccount(id, employeeNumber, name, jobRoles, systemRole, state, hash, required,
                credentials, version + 1, createdAt, now, archived, actor);
    }
    @Override public String toString() { return "EmployeeAccount[id=" + id + ", status=" + status + "]"; }
}

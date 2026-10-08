package org.xaspire.WuhouCake.identity.domain;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.identity.domain.model.aggregate.EmployeeAccount;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import static org.junit.jupiter.api.Assertions.*;

class EmployeeAccountTest {
    private final Instant now = Instant.parse("2026-10-08T00:00:00Z");
    private EmployeeAccount account(SystemRole role) {
        return EmployeeAccount.create(UUID.randomUUID(), "00ab", "  师父  ", Set.of(JobRole.MANAGER, JobRole.PASTRY_CHEF), role, "{argon2id}hash", now);
    }
    @Test void identifiersAndRolesRemainSeparate() {
        var employee = account(SystemRole.STAFF);
        assertEquals("00AB", employee.employeeNumber()); assertEquals("师父", employee.nickname());
        assertEquals(2, employee.jobRoles().size()); assertEquals(SystemRole.STAFF, employee.systemRole());
        assertThrows(UnsupportedOperationException.class, () -> employee.jobRoles().clear());
    }
    @Test void initialPasswordBlocksAdministratorUseUntilChanged() {
        var administrator = account(SystemRole.SUPER_ADMIN);
        assertEquals("PASSWORD_CHANGE_REQUIRED", assertThrows(IdentityFailure.class, administrator::requireAdministrator).code());
        administrator.replacePassword("newhash", false, now).requireAdministrator();
    }
    @Test void archivalPreservesIdentityAndChangesCredentialVersion() {
        var employee = account(SystemRole.STAFF);
        var archived = employee.archive(UUID.randomUUID(), 1, now.plusSeconds(1));
        assertEquals(employee.id(), archived.id()); assertEquals(employee.employeeNumber(), archived.employeeNumber());
        assertEquals(employee.jobRoles(), archived.jobRoles()); assertEquals(Status.ARCHIVED, archived.status());
        assertEquals(1, archived.credentialVersion()); assertEquals(1, archived.version());
        assertSame(archived, archived.archive(UUID.randomUUID(), 1, now));
        assertThrows(IdentityFailure.class, archived::requireActive);
    }
    @Test void cannotArchiveSelfOrLastAdministrator() {
        var administrator = account(SystemRole.SUPER_ADMIN);
        assertEquals("SELF_ARCHIVE_FORBIDDEN", assertThrows(IdentityFailure.class, () -> administrator.archive(administrator.id(), 2, now)).code());
        assertEquals("LAST_ADMINISTRATOR", assertThrows(IdentityFailure.class, () -> administrator.archive(UUID.randomUUID(), 1, now)).code());
        assertEquals(Status.ARCHIVED, administrator.archive(UUID.randomUUID(), 2, now).status());
    }
    @Test void onlyCredentialChangesRevokeLogins() {
        var employee = account(SystemRole.STAFF);
        assertEquals(0, employee.rename("新昵称", now).credentialVersion());
        assertEquals(1, employee.replacePassword("newhash", true, now).credentialVersion());
    }
    @Test void unicodeLengthsAndInputConstraintsAreEnforced() {
        assertEquals("🍰".repeat(40), AccountValues.nickname("🍰".repeat(40)));
        assertThrows(IdentityFailure.class, () -> AccountValues.nickname("🍰".repeat(41)));
        assertThrows(IdentityFailure.class, () -> AccountValues.nickname("a\nb"));
        assertThrows(IdentityFailure.class, () -> AccountValues.employeeNumber(" a "));
        assertThrows(IdentityFailure.class, () -> AccountValues.password("short"));
        AccountValues.password("🍰".repeat(15));
        assertThrows(IdentityFailure.class, () -> AccountValues.password("password length!" + '\uD800'));
        assertThrows(IdentityFailure.class, () -> AccountValues.nickname("bad" + '\uDC00'));
        assertThrows(IdentityFailure.class, () -> EmployeeAccount.create(UUID.randomUUID(), "001", "name", Set.of(), SystemRole.STAFF, "hash", now));
    }
}

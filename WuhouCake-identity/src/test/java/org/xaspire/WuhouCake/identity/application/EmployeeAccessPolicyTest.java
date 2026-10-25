package org.xaspire.WuhouCake.identity.application;

import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
import org.xaspire.WuhouCake.identity.application.service.EmployeeAccessPolicy;
import org.xaspire.WuhouCake.identity.domain.model.aggregate.EmployeeAccount;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;

class EmployeeAccessPolicyTest {
    private static final Instant NOW = Instant.parse("2026-10-22T00:00:00Z");

    @Test void defaultsPreserveBusinessAccessAndSeparateEntryManagementFromSystemAdministration() {
        var policy = new EmployeeAccessPolicy(Map.of());
        for (var role : JobRole.values()) {
            var access = policy.access(account(Set.of(role), SystemRole.STAFF));
            boolean production = Set.of(JobRole.PASTRY_CHEF, JobRole.PASTRY_SUPERVISOR, JobRole.DECORATOR, JobRole.BAKER).contains(role);
            assertTrue(access.allows(ORDER_EXPORT));
            assertTrue(access.allows(ORDER_PAYMENT_UPDATE));
            assertEquals(!production, access.allows(ORDER_AMOUNT_READ));
            assertEquals(!production, access.allows(ORDER_CUSTOMER_READ));
            assertEquals(!production, access.allows(ORDER_BUSINESS_DETAILS_READ));
            assertTrue(access.allows(ORDER_PHONE_READ));
            assertEquals(!production, access.allows(ORDER_DELETE));
            assertEquals(!production, access.allows(ORDER_DELETED_READ));
            assertTrue(access.allows(ORDER_PRODUCTION_UPDATE));
            assertTrue(access.allows(ORDER_NOTE_CREATE));
            assertTrue(access.allows(ORDER_IMAGE_UPLOAD));
            assertEquals(role == JobRole.STORE_MANAGER, access.allows(EMPLOYEE_MANAGE));
            assertEquals(role == JobRole.STORE_MANAGER, access.allows(AUDIT_READ));
            assertEquals(!production, access.allows(CUSTOMER_SUBMISSION_PROCESS));
            assertEquals(role == JobRole.MANAGER || role == JobRole.STORE_MANAGER, access.allows(CUSTOMER_ENTRY_MANAGE_ALL));
        }
    }

    @Test void overridesReplaceJobGrantsAndMultipleJobsCombineWithoutSharingMutableState() {
        var chef = EnumSet.of(ORDER_READ, ORDER_PRODUCTION_UPDATE);
        var policy = new EmployeeAccessPolicy(Map.of(JobRole.PASTRY_CHEF, chef, JobRole.FRONT_DESK, Set.of(ORDER_READ, ORDER_PAYMENT_UPDATE)));
        chef.add(ORDER_EXPORT);
        var restricted = policy.access(account(Set.of(JobRole.PASTRY_CHEF), SystemRole.STAFF));
        assertEquals(Set.of(ORDER_READ, ORDER_PRODUCTION_UPDATE), restricted.permissions());
        assertEquals(Set.of(EmployeeAccess.UiCapability.ORDER_WORKBENCH, EmployeeAccess.UiCapability.ORDER_PRODUCTION), restricted.uiCapabilities());
        var combined = policy.access(account(Set.of(JobRole.PASTRY_CHEF, JobRole.FRONT_DESK), SystemRole.STAFF));
        assertEquals(Set.of(ORDER_READ, ORDER_PRODUCTION_UPDATE, ORDER_PAYMENT_UPDATE), combined.permissions());
        assertFalse(combined.allows(ORDER_AMOUNT_READ));
    }

    @Test void emptyJobGrantsDoNotRemoveSystemAdministrationOrPromoteStaff() {
        var policy = new EmployeeAccessPolicy(Map.of(JobRole.MANAGER, Set.of()));
        assertTrue(policy.access(account(Set.of(JobRole.MANAGER), SystemRole.STAFF)).permissions().isEmpty());
        assertEquals(Set.of(EMPLOYEE_MANAGE, AUDIT_READ), policy.access(account(Set.of(JobRole.MANAGER), SystemRole.SUPER_ADMIN)).permissions());
        assertThrows(IllegalArgumentException.class, () -> new EmployeeAccessPolicy(Map.of(JobRole.MANAGER, Set.of(EMPLOYEE_MANAGE))));
        assertThrows(IllegalArgumentException.class, () -> new EmployeeAccessPolicy(Map.of(JobRole.FRONT_DESK, Set.of(AUDIT_READ))));
    }

    @Test void archivedOrTemporaryPasswordAccountsHaveNoEffectiveCapabilities() {
        var policy = new EmployeeAccessPolicy(Map.of());
        var ready = account(Set.of(JobRole.MANAGER), SystemRole.SUPER_ADMIN);
        assertEquals(EmployeeAccess.none(), policy.access(ready.replacePassword("temporary-hash", true, NOW)));
        assertEquals(EmployeeAccess.none(), policy.access(ready.archive(UUID.randomUUID(), 2, NOW)));
        assertTrue(policy.canOwnCustomerEntry(ready.replacePassword("temporary-hash", true, NOW)));
        assertFalse(new EmployeeAccessPolicy(Map.of(JobRole.MANAGER, Set.of(ORDER_READ))).canOwnCustomerEntry(ready));
    }

    private static EmployeeAccount account(Set<JobRole> roles, SystemRole systemRole) {
        return EmployeeAccount.create(UUID.randomUUID(), "EMP001", "测试员工", roles, systemRole, "initial-hash", NOW)
                .replacePassword("permanent-hash", false, NOW);
    }

    @Test void frontDeskAndManagerJobsRestoreBusinessVisibilityForMultiJobProductionStaff() {
        var policy = new EmployeeAccessPolicy(Map.of());
        for (var role : Set.of(JobRole.FRONT_DESK, JobRole.MANAGER, JobRole.STORE_MANAGER, JobRole.FRONT_DESK_CLERK, JobRole.FRONT_DESK_SUPERVISOR)) {
            var access = policy.access(account(Set.of(role, JobRole.DECORATOR), SystemRole.STAFF));
            assertTrue(access.allows(ORDER_AMOUNT_READ));
            assertTrue(access.allows(ORDER_CUSTOMER_READ));
            assertTrue(access.allows(ORDER_BUSINESS_DETAILS_READ));
            assertEquals(role == JobRole.STORE_MANAGER, access.allows(EMPLOYEE_MANAGE));
        }
    }
}

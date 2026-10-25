package org.xaspire.WuhouCake.identity.application.service;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission;
import org.xaspire.WuhouCake.identity.domain.model.aggregate.EmployeeAccount;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.*;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;

/** Combines job permissions while keeping system administration independent of jobs. */
public final class EmployeeAccessPolicy {
    private final Map<JobRole, Set<Permission>> grants;

    public EmployeeAccessPolicy(Map<JobRole, Set<Permission>> overrides) {
        var configured = new EnumMap<JobRole, Set<Permission>>(JobRole.class);
        var shared = Set.of(ORDER_READ, ORDER_CREATE, ORDER_EDIT, ORDER_CANCEL, ORDER_PAYMENT_UPDATE,
                ORDER_PRODUCTION_UPDATE, ORDER_FULFILLMENT_UPDATE, ORDER_NOTE_CREATE, ORDER_IMAGE_UPLOAD,
                ORDER_IMAGE_DELETE, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ, ORDER_ACTIVITY_READ,
                ORDER_MANAGEMENT_READ, ORDER_EXPORT, EMPLOYEE_DIRECTORY_READ);
        for (var role : JobRole.values()) {
            var permissions = EnumSet.copyOf(shared);
            boolean production = Set.of(JobRole.PASTRY_CHEF, JobRole.PASTRY_SUPERVISOR, JobRole.DECORATOR, JobRole.BAKER).contains(role);
            boolean manager = role == JobRole.MANAGER || role == JobRole.STORE_MANAGER;
            if (production) {
                permissions.removeAll(Set.of(ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ));
            }
            permissions.add(ORDER_PHONE_READ);
            if (!production) {
                permissions.add(CUSTOMER_SUBMISSION_PROCESS);
                permissions.add(CUSTOMER_ENTRY_MANAGE);
                permissions.add(ORDER_DELETE);
                permissions.add(ORDER_DELETED_READ);
            }
            if (manager) permissions.add(CUSTOMER_ENTRY_MANAGE_ALL);
            configured.put(role, Set.copyOf(permissions));
        }
        overrides.forEach((role, permissions) -> {
            if (permissions.contains(EMPLOYEE_MANAGE) || permissions.contains(AUDIT_READ))
                throw new IllegalArgumentException("System permissions cannot be granted to job roles");
            configured.put(role, Set.copyOf(permissions));
        });
        grants = Map.copyOf(configured);
    }

    public EmployeeAccess access(EmployeeAccount account) {
        if (account.status() != Status.ACTIVE || account.passwordChangeRequired()) return EmployeeAccess.none();
        var permissions = jobPermissions(account.jobRoles());
        if (account.systemRole() == SystemRole.SUPER_ADMIN) {
            permissions.add(EMPLOYEE_MANAGE);
            permissions.add(AUDIT_READ);
        }
        return EmployeeAccess.of(permissions);
    }

    /** Entry ownership is a job qualification and does not depend on an owner's login session. */
    public boolean canOwnCustomerEntry(EmployeeAccount account) {
        return account.status() == Status.ACTIVE && jobPermissions(account.jobRoles()).contains(CUSTOMER_ENTRY_MANAGE);
    }

    private EnumSet<Permission> jobPermissions(Set<JobRole> roles) {
        var permissions = EnumSet.noneOf(Permission.class);
        for (var role : roles) permissions.addAll(grants.getOrDefault(role, Set.of()));
        return permissions;
    }
}

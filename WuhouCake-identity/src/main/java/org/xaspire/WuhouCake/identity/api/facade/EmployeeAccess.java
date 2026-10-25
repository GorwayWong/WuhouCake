package org.xaspire.WuhouCake.identity.api.facade;

import java.util.EnumSet;
import java.util.Set;

/** Effective operation permissions and UI capabilities for the current account. */
public record EmployeeAccess(Set<Permission> permissions, Set<UiCapability> uiCapabilities) {
    public EmployeeAccess {
        permissions = Set.copyOf(permissions);
        uiCapabilities = Set.copyOf(uiCapabilities);
    }

    public enum Permission {
        ORDER_READ, ORDER_CREATE, ORDER_EDIT, ORDER_CANCEL, ORDER_DELETE, ORDER_DELETED_READ,
        ORDER_PAYMENT_UPDATE, ORDER_PRODUCTION_UPDATE, ORDER_FULFILLMENT_UPDATE,
        ORDER_NOTE_CREATE, ORDER_IMAGE_UPLOAD, ORDER_IMAGE_DELETE,
        ORDER_CUSTOMER_READ, ORDER_PHONE_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ, ORDER_ACTIVITY_READ,
        ORDER_MANAGEMENT_READ, ORDER_EXPORT,
        CUSTOMER_SUBMISSION_PROCESS, CUSTOMER_ENTRY_MANAGE, CUSTOMER_ENTRY_MANAGE_ALL,
        EMPLOYEE_DIRECTORY_READ, EMPLOYEE_MANAGE, AUDIT_READ;

        public String authority() { return "PERMISSION_" + name(); }
    }

    public enum UiCapability {
        ORDER_WORKBENCH(Permission.ORDER_READ),
        ORDER_ENTRY(Permission.ORDER_CREATE, Permission.ORDER_CUSTOMER_READ, Permission.ORDER_AMOUNT_READ),
        ORDER_MANAGEMENT(Permission.ORDER_MANAGEMENT_READ, Permission.ORDER_CUSTOMER_READ, Permission.ORDER_AMOUNT_READ, Permission.ORDER_BUSINESS_DETAILS_READ),
        ORDER_CUSTOMER_DETAILS(Permission.ORDER_CUSTOMER_READ),
        ORDER_BUSINESS_DETAILS(Permission.ORDER_BUSINESS_DETAILS_READ),
        ORDER_AMOUNTS(Permission.ORDER_AMOUNT_READ),
        ORDER_ACTIVITY_LOG(Permission.ORDER_READ, Permission.ORDER_ACTIVITY_READ, Permission.ORDER_CUSTOMER_READ, Permission.ORDER_AMOUNT_READ, Permission.ORDER_BUSINESS_DETAILS_READ),
        ORDER_PRODUCTION(Permission.ORDER_PRODUCTION_UPDATE),
        CUSTOMER_SUBMISSIONS(Permission.CUSTOMER_SUBMISSION_PROCESS, Permission.ORDER_CUSTOMER_READ, Permission.ORDER_AMOUNT_READ),
        CUSTOMER_ENTRY(Permission.CUSTOMER_ENTRY_MANAGE),
        EMPLOYEE_MANAGEMENT(Permission.EMPLOYEE_MANAGE),
        AUDIT_LOG(Permission.AUDIT_READ);

        private final Set<Permission> required;
        UiCapability(Permission... required) { this.required = Set.of(required); }
    }

    /** Derives presentation capabilities from the same permissions enforced by the server. */
    public static EmployeeAccess of(Set<Permission> permissions) {
        var capabilities = EnumSet.noneOf(UiCapability.class);
        for (var capability : UiCapability.values()) {
            if (permissions.containsAll(capability.required)) capabilities.add(capability);
        }
        return new EmployeeAccess(permissions, capabilities);
    }

    public static EmployeeAccess none() { return of(Set.of()); }
    public boolean allows(Permission permission) { return permissions.contains(permission); }
}

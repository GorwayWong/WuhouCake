package org.xaspire.WuhouCake.identity.application;

import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
import static org.junit.jupiter.api.Assertions.*;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.UiCapability.*;

class EmployeeAccessTest {
    @Test void presentationCapabilitiesNeverGrantOperationPermissions() {
        var access = EmployeeAccess.of(Set.of(ORDER_READ, ORDER_PRODUCTION_UPDATE));
        assertEquals(Set.of(ORDER_WORKBENCH, ORDER_PRODUCTION), access.uiCapabilities());
        assertFalse(access.allows(ORDER_PAYMENT_UPDATE));
        assertFalse(access.uiCapabilities().contains(ORDER_AMOUNTS));
        assertFalse(access.uiCapabilities().contains(ORDER_CUSTOMER_DETAILS));
        assertTrue(EmployeeAccess.none().uiCapabilities().isEmpty());
    }

    @Test void accessIsAnImmutableSnapshot() {
        var permissions = EnumSet.of(ORDER_READ);
        var access = EmployeeAccess.of(permissions);
        permissions.add(EMPLOYEE_MANAGE);
        assertFalse(access.allows(EMPLOYEE_MANAGE));
        assertThrows(UnsupportedOperationException.class, () -> access.permissions().add(ORDER_PAYMENT_UPDATE));
        assertThrows(UnsupportedOperationException.class, () -> access.uiCapabilities().clear());
    }
}

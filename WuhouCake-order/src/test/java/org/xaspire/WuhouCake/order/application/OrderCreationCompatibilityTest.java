package org.xaspire.WuhouCake.order.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import static org.junit.jupiter.api.Assertions.*;

class OrderCreationCompatibilityTest {
    @Test void orderingMethodIsOnlyReturnedWithBusinessDetailsPermission() {
        var source = new org.xaspire.WuhouCake.order.api.dto.OrderViews.Detail(UUID.randomUUID(), "0000001", 0, "CAKE_BASE", "UNPAID", null,
                null, null, null, null, null, null, null, List.of(), null, null, null, "微信");
        var production = org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.of(Set.of(org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_READ));
        assertNull(org.xaspire.WuhouCake.order.application.service.OrderViewAccess.detail(source, production).orderingMethod());
        var business = org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.of(Set.of(org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_BUSINESS_DETAILS_READ));
        assertEquals("微信", org.xaspire.WuhouCake.order.application.service.OrderViewAccess.detail(source, business).orderingMethod());
    }

    @Test void absentOrderingMethodKeepsLegacyCreationFingerprintShape() throws Exception {
        var json = new ObjectMapper();
        var command = new OrderCommands.Create(null, null, List.of(), null);
        assertFalse(json.valueToTree(command).has("orderingMethod"));
        assertNull(json.readValue(json.writeValueAsBytes(command), OrderCommands.Create.class).orderingMethod());
        var withMethod = new OrderCommands.Create(null, null, List.of(), null, null, "微信");
        assertEquals("微信", json.valueToTree(withMethod).path("orderingMethod").asText());
    }

    @Test void omittedItemIdentifierKeepsTheLegacyCanonicalRequestShape() throws Exception {
        var json = new ObjectMapper();
        var legacy = new OrderCommands.Item("蛋糕", "CAKE", 1, null, null, Map.of());
        var node = json.valueToTree(legacy);
        assertFalse(node.has("itemId"));
        assertEquals(legacy, json.readValue(json.writeValueAsBytes(legacy), OrderCommands.Item.class));
        var id = UUID.randomUUID();
        var identified = new OrderCommands.Item("蛋糕", "CAKE", 1, null, null, Map.of(), id);
        assertEquals(id.toString(), json.valueToTree(identified).path("itemId").asText());
    }
}

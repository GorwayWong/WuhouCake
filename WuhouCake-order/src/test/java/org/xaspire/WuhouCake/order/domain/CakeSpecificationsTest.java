package org.xaspire.WuhouCake.order.domain;

import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.*;
import static org.junit.jupiter.api.Assertions.*;

class CakeSpecificationsTest {
    @Test void frontendAndBackendShareTheDefaultContract() throws Exception {
        try (var resource = getClass().getResourceAsStream("/order/cake-defaults.json")) {
            assertNotNull(resource);
            assertEquals(CakeSpecifications.DEFAULTS, new com.fasterxml.jackson.databind.ObjectMapper().readValue(resource, Map.class));
        }
    }
    @Test void normalizesNumericSizesAndRejectsInvalidWrites() {
        for (var entry : Map.of("8", "8", "08.00", "8", "4.5", "4.5", "6.50", "6.5").entrySet())
            assertEquals(entry.getValue(), CakeSpecifications.size(entry.getKey()));
        for (String value : List.of("8寸", "abc", "0", "-1", "1e2", "1.234", "1000000000", "NaN", "8/10"))
            assertThrows(OrderFailure.class, () -> item("CAKE", Map.of("size", value)));
        assertThrows(OrderFailure.class, () -> item("CAKE", Map.of("size", List.of(8))));
        assertThrows(OrderFailure.class, () -> item(" cake ", Map.of("size", "abc")));
    }
    @Test void defaultsApplyToCreationClearingAndOldReadsWithoutAffectingOtherProducts() {
        var cake = item("cake", Map.of("base", " ", "filling", ""));
        assertEquals(CakeSpecifications.DEFAULTS, cake.attributes());
        var changed = cake.revise(Map.of("attributes", Map.of("base", "巧克力", "filling", "草莓")), Instant.now());
        var clearing = new HashMap<String, Object>(); clearing.put("base", null); clearing.put("filling", " ");
        assertEquals(CakeSpecifications.DEFAULTS, changed.revise(Map.of("attributes", clearing), Instant.now()).attributes());
        assertTrue(item("CUPCAKE", Map.of()).attributes().isEmpty());
        var old = new OrderItem(UUID.randomUUID(), "旧单", "CAKE", 1, null, null, Map.of("size", "异常旧值"), "NOT_STARTED", null, false, Instant.EPOCH, Instant.EPOCH);
        assertEquals("原味", old.attributes().get("base"));
        assertEquals("异常旧值", old.revise(Map.of("quantity", 2), Instant.now()).attributes().get("size"));
        assertThrows(OrderFailure.class, () -> old.revise(Map.of("attributes", Map.of("size", "abc")), Instant.now()));
    }
    private static OrderItem item(String type, Map<String, Object> attributes) { return OrderItem.create(UUID.randomUUID(), "合成商品", type, 1, null, null, attributes, Instant.EPOCH); }
}

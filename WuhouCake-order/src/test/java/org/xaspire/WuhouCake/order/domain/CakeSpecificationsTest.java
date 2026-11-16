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
    @Test void everyDefaultHandlesMissingNullBlankAndExplicitValues() {
        var custom = Map.<String, Object>of("base", "巧克力", "filling", "草莓", "flavor", "巧克力奶油");
        assertEquals(custom, item("CAKE", custom).attributes());
        for (String key : CakeSpecifications.DEFAULTS.keySet()) {
            for (String blank : List.of("", " \t\n")) {
                assertEquals(CakeSpecifications.DEFAULTS, item("CAKE", Map.of(key, blank)).attributes());
                assertEquals(CakeSpecifications.DEFAULTS.get(key), item("CAKE", custom)
                        .revise(Map.of("attributes", Map.of(key, blank)), Instant.now()).attributes().get(key));
            }
            var clearing = new HashMap<String, Object>(); clearing.put(key, null);
            assertEquals(CakeSpecifications.DEFAULTS, item("CAKE", clearing).attributes());
            assertEquals(CakeSpecifications.DEFAULTS.get(key), item("CAKE", custom)
                    .revise(Map.of("attributes", clearing), Instant.now()).attributes().get(key));
        }
        assertEquals(CakeSpecifications.DEFAULTS, item("CAKE", null).attributes());
        var old = new OrderItem(UUID.randomUUID(), "旧单", "CAKE", 1, null, null, Map.of(), "NOT_STARTED", null, false, Instant.EPOCH, Instant.EPOCH);
        assertEquals(CakeSpecifications.DEFAULTS, old.attributes());
        for (String type : List.of("BREAD", "DONUT", "CUPCAKE", "DRINK")) assertTrue(item(type, Map.of()).attributes().isEmpty());
    }
    private static OrderItem item(String type, Map<String, Object> attributes) { return OrderItem.create(UUID.randomUUID(), "合成商品", type, 1, null, null, attributes, Instant.EPOCH); }
}

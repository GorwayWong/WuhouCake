package org.xaspire.WuhouCake.order.domain;

import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.junit.jupiter.api.Assertions.*;

class ProductPricingTest {
    private static final Instant NOW = Instant.EPOCH;
    @Test void newProductsDoNotWritePrices() {
        for (String type : Arrays.asList(null, "CAKE", " cake ", "DRINK", "OTHER")) {
            var item = OrderItem.create(UUID.randomUUID(), "商品", type, 2, 101, 0, Map.of(), NOW);
            assertNull(item.unitPriceCents()); assertNull(item.memberPriceCents());
            assertThrows(OrderFailure.class, () -> item.revise(Map.of("unitPriceCents", 200), NOW));
        }
    }
    @Test void historicalPricesSurviveTypeChangesAndRemainIndependentOfSpecs() {
        var legacy = new OrderItem(UUID.randomUUID(), "历史蛋糕", "CAKE", 1, 12000L, 0L,
                Map.of("requirements", "少糖", "specification", "六只装"), "NOT_STARTED", null, false, NOW, NOW);
        var converted = legacy.revise(Map.of("quantity", 2, "productType", "OTHER"), NOW.plusSeconds(1));
        assertEquals(12000L, converted.unitPriceCents()); assertEquals(0L, converted.memberPriceCents());
        assertEquals(Set.of("specification", "requirements"), converted.attributes().keySet());
        assertEquals("少糖", converted.attributes().get("requirements"));
        assertFalse(converted.attributes().get("specification").toString().contains("120.00"));
        assertEquals(converted.attributes(), converted.revise(Map.of("quantity", 3), NOW).attributes());
    }
}

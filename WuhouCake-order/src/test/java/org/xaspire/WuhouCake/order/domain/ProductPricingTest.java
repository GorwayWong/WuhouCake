package org.xaspire.WuhouCake.order.domain;

import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.junit.jupiter.api.Assertions.*;

class ProductPricingTest {
    private static final Instant NOW = Instant.EPOCH;
    @Test void newCakesIgnoreBothPricesAndOtherProductsKeepExactOptionalPrices() {
        for (String type : Arrays.asList(null, "CAKE", " cake ")) {
            var cake = OrderItem.create(UUID.randomUUID(), "蛋糕", type, 1, -1, 1.234, Map.of(), NOW);
            assertNull(cake.unitPriceCents()); assertNull(cake.memberPriceCents());
        }
        var drink = OrderItem.create(UUID.randomUUID(), "饮品", "DRINK", 2, 101, 0, Map.of(), NOW);
        assertEquals(101L, drink.unitPriceCents()); assertEquals(0L, drink.memberPriceCents());
        assertThrows(OrderFailure.class, () -> drink.revise(Map.of("unitPriceCents", -1), NOW));
        assertNull(OrderItem.create(UUID.randomUUID(), "饮品", "DRINK", 1, null, null, Map.of(), NOW).unitPriceCents());
    }
    @Test void historicalCakePricesRemainUntouchedUntilAnExplicitCategoryChange() {
        var legacy = new OrderItem(UUID.randomUUID(), "历史蛋糕", "CAKE", 1, 12000L, 10000L, Map.of(), "NOT_STARTED", null, false, NOW, NOW);
        var changed = legacy.revise(Map.of("quantity", 2, "unitPriceCents", -5, "memberPriceCents", 5000), NOW.plusSeconds(1));
        assertEquals(12000L, changed.unitPriceCents()); assertEquals(10000L, changed.memberPriceCents());
        var drink = legacy.revise(Map.of("productType", "DRINK"), NOW);
        assertNull(drink.unitPriceCents()); assertNull(drink.memberPriceCents());
        var explicit = legacy.revise(Map.of("productType", "DRINK", "unitPriceCents", 29, "memberPriceCents", 0), NOW);
        assertEquals(29L, explicit.unitPriceCents()); assertEquals(0L, explicit.memberPriceCents());
        var cake = explicit.revise(Map.of("productType", "CAKE", "unitPriceCents", 999), NOW);
        assertNull(cake.unitPriceCents()); assertNull(cake.memberPriceCents());
    }
}

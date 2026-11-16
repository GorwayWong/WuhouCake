package org.xaspire.WuhouCake.order.domain;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.ProductCategories;
import static org.junit.jupiter.api.Assertions.*;

class ProductCategoriesTest {
    @Test void nonCakeOrdersStillRequireAllManualStages() {
        var item = OrderItem.create(UUID.randomUUID(), "饮品", "DRINK", 2, null, null, Map.of(), Instant.now());
        var now = Instant.now();
        var order = org.xaspire.WuhouCake.order.domain.model.aggregate.Order.create(UUID.randomUUID(), "0000001",
                new org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.CustomerContact(null, "13800000000", null, null),
                new org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.FulfillmentPlan(org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.FulfillmentType.DELIVERY, "合成地址", java.time.LocalDate.of(2026, 10, 25), null, null),
                null, java.util.List.of(item), UUID.randomUUID(), now);
        assertThrows(org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure.class,
                () -> order.applyProductionAction("COMPLETE_LAYER", Instant.now()));
        order.applyProductionAction("COMPLETE_BASE", Instant.now());
        order.applyProductionAction("COMPLETE_LAYER", Instant.now());
        assertEquals("FROSTING", order.status());
        order.applyProductionAction("COMPLETE_FROSTING", Instant.now());
        assertEquals("OTHER_ITEMS_INCOMPLETE", assertThrows(org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure.class,
                () -> order.applyProductionAction("COMPLETE_DECORATION", Instant.now())).code());
        order.completeSimpleItem(item.itemId(), true, Instant.now());
        order.applyProductionAction("COMPLETE_DECORATION", Instant.now());
        assertEquals("WAITING_DELIVERY", order.status());
    }
    @Test void oldCodesWriteCanonicalCategoriesWithoutAddingCakeDefaults() {
        for (var old : java.util.List.of("DONUT", "CUPCAKE", "OTHER", "BREAD", "TEA_BREAK", "READY_BAKERY", "DRINK", "COOKIE", "SNACK")) {
            var item = OrderItem.create(UUID.randomUUID(), "历史商品", old, 1, null, null, Map.of("flavor", "保留的奶油"), Instant.now());
            assertEquals("OTHER", item.productType());
            assertEquals(Map.of("specification", "奶油：保留的奶油"), item.attributes());
            assertEquals(item.attributes(), item.revise(Map.of("name", "新名称"), Instant.now()).attributes());
        }
        assertEquals("历史分类", ProductCategories.label("历史分类"));
    }
}

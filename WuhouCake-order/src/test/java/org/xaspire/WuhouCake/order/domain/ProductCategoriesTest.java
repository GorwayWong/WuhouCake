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
        order.applyProductionAction("START_PRODUCTION", Instant.now());
        order.completeSimpleItem(item.itemId(), true, Instant.now());
        assertThrows(org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure.class, () -> order.applyProductionAction("COMPLETE_OTHER", Instant.now()));
        order.applyProductionAction("COMPLETE_LAYER", Instant.now());
        order.applyProductionAction("COMPLETE_FROSTING", Instant.now());
        order.applyProductionAction("COMPLETE_OTHER", Instant.now());
        order.applyProductionAction("COMPLETE_PRODUCTION", Instant.now());
        assertEquals("WAITING_DELIVERY", order.status());
    }
    @Test void oldCodesWriteCanonicalCategoriesWithoutAddingCakeDefaults() {
        for (var old : Map.of("DONUT", "TEA_BREAK", "CUPCAKE", "TEA_BREAK", "OTHER", "TEA_BREAK", "BREAD", "READY_BAKERY").entrySet()) {
            var item = OrderItem.create(UUID.randomUUID(), "历史商品", old.getKey(), 1, null, null, Map.of("flavor", "保留的奶油"), Instant.now());
            assertEquals(old.getValue(), item.productType());
            assertEquals(Map.of("flavor", "保留的奶油"), item.attributes());
            assertEquals(item.attributes(), item.revise(Map.of("name", "新名称"), Instant.now()).attributes());
        }
        assertEquals("历史分类", ProductCategories.label("历史分类"));
    }
}

package org.xaspire.WuhouCake.order.domain;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

import static org.junit.jupiter.api.Assertions.*;

class OrderTest {
    private static final Instant NOW = Instant.parse("2026-10-12T01:00:00Z");

    @Test void revisingOneItemPreservesOtherItemAndRecordsActualValues() {
        var first = item("蛋糕", Map.of("size", "8寸", "flavors", List.of("芒果")));
        var second = item("纸杯", Map.of("flavor", "香草"));
        var order = order(first, second);
        var details = order.reviseItem(first.itemId(), Map.of("quantity", 2, "attributes", Map.of("size", "10寸")), NOW.plusSeconds(1));
        assertEquals(1, order.version()); assertEquals(NOW.plusSeconds(1), order.updatedAt());
        assertEquals(2, order.requireActiveItem(first.itemId()).quantity());
        assertEquals(Map.of("size", "10寸", "flavors", List.of("芒果")), order.requireActiveItem(first.itemId()).attributes());
        assertEquals(second, order.requireActiveItem(second.itemId()));
        assertEquals(Map.of("quantity", BigDecimal.ONE, "attributes", first.attributes()), details.get("before"));
        assertEquals(Map.of("quantity", BigDecimal.valueOf(2), "attributes", order.requireActiveItem(first.itemId()).attributes()), details.get("after"));
    }
    @Test void snapshotsDoNotShareMutableInputAndSupportAttributeDeletionAndPriceClearing() {
        var flavors = new ArrayList<>(List.of("芒果"));
        var attributes = new LinkedHashMap<String, Object>();
        attributes.put("flavors", flavors); attributes.put("greeting", "生日快乐"); attributes.put("decoration", Map.of("color", "粉", "shape", "兔子"));
        var item = item("蛋糕", attributes); var order = order(item);
        flavors.add("草莓"); attributes.put("size", "12寸");
        var patch = new LinkedHashMap<String, Object>();
        patch.put("greeting", null); patch.put("decoration", Map.of("color", "白"));
        var changes = new LinkedHashMap<String, Object>();
        changes.put("attributes", patch); changes.put("memberPriceCents", null);
        var log = order.reviseItem(item.itemId(), changes, NOW.plusSeconds(1));
        var revised = order.requireActiveItem(item.itemId());
        assertEquals(List.of("芒果"), revised.attributes().get("flavors"));
        assertFalse(revised.attributes().containsKey("greeting")); assertFalse(revised.attributes().containsKey("size"));
        assertEquals(Map.of("color", "白"), revised.attributes().get("decoration")); assertNull(revised.memberPriceCents());
        assertEquals("生日快乐", ((Map<?, ?>) ((Map<?, ?>) log.get("before")).get("attributes")).get("greeting"));
        assertThrows(UnsupportedOperationException.class, () -> revised.attributes().put("size", "10寸"));
    }
    @Test void identicalChangesDoNotAdvanceVersionOrTimestamps() {
        var item = item("蛋糕", Map.of("size", "8寸", "weight", 1)); var order = order(item);
        assertTrue(order.reviseItem(item.itemId(), Map.of("quantity", 1, "attributes", Map.of("weight", 1.0)), NOW.plusSeconds(10)).isEmpty());
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        assertEquals(NOW, order.requireActiveItem(item.itemId()).updatedAt());
    }
    @Test void invalidChangesAndForeignItemsAreRejectedWithoutMutation() {
        var item = item("蛋糕", Map.of()); var order = order(item);
        for (var changes : List.of(Map.<String, Object>of(), Map.<String, Object>of("quantity", 0), Map.<String, Object>of("quantity", 1.5),
                Map.<String, Object>of("unitPriceCents", -1), Map.<String, Object>of("unitPriceCents", 100.5),
                Map.<String, Object>of("unitPriceCents", new BigDecimal("9223372036854775808")),
                Map.<String, Object>of("productionStatus", "READY"), Map.<String, Object>of("attributes", List.of("芒果")))) {
            assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.reviseItem(item.itemId(), changes, NOW)).code());
        }
        assertEquals("ORDER_NOT_FOUND", assertThrows(OrderFailure.class, () -> order.reviseItem(UUID.randomUUID(), Map.of("quantity", 2), NOW)).code());
        assertEquals(0, order.version()); assertEquals(item, order.requireActiveItem(item.itemId()));
    }
    @Test void formalOrdersRequireContactHandoffAndAnActiveItem() {
        assertThrows(OrderFailure.class, () -> new CustomerContact(null, " ", null, null));
        assertThrows(OrderFailure.class, () -> new FulfillmentPlan(FulfillmentType.DELIVERY, null, LocalDate.now(), NOW, null));
        assertThrows(OrderFailure.class, () -> new FulfillmentPlan(FulfillmentType.PICKUP, null, null, NOW, null));
        assertThrows(OrderFailure.class, () -> order());
        var order = order(item("蛋糕", Map.of()));
        assertEquals("WAITING_PRODUCTION", order.status()); assertEquals("UNPAID", order.paymentStatus());
        assertEquals(order.createdAt(), order.confirmedAt());
    }
    private static OrderItem item(String name, Map<String, Object> attributes) {
        return OrderItem.create(UUID.randomUUID(), name, null, 1, 10000, 8000, attributes, NOW);
    }
    private static Order order(OrderItem... items) {
        return Order.create(UUID.randomUUID(), "0000001", new CustomerContact("客户", "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(items), UUID.randomUUID(), NOW);
    }
}

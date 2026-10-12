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
    @Test void paymentCorrectionRecordsValuesWithoutChangingItemsAndIdenticalPaymentIsANoop() {
        var first = item("蛋糕", Map.of()); var second = item("预制品", Map.of()); var order = order(first, second);
        var change = order.changePaymentStatus("PAID", NOW.plusSeconds(1));
        assertEquals(Map.of("paymentStatus", "UNPAID"), change.get("before"));
        assertEquals(Map.of("paymentStatus", "PAID"), change.get("after"));
        assertEquals(1, order.version()); assertEquals(NOW.plusSeconds(1), order.updatedAt());
        assertEquals(first, order.requireActiveItem(first.itemId())); assertEquals(second, order.requireActiveItem(second.itemId()));
        assertTrue(order.changePaymentStatus("PAID", NOW.plusSeconds(2)).isEmpty());
        assertEquals(1, order.version()); assertEquals(NOW.plusSeconds(1), order.updatedAt());
        assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.changePaymentStatus("REFUNDED", NOW)).code());
        order.changePaymentStatus("UNPAID", NOW.plusSeconds(3));
        assertEquals("UNPAID", order.paymentStatus()); assertEquals(2, order.version());
    }
    @Test void manualOrderStagesPreserveItemsAndCompletionSynchronizesOnlyProductionStatus() {
        var first = item("蛋糕", Map.of("size", "8寸")); var second = item("预制品", Map.of()); var order = order(first, second);
        var started = order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
        assertEquals("PROCESSING", order.status()); assertEquals(2, ((List<?>) started.get("itemChanges")).size());
        var startedItems = order.activeItems();
        var layer = order.applyProductionAction("COMPLETE_LAYER", NOW.plusSeconds(2));
        assertEquals("LAYER_DONE", order.currentStageCode()); assertEquals(startedItems, order.activeItems());
        assertEquals(List.of(), layer.get("itemChanges"));
        assertNull(((Map<?, ?>) layer.get("before")).get("currentStageCode"));
        order.applyProductionAction("COMPLETE_FROSTING", NOW.plusSeconds(3));
        assertEquals("FROSTING_DONE", order.currentStageCode()); assertEquals(startedItems, order.activeItems());
        order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(4));
        assertEquals("WAITING_PICKUP", order.status()); assertEquals(4, order.version());
        for (var item : order.activeItems()) {
            assertEquals("COMPLETED", item.productionStatus()); assertNull(item.currentStageCode());
            assertEquals(NOW.plusSeconds(4), item.updatedAt());
        }
        assertEquals(first.businessValues(), order.requireActiveItem(first.itemId()).businessValues());
        assertEquals(second.businessValues(), order.requireActiveItem(second.itemId()).businessValues());
    }
    @Test void allProductTypesCanSkipStagesAndHandoffDependsOnFulfillment() {
        for (var type : FulfillmentType.values()) {
            var order = order(type, item("预制品", Map.of()), item("纸杯", Map.of()));
            order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
            order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(2));
            assertEquals(type == FulfillmentType.DELIVERY ? "WAITING_DELIVERY" : "WAITING_PICKUP", order.status());
            assertNull(order.currentStageCode()); assertEquals(2, order.version());
            assertTrue(order.activeItems().stream().allMatch(item -> item.productionStatus().equals("COMPLETED")));
        }
    }
    @Test void illegalAndRepeatedActionsDoNotMutateSavedProgress() {
        var order = order(item("蛋糕", Map.of()));
        for (var action : List.of("COMPLETE_LAYER", "COMPLETE_FROSTING", "COMPLETE_PRODUCTION", "REOPEN_PRODUCTION"))
            assertEquals("INVALID_PRODUCTION_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyProductionAction(action, NOW)).code());
        assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.applyProductionAction("CANCEL", NOW)).code());
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
        for (var action : List.of("START_PRODUCTION", "COMPLETE_FROSTING", "REOPEN_PRODUCTION"))
            assertEquals("INVALID_PRODUCTION_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyProductionAction(action, NOW)).code());
        order.applyProductionAction("COMPLETE_LAYER", NOW.plusSeconds(2));
        assertThrows(OrderFailure.class, () -> order.applyProductionAction("COMPLETE_LAYER", NOW));
        order.applyProductionAction("COMPLETE_FROSTING", NOW.plusSeconds(3));
        for (var action : List.of("COMPLETE_LAYER", "COMPLETE_FROSTING")) assertThrows(OrderFailure.class, () -> order.applyProductionAction(action, NOW));
        assertEquals(3, order.version()); assertEquals("FROSTING_DONE", order.currentStageCode()); assertEquals(NOW.plusSeconds(3), order.updatedAt());
        order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(4));
        var completedItems = order.activeItems();
        assertThrows(OrderFailure.class, () -> order.applyProductionAction("COMPLETE_PRODUCTION", NOW));
        assertEquals(4, order.version()); assertEquals(completedItems, order.activeItems());
    }
    @Test void reopeningClearsOrderStageAndAllowsAuditedItemChangesBeforeReconfirmation() {
        var first = item("蛋糕", Map.of()); var second = item("预制品", Map.of()); var order = order(first, second);
        order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
        order.applyProductionAction("COMPLETE_LAYER", NOW.plusSeconds(2));
        order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(3));
        assertEquals("ORDER_NOT_EDITABLE", assertThrows(OrderFailure.class,
                () -> order.reviseItem(first.itemId(), Map.of("quantity", 2), NOW.plusSeconds(4))).code());
        assertEquals(3, order.version());
        var reopened = order.applyProductionAction("REOPEN_PRODUCTION", NOW.plusSeconds(4));
        assertEquals("PROCESSING", order.status()); assertNull(order.currentStageCode());
        assertEquals("LAYER_DONE", ((Map<?, ?>) reopened.get("before")).get("currentStageCode"));
        assertEquals(2, ((List<?>) reopened.get("itemChanges")).size());
        var untouched = order.requireActiveItem(second.itemId());
        var changes = order.reviseItem(first.itemId(), Map.of("quantity", 2), NOW.plusSeconds(5));
        assertEquals(Map.of("quantity", BigDecimal.ONE), changes.get("before"));
        assertEquals(untouched, order.requireActiveItem(second.itemId()));
        order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(6));
        assertEquals("WAITING_PICKUP", order.status()); assertEquals(6, order.version());
    }
    @Test void synchronizingProductionSkipsRemovedAndAlreadyMatchingItems() {
        var active = item("蛋糕", Map.of());
        var inProgress = item("预制品", Map.of()).changeProductionStatus("IN_PROGRESS", NOW);
        var removed = new OrderItem(UUID.randomUUID(), "已移除", "CAKE", 1, null, null, Map.of(), "NOT_STARTED", null, true, NOW, NOW);
        var order = order(active, inProgress, removed);
        var change = order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
        assertEquals(1, ((List<?>) change.get("itemChanges")).size());
        assertEquals(inProgress, order.requireActiveItem(inProgress.itemId()));
        assertEquals(2, order.activeItems().size());
    }
    private static OrderItem item(String name, Map<String, Object> attributes) {
        return OrderItem.create(UUID.randomUUID(), name, null, 1, 10000, 8000, attributes, NOW);
    }
    private static Order order(OrderItem... items) {
        return order(FulfillmentType.PICKUP, items);
    }
    private static Order order(FulfillmentType type, OrderItem... items) {
        return Order.create(UUID.randomUUID(), "0000001", new CustomerContact("客户", "13800000000", null, null),
                new FulfillmentPlan(type, type == FulfillmentType.DELIVERY ? "示例地址" : null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(items), UUID.randomUUID(), NOW);
    }
}

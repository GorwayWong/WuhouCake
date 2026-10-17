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
        var first = item("蛋糕", Map.of("size", "8", "flavors", List.of("芒果")));
        var second = item("纸杯", Map.of("flavor", "香草"));
        var order = order(first, second);
        var details = order.reviseItem(first.itemId(), Map.of("quantity", 2, "attributes", Map.of("size", "10")), NOW.plusSeconds(1));
        assertEquals(1, order.version()); assertEquals(NOW.plusSeconds(1), order.updatedAt());
        assertEquals(2, order.requireActiveItem(first.itemId()).quantity());
        assertEquals(Map.of("size", "10", "flavors", List.of("芒果"), "base", "原味", "filling", "芒果"), order.requireActiveItem(first.itemId()).attributes());
        assertEquals(second, order.requireActiveItem(second.itemId()));
        assertEquals(Map.of("quantity", BigDecimal.ONE, "attributes", first.attributes()), details.get("before"));
        assertEquals(Map.of("quantity", BigDecimal.valueOf(2), "attributes", order.requireActiveItem(first.itemId()).attributes()), details.get("after"));
    }
    @Test void snapshotsDoNotShareMutableInputAndSupportAttributeDeletionAndPriceClearing() {
        var flavors = new ArrayList<>(List.of("芒果"));
        var attributes = new LinkedHashMap<String, Object>();
        attributes.put("flavors", flavors); attributes.put("greeting", "生日快乐"); attributes.put("decoration", Map.of("color", "粉", "shape", "兔子"));
        var item = item("蛋糕", attributes); var order = order(item);
        flavors.add("草莓"); attributes.put("size", "12");
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
        assertThrows(UnsupportedOperationException.class, () -> revised.attributes().put("size", "10"));
    }
    @Test void identicalChangesDoNotAdvanceVersionOrTimestamps() {
        var item = item("蛋糕", Map.of("size", "8", "weight", 1)); var order = order(item);
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
        var first = item("蛋糕", Map.of("size", "8")); var second = item("预制品", Map.of()); var order = order(first, second);
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
    @Test void deliveryMustStartBeforeCompletionAndPreservesProductionData() {
        var order = order(FulfillmentType.DELIVERY, item("蛋糕", Map.of()), item("纸杯", Map.of()));
        order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
        order.applyProductionAction("COMPLETE_LAYER", NOW.plusSeconds(2));
        order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(3));
        var items = order.activeItems();
        assertEquals("INVALID_FULFILLMENT_TRANSITION", assertThrows(OrderFailure.class,
                () -> order.applyFulfillmentAction("COMPLETE_DELIVERY", NOW.plusSeconds(4))).code());
        assertEquals("WAITING_DELIVERY", order.status()); assertEquals(3, order.version());
        var started = order.applyFulfillmentAction("START_DELIVERY", NOW.plusSeconds(4));
        assertEquals("START_DELIVERY", started.get("action")); assertEquals(Map.of("status", "WAITING_DELIVERY"), started.get("before"));
        assertEquals(Map.of("status", "DELIVERING"), started.get("after")); assertEquals(4, order.version());
        order.applyFulfillmentAction("COMPLETE_DELIVERY", NOW.plusSeconds(5));
        assertEquals("COMPLETED", order.status()); assertEquals(5, order.version()); assertEquals(NOW.plusSeconds(5), order.updatedAt());
        assertEquals("LAYER_DONE", order.currentStageCode()); assertEquals(items, order.activeItems()); assertEquals("UNPAID", order.paymentStatus());
        for (var action : List.of("START_DELIVERY", "COMPLETE_DELIVERY", "CONFIRM_PICKUP"))
            assertEquals("INVALID_FULFILLMENT_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyFulfillmentAction(action, NOW)).code());
        assertEquals(5, order.version()); assertEquals(NOW.plusSeconds(5), order.updatedAt());
    }
    @Test void pickupCompletesDirectlyAndFulfillmentTypesCannotBeMixed() {
        for (var type : FulfillmentType.values()) {
            var order = order(type, item("蛋糕", Map.of()));
            order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
            order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(2));
            var items = order.activeItems();
            var wrongActions = type == FulfillmentType.PICKUP ? List.of("START_DELIVERY", "COMPLETE_DELIVERY") : List.of("CONFIRM_PICKUP");
            for (var action : wrongActions)
                assertEquals("INVALID_FULFILLMENT_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyFulfillmentAction(action, NOW)).code());
            assertEquals(2, order.version()); assertEquals(NOW.plusSeconds(2), order.updatedAt());
            if (type == FulfillmentType.PICKUP) {
                order.applyFulfillmentAction("CONFIRM_PICKUP", NOW.plusSeconds(3));
                assertEquals("COMPLETED", order.status()); assertEquals(3, order.version()); assertEquals(items, order.activeItems());
            }
        }
    }
    @Test void fulfillmentBeforeProductionCompletionAndUnknownActionsDoNotMutate() {
        var order = order(FulfillmentType.DELIVERY, item("蛋糕", Map.of()));
        for (int stage = 0; stage < 2; stage++) {
            var version = order.version(); var updatedAt = order.updatedAt(); var status = order.status();
            for (var action : List.of("START_DELIVERY", "COMPLETE_DELIVERY", "CONFIRM_PICKUP"))
                assertEquals("INVALID_FULFILLMENT_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyFulfillmentAction(action, NOW)).code());
            for (var action : Arrays.asList(null, "", "DELIVER"))
                assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.applyFulfillmentAction(action, NOW)).code());
            assertEquals(version, order.version()); assertEquals(updatedAt, order.updatedAt()); assertEquals(status, order.status());
            if (stage == 0) order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
        }
    }
    @Test void everyNonterminalStateCanCancelWithoutChangingPaymentItemsOrStage() {
        for (var state : List.of("WAITING_PRODUCTION", "PROCESSING", "WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING")) {
            var order = order(state.equals("WAITING_PICKUP") ? FulfillmentType.PICKUP : FulfillmentType.DELIVERY, item("蛋糕", Map.of()));
            order.changePaymentStatus("PAID", NOW);
            if (!state.equals("WAITING_PRODUCTION")) {
                order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1));
                order.applyProductionAction("COMPLETE_LAYER", NOW.plusSeconds(2));
            }
            if (Set.of("WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING").contains(state))
                order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(3));
            if (state.equals("DELIVERING")) order.applyFulfillmentAction("START_DELIVERY", NOW.plusSeconds(4));
            assertEquals(state, order.status()); var version = order.version(); var items = order.activeItems(); var stage = order.currentStageCode();
            var changed = order.cancel(" 客户确认取消 ", NOW.plusSeconds(5));
            assertEquals(Map.of("status", state), changed.get("before")); assertEquals(Map.of("status", "CANCELLED"), changed.get("after"));
            assertEquals("CANCELLED", order.status()); assertEquals(version + 1, order.version()); assertEquals(NOW.plusSeconds(5), order.updatedAt());
            assertEquals("PAID", order.paymentStatus()); assertEquals(items, order.activeItems()); assertEquals(stage, order.currentStageCode());
            assertEquals("ORDER_NOT_CANCELLABLE", assertThrows(OrderFailure.class, () -> order.cancel("重复取消", NOW)).code());
            assertEquals("ORDER_NOT_EDITABLE", assertThrows(OrderFailure.class,
                    () -> order.reviseItem(items.getFirst().itemId(), Map.of("quantity", 2), NOW)).code());
            for (var action : List.of("START_PRODUCTION", "COMPLETE_LAYER", "COMPLETE_FROSTING", "COMPLETE_PRODUCTION", "REOPEN_PRODUCTION"))
                assertEquals("INVALID_PRODUCTION_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyProductionAction(action, NOW)).code());
            for (var action : List.of("START_DELIVERY", "COMPLETE_DELIVERY", "CONFIRM_PICKUP"))
                assertEquals("INVALID_FULFILLMENT_TRANSITION", assertThrows(OrderFailure.class, () -> order.applyFulfillmentAction(action, NOW)).code());
            assertEquals(version + 1, order.version());
            order.changePaymentStatus("UNPAID", NOW.plusSeconds(6));
            assertEquals("CANCELLED", order.status()); assertEquals(version + 2, order.version()); assertEquals(items, order.activeItems());
        }
    }
    @Test void cancellationRequiresAReasonAndCompletedOrdersCannotCancel() {
        var order = order(item("蛋糕", Map.of()));
        for (var reason : Arrays.asList(null, "", " \t "))
            assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.cancel(reason, NOW.plusSeconds(1))).code());
        assertEquals("WAITING_PRODUCTION", order.status()); assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        order.applyProductionAction("START_PRODUCTION", NOW.plusSeconds(1)); order.applyProductionAction("COMPLETE_PRODUCTION", NOW.plusSeconds(2));
        order.applyFulfillmentAction("CONFIRM_PICKUP", NOW.plusSeconds(3));
        assertEquals("ORDER_NOT_CANCELLABLE", assertThrows(OrderFailure.class, () -> order.cancel("客户取消", NOW)).code());
        assertEquals("COMPLETED", order.status()); assertEquals(3, order.version()); assertEquals(NOW.plusSeconds(3), order.updatedAt());
        order.changePaymentStatus("PAID", NOW.plusSeconds(4)); assertEquals("COMPLETED", order.status()); assertEquals(4, order.version());
    }
    private static Order order(OrderItem... items) {
        return order(FulfillmentType.PICKUP, items);
    }
    @Test void removalPreservesOtherItemsProductionAndOriginalSnapshot() {
        var first = item("蛋糕 A", Map.of("size", "8")); var second = item("蛋糕 B", Map.of("size", "6"));
        var order = order(first, second);
        order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW);
        var untouched = order.requireActiveItem(first.itemId()); var original = order.requireActiveItem(second.itemId());
        var changed = order.removeItem(second.itemId(), NOW.plusSeconds(1));
        assertEquals(3, order.version()); assertEquals("LAYER_DONE", order.currentStageCode()); assertEquals("PROCESSING", order.status());
        assertEquals(List.of(untouched), order.activeItems()); assertEquals(original.businessValues(), order.requireItem(second.itemId()).businessValues());
        assertTrue(order.requireItem(second.itemId()).removed());
        assertEquals(false, ((Map<?, ?>) changed.get("before")).get("isRemoved"));
        assertEquals(true, ((Map<?, ?>) changed.get("after")).get("isRemoved"));
        assertThrows(OrderFailure.class, () -> order.requireActiveItem(second.itemId()));
        assertTrue(order.removeItem(second.itemId(), NOW.plusSeconds(2)).isEmpty()); assertEquals(3, order.version());
        assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.removeItem(first.itemId(), NOW)).code());
        assertEquals(3, order.version()); assertEquals(List.of(untouched), order.activeItems());
    }
    @Test void additionsRequireManualReconfirmationForEveryProductTypeAndPreserveExistingItemsAndAmount() {
        for (var stage : List.of("WAITING_PRODUCTION", "PROCESSING", "LAYER_DONE", "FROSTING_DONE")) {
            var first = item("A", Map.of()); var second = item("B", Map.of()); var order = order(first, second);
            if (!stage.equals("WAITING_PRODUCTION")) order.applyProductionAction("START_PRODUCTION", NOW);
            if (Set.of("LAYER_DONE", "FROSTING_DONE").contains(stage)) order.applyProductionAction("COMPLETE_LAYER", NOW);
            if (stage.equals("FROSTING_DONE")) order.applyProductionAction("COMPLETE_FROSTING", NOW);
            var originalItems = order.activeItems(); long version = order.version(); String status = order.status();
            var added = OrderItem.create(UUID.randomUUID(), "其他商品 C", "OTHER", 1, 500, null, Map.of(), NOW.plusSeconds(1));
            var change = order.addItem(added, NOW.plusSeconds(1));
            assertEquals(status, order.status()); assertEquals(version + 1, order.version()); assertNull(order.currentStageCode());
            assertEquals(stage.equals("WAITING_PRODUCTION") ? "NOT_STARTED" : "IN_PROGRESS", order.requireActiveItem(added.itemId()).productionStatus());
            assertNull(order.requireActiveItem(added.itemId()).currentStageCode()); assertNull(order.totalAmountCents());
            for (var item : originalItems) assertEquals(item, order.requireActiveItem(item.itemId()));
            assertNull(((Map<?, ?>) change.get("before")).get("item"));
            assertEquals(added.itemId().toString(), ((Map<?, ?>) ((Map<?, ?>) change.get("after")).get("item")).get("itemId"));
            if (Set.of("LAYER_DONE", "FROSTING_DONE").contains(stage)) {
                assertEquals(stage, ((Map<?, ?>) change.get("before")).get("currentStageCode"));
                assertNull(((Map<?, ?>) change.get("after")).get("currentStageCode"));
                assertThrows(OrderFailure.class, () -> order.applyProductionAction("COMPLETE_FROSTING", NOW));
                order.applyProductionAction("COMPLETE_LAYER", NOW.plusSeconds(2));
                assertEquals("LAYER_DONE", order.currentStageCode());
            }
        }
    }
    @Test void informationCorrectionsPreserveProductionItemsAndOmittedFieldsAndRecordActualValues() {
        var order = order(FulfillmentType.DELIVERY, item("A", Map.of()), item("B", Map.of()));
        order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW);
        var items = order.activeItems(); var originalCustomer = order.customer();
        var changed = order.reviseInformation(Map.of("phone", " 13900000000 ", "address", "新地址", "plannedHandoffAt", "2026-10-17T12:00:00+08:00",
                "plannedFinishAt", "2026-10-17T11:00:00+08:00", "totalAmountCents", 18000), NOW.plusSeconds(1));
        assertEquals(3, order.version()); assertEquals("PROCESSING", order.status()); assertEquals("LAYER_DONE", order.currentStageCode());
        assertEquals(items, order.activeItems()); assertEquals(originalCustomer.customerName(), order.customer().customerName());
        assertEquals("13900000000", order.customer().phone()); assertEquals("新地址", order.fulfillment().address());
        assertEquals(LocalDate.of(2026, 10, 16), order.fulfillment().requestedReceiveDate());
        assertEquals(Instant.parse("2026-10-17T04:00:00Z"), order.fulfillment().plannedHandoffAt()); assertEquals(18000L, order.totalAmountCents());
        assertEquals("13800000000", ((Map<?, ?>) changed.get("before")).get("phone"));
        assertEquals("13900000000", ((Map<?, ?>) changed.get("after")).get("phone"));
        assertFalse(((Map<?, ?>) changed.get("before")).containsKey("customerName"));
        var clear = new LinkedHashMap<String, Object>(); clear.put("customerName", null); clear.put("plannedFinishAt", null); clear.put("totalAmountCents", null);
        order.reviseInformation(clear, NOW.plusSeconds(2)); assertNull(order.customer().customerName()); assertNull(order.fulfillment().plannedFinishAt());
        assertNull(order.totalAmountCents()); assertEquals(items, order.activeItems()); assertEquals("LAYER_DONE", order.currentStageCode());
        assertTrue(order.reviseInformation(clear, NOW.plusSeconds(3)).isEmpty()); assertEquals(4, order.version()); assertEquals(NOW.plusSeconds(2), order.updatedAt());
    }
    @Test void everyStateAllowsOrdinaryInformationAndAmountCorrectionsWithoutProductionChanges() {
        for (var state : List.of("WAITING_PRODUCTION", "PROCESSING", "WAITING_DELIVERY", "DELIVERING", "COMPLETED", "CANCELLED")) {
            var order = order(FulfillmentType.DELIVERY, item("A", Map.of()));
            if (!state.equals("WAITING_PRODUCTION")) { order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW); }
            if (Set.of("WAITING_DELIVERY", "DELIVERING", "COMPLETED").contains(state)) order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
            if (Set.of("DELIVERING", "COMPLETED").contains(state)) order.applyFulfillmentAction("START_DELIVERY", NOW);
            if (state.equals("COMPLETED")) order.applyFulfillmentAction("COMPLETE_DELIVERY", NOW);
            if (state.equals("CANCELLED")) order.cancel("取消", NOW);
            var items = order.activeItems(); var stage = order.currentStageCode(); var version = order.version();
            order.reviseInformation(Map.of("phone", "13900000000", "address", "更正地址", "requestedReceiveDate", "2026-10-18", "totalAmountCents", 0), NOW.plusSeconds(1));
            assertEquals(state, order.status()); assertEquals(stage, order.currentStageCode()); assertEquals(items, order.activeItems());
            assertEquals(version + 1, order.version()); assertEquals(0L, order.totalAmountCents());
        }
    }
    @Test void invalidInformationIsRejectedWithoutPartialMutationAndEquivalentTimesAreNoops() {
        var order = order(FulfillmentType.DELIVERY, item("A", Map.of())); var customer = order.customer(); var plan = order.fulfillment();
        var clearPhone = new LinkedHashMap<String, Object>(); clearPhone.put("phone", null);
        var clearAddress = new LinkedHashMap<String, Object>(); clearAddress.put("address", null);
        var clearDate = new LinkedHashMap<String, Object>(); clearDate.put("requestedReceiveDate", null);
        var clearHandoff = new LinkedHashMap<String, Object>(); clearHandoff.put("plannedHandoffAt", null);
        for (var patch : List.of(Map.<String, Object>of(), Map.<String, Object>of("status", "COMPLETED"), Map.<String, Object>of("phone", 123),
                Map.<String, Object>of("phone", "13900000000", "plannedHandoffAt", "invalid"), Map.<String, Object>of("requestedReceiveDate", "2026-02-30"),
                Map.<String, Object>of("totalAmountCents", 1.5), Map.<String, Object>of("totalAmountCents", -1), clearPhone, clearAddress, clearDate, clearHandoff))
            assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.reviseInformation(patch, NOW)).code());
        assertEquals(customer, order.customer()); assertEquals(plan, order.fulfillment()); assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        assertTrue(order.reviseInformation(Map.of("plannedHandoffAt", "2026-10-12T10:00:00+08:00", "phone", " 13800000000 "), NOW.plusSeconds(1)).isEmpty());
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
    }
    @Test void fulfillmentTypeCorrectionsAuditActualStatusAndPreserveProductionInEveryState() {
        for (var state : List.of("WAITING_PRODUCTION", "PROCESSING", "WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING", "COMPLETED", "CANCELLED")) {
            var initialType = state.equals("WAITING_PICKUP") ? FulfillmentType.PICKUP : FulfillmentType.DELIVERY;
            var order = order(initialType, item("A", Map.of()), item("B", Map.of()));
            if (!state.equals("WAITING_PRODUCTION")) { order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW); }
            if (Set.of("WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING", "COMPLETED", "CANCELLED").contains(state)) order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
            if (Set.of("DELIVERING", "COMPLETED", "CANCELLED").contains(state)) order.applyFulfillmentAction("START_DELIVERY", NOW);
            if (state.equals("COMPLETED")) order.applyFulfillmentAction("COMPLETE_DELIVERY", NOW);
            if (state.equals("CANCELLED")) order.cancel("配送中误操作后更正类型", NOW);
            assertEquals(state, order.status()); var items = order.activeItems(); var stage = order.currentStageCode(); var version = order.version();
            var targetType = initialType == FulfillmentType.DELIVERY ? "PICKUP" : "DELIVERY";
            var change = order.reviseInformation(Map.of("fulfillmentType", targetType, "address", "更正地址"), NOW.plusSeconds(1));
            String expectedStatus = Set.of("WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING").contains(state)
                    ? targetType.equals("DELIVERY") ? "WAITING_DELIVERY" : "WAITING_PICKUP" : state;
            assertEquals(expectedStatus, order.status()); assertEquals(targetType, order.fulfillment().type().name());
            assertEquals(stage, order.currentStageCode()); assertEquals(items, order.activeItems()); assertEquals(version + 1, order.version());
            assertEquals(initialType.name(), ((Map<?, ?>) change.get("before")).get("fulfillmentType"));
            assertEquals(targetType, ((Map<?, ?>) change.get("after")).get("fulfillmentType"));
            if (!expectedStatus.equals(state)) {
                assertEquals(state, ((Map<?, ?>) change.get("before")).get("status"));
                assertEquals(expectedStatus, ((Map<?, ?>) change.get("after")).get("status"));
            } else assertFalse(((Map<?, ?>) change.get("after")).containsKey("status"));
            assertTrue(order.reviseInformation(Map.of("fulfillmentType", targetType), NOW.plusSeconds(2)).isEmpty());
            assertEquals(version + 1, order.version());
        }
    }
    @Test void typeSwitchRequiresDeliveryAddressAndCompletedPickupCanCorrectToDelivery() {
        var order = order(item("A", Map.of()));
        assertThrows(OrderFailure.class, () -> order.reviseInformation(Map.of("fulfillmentType", "DELIVERY"), NOW));
        for (var value : Arrays.asList(null, "SHIP", 123)) {
            var changes = new LinkedHashMap<String, Object>(); changes.put("fulfillmentType", value);
            assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> order.reviseInformation(changes, NOW)).code());
        }
        assertEquals(0, order.version()); assertEquals(FulfillmentType.PICKUP, order.fulfillment().type());
        order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        order.applyFulfillmentAction("CONFIRM_PICKUP", NOW); var items = order.activeItems();
        order.reviseInformation(Map.of("fulfillmentType", "DELIVERY", "address", "更正地址"), NOW.plusSeconds(1));
        assertEquals("COMPLETED", order.status()); assertEquals(items, order.activeItems());
        var changes = new LinkedHashMap<String, Object>(); changes.put("fulfillmentType", "PICKUP"); changes.put("address", null);
        order.reviseInformation(changes, NOW.plusSeconds(2)); assertNull(order.fulfillment().address()); assertEquals("COMPLETED", order.status());
        assertEquals(5, order.version());
    }
    @Test void additionRejectsReadyTerminalDuplicateAndAlreadyProducedItemsWithoutMutation() {
        var existing = item("A", Map.of()); var order = order(existing);
        assertThrows(OrderFailure.class, () -> order.addItem(existing, NOW));
        assertThrows(OrderFailure.class, () -> order.addItem(item("B", Map.of()).changeProductionStatus("COMPLETED", NOW), NOW));
        assertEquals(0, order.version()); assertEquals(List.of(existing), order.activeItems());
        order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        assertEquals("ORDER_NOT_EDITABLE", assertThrows(OrderFailure.class, () -> order.addItem(item("C", Map.of()), NOW)).code());
        order.applyProductionAction("REOPEN_PRODUCTION", NOW); order.addItem(item("C", Map.of()), NOW);
        assertEquals(2, order.activeItems().size()); assertTrue(order.activeItems().stream().allMatch(i -> i.productionStatus().equals("IN_PROGRESS")));
        order.cancel("取消", NOW); assertThrows(OrderFailure.class, () -> order.addItem(item("D", Map.of()), NOW));
    }
    @Test void productionContentRemovalRequiresReopeningAndRejectsForeignItems() {
        var first = item("A", Map.of()); var second = item("B", Map.of()); var order = order(first, second);
        assertEquals("ORDER_NOT_FOUND", assertThrows(OrderFailure.class, () -> order.removeItem(UUID.randomUUID(), NOW)).code());
        order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        assertEquals("ORDER_NOT_EDITABLE", assertThrows(OrderFailure.class, () -> order.removeItem(second.itemId(), NOW)).code());
        assertEquals(2, order.version()); assertEquals(2, order.activeItems().size());
        order.applyProductionAction("REOPEN_PRODUCTION", NOW); order.removeItem(second.itemId(), NOW);
        order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        assertEquals("COMPLETED", order.requireActiveItem(first.itemId()).productionStatus());
        assertEquals("IN_PROGRESS", order.requireItem(second.itemId()).productionStatus());
    }
    private static Order order(FulfillmentType type, OrderItem... items) {
        return Order.create(UUID.randomUUID(), "0000001", new CustomerContact("客户", "13800000000", null, null),
                new FulfillmentPlan(type, type == FulfillmentType.DELIVERY ? "示例地址" : null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(items), UUID.randomUUID(), NOW);
    }
}

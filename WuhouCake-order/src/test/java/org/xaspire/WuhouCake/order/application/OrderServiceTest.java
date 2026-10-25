package org.xaspire.WuhouCake.order.application;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.context.ApplicationEventPublisher;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.mockito.ArgumentCaptor;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.repository.*;
import org.xaspire.WuhouCake.shared.id.IdGenerator;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-12T01:00:00Z");
    private final Orders orders = mock(Orders.class);
    private final OrderActivities activities = mock(OrderActivities.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final IdGenerator ids = mock(IdGenerator.class);
    private final org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity = mock(org.xaspire.WuhouCake.identity.api.facade.IdentityFacade.class);
    private final OrderService service = new OrderService(orders, activities, ids, Clock.fixed(NOW.plusSeconds(1), ZoneOffset.UTC), events, identity);
    private final OrderCommands.Operator operator = new OrderCommands.Operator(UUID.randomUUID(), "员工");
    @BeforeEach void lockLoadsTheOrder() {
        when(orders.lock(any())).thenAnswer(invocation -> orders.find(invocation.getArgument(0)));
    }

    @Test void identicalPaymentChecksDatabaseVersionWithoutWriting() {
        var order = order(); when(orders.find(order.id())).thenReturn(Optional.of(order));
        var detail = service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(0, "UNPAID"), operator);
        assertEquals(0, detail.version()); assertEquals(NOW, detail.updatedAt());
        verify(orders).verifyVersion(order.id(), 0);
        verify(orders, never()).changePaymentStatus(any(), anyLong());
        verify(activities, never()).append(any());
        verifyNoInteractions(events);
    }
    @Test void identicalPaymentRejectsVersionAdvancedAfterTheOrderWasLoaded() {
        var order = order(); when(orders.find(order.id())).thenReturn(Optional.of(order));
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).verifyVersion(order.id(), 0);
        assertEquals("CONCURRENT_MODIFICATION", assertThrows(OrderFailure.class,
                () -> service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(0, "UNPAID"), operator)).code());
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        verify(orders, never()).changePaymentStatus(any(), anyLong()); verifyNoInteractions(activities);
        verifyNoInteractions(events);
    }
    @Test void creationPublishesOnlyOrderIdentityAndInitialVersion() {
        when(identity.selectEmployee(operator.accountId())).thenReturn(new org.xaspire.WuhouCake.identity.api.facade.IdentityFacade.EmployeeOption(operator.accountId(), "0002", "员工", "ACTIVE"));
        when(ids.nextId()).thenAnswer(invocation -> UUID.randomUUID()); when(orders.nextNumber()).thenReturn("0000001");
        var command = new OrderCommands.Create(new OrderCommands.Customer("客户", "13800000000", null, null),
                new OrderCommands.Fulfillment("PICKUP", null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                List.of(new OrderCommands.Item("蛋糕", null, 1, null, null, Map.of())), null);
        var result = service.create(command, operator);
        verify(events).publishEvent(new OrderChanged(result.orderId(), null, OrderChanged.Type.CREATED, 0, result.orderNo()));
    }
    @Test void itemAndPaymentChangesPublishTheirCommittedVersions() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", 2)), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.ITEM_CHANGED, 1, order.orderNo()));
        service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(1, "PAID"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.PAYMENT_STATUS_CHANGED, 2, order.orderNo()));
    }
    @Test void layerIsAnOrderNotificationWithoutAnItemId() {
        var order = loaded();
        service.productionAction(order.id(), new OrderCommands.ProductionAction(0, "START_PRODUCTION"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 1, order.orderNo()));
        service.productionAction(order.id(), new OrderCommands.ProductionAction(1, "COMPLETE_LAYER"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 2, order.orderNo()));
    }
    @Test void itemAndOrderNotesPublishWithoutAdvancingVersion() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        when(activities.append(any())).thenAnswer(invocation -> invocation.getArgument(0));
        service.note(order.id(), new OrderCommands.Note(itemId, "客户要求少糖"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.NOTE, 0, order.orderNo()));
        service.note(order.id(), new OrderCommands.Note(null, "订单备注"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.NOTE, 0, order.orderNo()));
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        verify(orders, never()).reviseItem(any(), anyLong(), any());
    }
    @Test void identicalItemPatchDoesNotPublish() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", 1)), operator);
        verifyNoInteractions(events); verify(activities, never()).append(any());
        verify(orders, never()).reviseItem(any(), anyLong(), any());
        verify(orders).verifyVersion(order.id(), 0);
    }
    @Test void removalRecordsSnapshotAndHistoryRemainsQueryableWithVersionCheckedNoop() {
        var order = loaded();
        var item = OrderItem.create(UUID.randomUUID(), "商品 B", null, 1, null, null, Map.of("size", "6"), NOW);
        order = new Order(order.id(), order.orderNo(), 0, order.status(), order.paymentStatus(), null, order.customer(), order.fulfillment(),
                order.totalAmountCents(), order.createdBy(), NOW, NOW, NOW, List.of(order.activeItems().getFirst(), item));
        when(orders.find(order.id())).thenReturn(Optional.of(order));
        var result = service.removeItem(order.id(), item.itemId(), new OrderCommands.RemoveItem(0), operator);
        assertEquals(1, result.version()); assertEquals(1, result.items().size()); verify(orders).removeItem(order, 0, item.itemId());
        var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture());
        assertEquals("ITEM_REMOVED", logged.getValue().type()); assertEquals(item.itemId(), logged.getValue().itemId());
        assertEquals(operator.accountId(), logged.getValue().actorId()); assertEquals(NOW.plusSeconds(1), logged.getValue().createdAt());
        verify(events).publishEvent(new OrderChanged(order.id(), item.itemId(), OrderChanged.Type.ITEM_REMOVED, 1, order.orderNo()));
        assertDoesNotThrow(() -> service.activities(result.orderId(), item.itemId(), null, 1, 20));
        service.removeItem(order.id(), item.itemId(), new OrderCommands.RemoveItem(1), operator);
        verify(orders).verifyVersion(order.id(), 1); verify(activities, times(1)).append(any());
        verify(events, times(1)).publishEvent(any(Object.class));
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).verifyVersion(order.id(), 1);
        assertThrows(OrderFailure.class, () -> service.removeItem(result.orderId(), item.itemId(), new OrderCommands.RemoveItem(1), operator));
    }
    @Test void invalidChangesAndConflictsDoNotPublish() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        assertThrows(OrderFailure.class, () -> service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", -1)), operator));
        assertThrows(OrderFailure.class, () -> service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(0, "INVALID"), operator));
        assertThrows(OrderFailure.class, () -> service.productionAction(order.id(), new OrderCommands.ProductionAction(0, "COMPLETE_LAYER"), operator));
        assertThrows(OrderFailure.class, () -> service.revise(order.id(), new OrderCommands.Revise(1, itemId, Map.of("quantity", 2)), operator));
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).reviseItem(any(), eq(0L), eq(itemId));
        assertThrows(OrderFailure.class, () -> service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", 2)), operator));
        verifyNoInteractions(events);
    }
    @Test void additionUsesServerIdPersistsStageResetAndLogsActorAndSnapshot() {
        var order = loaded(); order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW);
        var original = order.activeItems().getFirst(); var itemId = UUID.randomUUID(); when(ids.nextId()).thenReturn(itemId);
        var input = new OrderCommands.Item("蛋糕 C", null, 1, 12000, null, Map.of("size", "6"));
        var result = service.addItem(order.id(), new OrderCommands.AddItem(2, input), operator);
        assertEquals(3, result.version()); assertNull(result.currentStageCode()); assertNull(result.totalAmountCents());
        assertEquals(original, order.requireActiveItem(original.itemId())); assertEquals("IN_PROGRESS", order.requireActiveItem(itemId).productionStatus());
        verify(orders).addItem(order, 2, itemId);
        var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture()); var activity = logged.getValue();
        assertEquals("ITEM_ADDED", activity.type()); assertEquals(itemId, activity.itemId()); assertEquals(operator.accountId(), activity.actorId());
        assertEquals(NOW.plusSeconds(1), activity.createdAt()); assertEquals("LAYER_DONE", ((Map<?, ?>) activity.details().get("before")).get("currentStageCode"));
        verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.ITEM_ADDED, 3, order.orderNo()));
    }
    @Test void additionRejectsStaleAndDatabaseConflictingVersionsBeforeActivityOrPublication() {
        var order = loaded(); var input = new OrderCommands.Item("C", null, 1, null, null, Map.of());
        assertThrows(OrderFailure.class, () -> service.addItem(order.id(), new OrderCommands.AddItem(1, input), operator));
        verifyNoInteractions(ids, activities, events);
        when(ids.nextId()).thenReturn(UUID.randomUUID());
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).addItem(any(), eq(0L), any());
        assertThrows(OrderFailure.class, () -> service.addItem(order.id(), new OrderCommands.AddItem(0, input), operator));
        verifyNoInteractions(activities, events);
    }
    @Test void informationCorrectionLogsRealValuesAndActorAndPublishesNewVersion() {
        var order = loaded(); order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW);
        var items = order.activeItems();
        var result = service.reviseInformation(order.id(), new OrderCommands.Information(2, Map.of("phone", "13900000000", "totalAmountCents", 20000)), operator);
        assertEquals(3, result.version()); assertEquals("LAYER_DONE", result.currentStageCode()); assertEquals(items, order.activeItems());
        verify(orders).reviseInformation(order, 2); var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture());
        var activity = logged.getValue(); assertEquals("ORDER_INFORMATION_CHANGED", activity.type()); assertNull(activity.itemId());
        assertEquals("13800000000", ((Map<?, ?>) activity.details().get("before")).get("phone"));
        assertEquals("13900000000", ((Map<?, ?>) activity.details().get("after")).get("phone"));
        assertEquals(operator.accountId(), activity.actorId()); assertEquals(operator.nickname(), activity.actorNameSnapshot());
        assertEquals(NOW.plusSeconds(1), activity.createdAt());
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_INFORMATION_CHANGED, 3, order.orderNo()));
    }
    @Test void informationNoopChecksCurrentDatabaseVersionAndRejectsRacesWithoutWriting() {
        var order = loaded(); var command = new OrderCommands.Information(0, Map.of("phone", "13800000000"));
        var result = service.reviseInformation(order.id(), command, operator); assertEquals(0, result.version()); assertEquals(NOW, result.updatedAt());
        verify(orders).verifyVersion(order.id(), 0); verify(orders, never()).reviseInformation(any(), anyLong()); verify(activities, never()).append(any()); verifyNoInteractions(events);
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).verifyVersion(order.id(), 0);
        assertThrows(OrderFailure.class, () -> service.reviseInformation(order.id(), command, operator)); verify(activities, never()).append(any()); verifyNoInteractions(events);
    }
    @Test void invalidAndConflictingInformationNeverWritesActivityOrPublishes() {
        var order = loaded();
        assertThrows(OrderFailure.class, () -> service.reviseInformation(order.id(), new OrderCommands.Information(1, Map.of("phone", "13900000000")), operator));
        assertThrows(OrderFailure.class, () -> service.reviseInformation(order.id(), new OrderCommands.Information(0, Map.of("totalAmountCents", -1)), operator));
        verify(orders, never()).reviseInformation(any(), anyLong());
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).reviseInformation(any(), eq(0L));
        assertThrows(OrderFailure.class, () -> service.reviseInformation(order.id(), new OrderCommands.Information(0, Map.of("phone", "13900000000")), operator));
        verifyNoInteractions(activities, events);
    }
    @Test void newMutationActivityFailuresPreventPublication() {
        doThrow(new IllegalStateException("activity unavailable")).when(activities).append(any());
        var order = loaded();
        assertThrows(IllegalStateException.class, () -> service.reviseInformation(order.id(), new OrderCommands.Information(0, Map.of("phone", "13900000000")), operator));
        var other = loaded(); when(ids.nextId()).thenReturn(UUID.randomUUID());
        assertThrows(IllegalStateException.class, () -> service.addItem(other.id(), new OrderCommands.AddItem(0,
                new OrderCommands.Item("C", null, 1, null, null, Map.of())), operator));
        verifyNoInteractions(events);
    }
    @Test void identicalItemPatchRejectsDatabaseVersionAdvancedAfterLoading() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).verifyVersion(order.id(), 0);
        assertEquals("CONCURRENT_MODIFICATION", assertThrows(OrderFailure.class,
                () -> service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", 1)), operator)).code());
        verify(orders, never()).reviseItem(any(), anyLong(), any()); verifyNoInteractions(activities, events);
    }
    @Test void activityFailurePreventsPublication() {
        var order = loaded(); doThrow(new IllegalStateException("unavailable")).when(activities).append(any());
        assertThrows(IllegalStateException.class, () -> service.note(order.id(), new OrderCommands.Note(null, "备注"), operator));
        assertThrows(IllegalStateException.class, () -> service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(0, "PAID"), operator));
        verifyNoInteractions(events);
    }
    private Order loaded() {
        var order = order(); when(orders.find(order.id())).thenReturn(Optional.of(order)); return order;
    }
    @Test void fulfillmentPersistsStatusAndRecordsActorActionAndNotification() {
        var order = loaded(); finishProduction(order);
        var items = order.activeItems();
        var result = service.fulfillmentAction(order.id(), new OrderCommands.FulfillmentAction(6, "CONFIRM_PICKUP"), operator);
        assertEquals("COMPLETED", result.status()); assertEquals(7, result.version()); assertEquals(NOW.plusSeconds(1), result.updatedAt());
        assertEquals(items, order.activeItems()); verify(orders).changeStatus(order, 6);
        var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture());
        var activity = logged.getValue(); assertEquals("ORDER_FULFILLMENT_CHANGED", activity.type()); assertNull(activity.itemId());
        assertEquals("CONFIRM_PICKUP", activity.details().get("action")); assertEquals(Map.of("status", "WAITING_PICKUP"), activity.details().get("before"));
        assertEquals(Map.of("status", "COMPLETED"), activity.details().get("after")); assertEquals(operator.accountId(), activity.actorId());
        assertEquals(operator.nickname(), activity.actorNameSnapshot()); assertEquals(NOW.plusSeconds(1), activity.createdAt());
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_FULFILLMENT_CHANGED, 7, order.orderNo()));
    }
    @Test void cancellationRecordsTrimmedReasonAndPreservesPaymentStageAndNotes() {
        var order = loaded(); order.changePaymentStatus("PAID", NOW); order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_LAYER", NOW);
        var itemId = order.activeItems().getFirst().itemId(); var items = order.activeItems();
        when(activities.recentItemNotes(order.id())).thenReturn(List.of(OrderActivity.append(order.id(), itemId, "NOTE", "已有备注", Map.of(),
                new Actor(operator.accountId(), operator.nickname()), NOW)));
        var result = service.cancel(order.id(), new OrderCommands.Cancel(3, " 客户确认取消 "), operator);
        assertEquals("CANCELLED", result.status()); assertEquals("PAID", result.paymentStatus()); assertEquals("LAYER_DONE", result.currentStageCode());
        assertEquals(items, order.activeItems()); assertEquals("已有备注", result.items().getFirst().recentNotes().getFirst().content());
        assertEquals(4, result.version()); assertEquals(NOW.plusSeconds(1), result.updatedAt()); verify(orders).changeStatus(order, 3);
        var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture()); var activity = logged.getValue();
        assertEquals("ORDER_CANCELLED", activity.type()); assertEquals("客户确认取消", activity.content()); assertNull(activity.itemId());
        assertEquals(Map.of("status", "PROCESSING"), activity.details().get("before")); assertEquals(Map.of("status", "CANCELLED"), activity.details().get("after"));
        assertEquals(operator.accountId(), activity.actorId()); assertEquals(operator.nickname(), activity.actorNameSnapshot());
        assertEquals(NOW.plusSeconds(1), activity.createdAt()); verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_CANCELLED, 4, order.orderNo()));
    }
    @Test void terminalOrdersStillAllowNotesAndPaymentCorrection() {
        for (boolean completed : List.of(false, true)) {
            var order = loaded();
            if (completed) {
                finishProduction(order); order.applyFulfillmentAction("CONFIRM_PICKUP", NOW);
            } else order.cancel("取消", NOW);
            long version = order.version(); String status = order.status(); var itemId = order.activeItems().getFirst().itemId();
            when(activities.append(any())).thenAnswer(invocation -> invocation.getArgument(0));
            service.note(order.id(), new OrderCommands.Note(itemId, "人工处理备注"), operator);
            assertEquals(version, order.version()); assertEquals(status, order.status());
            verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.NOTE, version, order.orderNo()));
            service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(version, "PAID"), operator);
            assertEquals(version + 1, order.version()); assertEquals(status, order.status());
            verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.PAYMENT_STATUS_CHANGED, version + 1, order.orderNo()));
        }
    }
    @Test void invalidFulfillmentCancellationAndStaleVersionsNeverPublishOrPersist() {
        var order = loaded();
        assertThrows(OrderFailure.class, () -> service.fulfillmentAction(order.id(), new OrderCommands.FulfillmentAction(0, "CONFIRM_PICKUP"), operator));
        assertThrows(OrderFailure.class, () -> service.fulfillmentAction(order.id(), new OrderCommands.FulfillmentAction(0, "UNKNOWN"), operator));
        assertThrows(OrderFailure.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(0, " "), operator));
        assertThrows(OrderFailure.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(1, "取消"), operator));
        assertThrows(OrderFailure.class, () -> service.fulfillmentAction(order.id(), new OrderCommands.FulfillmentAction(1, "CONFIRM_PICKUP"), operator));
        assertThrows(OrderFailure.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(0.5, "取消"), operator));
        assertThrows(OrderFailure.class, () -> service.fulfillmentAction(order.id(), new OrderCommands.FulfillmentAction(-1, "CONFIRM_PICKUP"), operator));
        assertEquals("WAITING_PRODUCTION", order.status()); assertEquals(0, order.version());
        verify(orders, never()).changeStatus(any(), anyLong()); verifyNoInteractions(activities, events);
    }
    @Test void databaseStatusConflictsPreventActivitiesAndNotifications() {
        var ready = loaded(); finishProduction(ready);
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).changeStatus(any(), anyLong());
        assertThrows(OrderFailure.class, () -> service.fulfillmentAction(ready.id(), new OrderCommands.FulfillmentAction(6, "CONFIRM_PICKUP"), operator));
        verifyNoInteractions(activities, events);
        var order = loaded();
        assertThrows(OrderFailure.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(0, "取消"), operator));
        verifyNoInteractions(activities, events);
    }
    @Test void activityFailureAfterStatusUpdateDoesNotPublish() {
        var order = loaded(); doThrow(new IllegalStateException("unavailable")).when(activities).append(any());
        assertThrows(IllegalStateException.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(0, "取消"), operator));
        verify(orders).changeStatus(order, 0); verifyNoInteractions(events);
        var ready = loaded(); finishProduction(ready);
        assertThrows(IllegalStateException.class, () -> service.fulfillmentAction(ready.id(), new OrderCommands.FulfillmentAction(6, "CONFIRM_PICKUP"), operator));
        verify(orders).changeStatus(ready, 6); verifyNoInteractions(events);
    }
    @Test void restartingCancelledOrderPersistsItemResetAndAuditsOneVersionedChange() {
        var order = loaded(); var item = order.activeItems().getFirst();
        order.applyProductionAction("START_PRODUCTION", NOW); order.completeSimpleItem(item.itemId(), true, NOW);
        order.changePaymentStatus("PAID", NOW); order.cancel("客户取消", NOW); var expected = order.version();
        var result = service.restartCancelled(order.id(), new OrderCommands.Restart(expected), operator);
        assertEquals("WAITING_PRODUCTION", result.status()); assertNull(result.currentStageCode());
        assertEquals(expected + 1, result.version()); assertEquals("PAID", result.paymentStatus()); assertEquals(NOW, result.paidAt());
        assertEquals("NOT_STARTED", result.items().getFirst().productionStatus());
        verify(orders).changeProduction(order, expected, List.of(item.itemId()));
        var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture());
        assertEquals("ORDER_PRODUCTION_CHANGED", logged.getValue().type());
        assertEquals("RESTART_CANCELLED", logged.getValue().details().get("action"));
        assertEquals("CANCELLED", ((Map<?, ?>) logged.getValue().details().get("before")).get("status"));
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, expected + 1, order.orderNo()));
    }
    @Test void invalidOrConflictingRestartDoesNotPublishOrPersist() {
        var order = loaded();
        for (Number version : List.of(0, 1, 0.5, -1))
            assertThrows(OrderFailure.class, () -> service.restartCancelled(order.id(), new OrderCommands.Restart(version), operator));
        verify(orders, never()).changeProduction(any(), anyLong(), any()); verifyNoInteractions(activities, events);
        order.cancel("取消", NOW);
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).changeProduction(any(), anyLong(), any());
        assertThrows(OrderFailure.class, () -> service.restartCancelled(order.id(), new OrderCommands.Restart(1), operator));
        verifyNoInteractions(activities, events);
    }
    private void finishProduction(Order order) {
        order.applyProductionAction("START_PRODUCTION", NOW);
        order.applyProductionAction("COMPLETE_LAYER", NOW); order.applyProductionAction("COMPLETE_FROSTING", NOW);
        for (var item : order.activeItems()) order.completeSimpleItem(item.itemId(), true, NOW);
        order.applyProductionAction("COMPLETE_OTHER", NOW); order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
    }
    private Order order() {
        return Order.create(UUID.randomUUID(), "0000001", new CustomerContact(null, "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(OrderItem.create(UUID.randomUUID(), "蛋糕", null, 1, null, null, Map.of(), NOW)), operator.accountId(), NOW);
    }
}

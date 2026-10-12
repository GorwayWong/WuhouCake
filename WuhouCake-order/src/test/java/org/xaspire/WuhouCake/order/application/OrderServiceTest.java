package org.xaspire.WuhouCake.order.application;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
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
    private final OrderService service = new OrderService(orders, activities, ids, Clock.fixed(NOW.plusSeconds(1), ZoneOffset.UTC), events);
    private final OrderCommands.Operator operator = new OrderCommands.Operator(UUID.randomUUID(), "员工");

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
        when(ids.nextId()).thenAnswer(invocation -> UUID.randomUUID()); when(orders.nextNumber()).thenReturn("0000001");
        var command = new OrderCommands.Create(new OrderCommands.Customer("客户", "13800000000", null, null),
                new OrderCommands.Fulfillment("PICKUP", null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                List.of(new OrderCommands.Item("蛋糕", null, 1, null, null, Map.of())), null);
        var result = service.create(command, operator);
        verify(events).publishEvent(new OrderChanged(result.orderId(), null, OrderChanged.Type.CREATED, 0));
    }
    @Test void itemAndPaymentChangesPublishTheirCommittedVersions() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", 2)), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.ITEM_CHANGED, 1));
        service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(1, "PAID"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.PAYMENT_STATUS_CHANGED, 2));
    }
    @Test void layerIsAnOrderNotificationWithoutAnItemId() {
        var order = loaded();
        service.productionAction(order.id(), new OrderCommands.ProductionAction(0, "START_PRODUCTION"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 1));
        service.productionAction(order.id(), new OrderCommands.ProductionAction(1, "COMPLETE_LAYER"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED, 2));
    }
    @Test void itemAndOrderNotesPublishWithoutAdvancingVersion() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        when(activities.append(any())).thenAnswer(invocation -> invocation.getArgument(0));
        service.note(order.id(), new OrderCommands.Note(itemId, "客户要求少糖"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.NOTE, 0));
        service.note(order.id(), new OrderCommands.Note(null, "订单备注"), operator);
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.NOTE, 0));
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        verify(orders, never()).reviseItem(any(), anyLong(), any());
    }
    @Test void identicalItemPatchDoesNotPublish() {
        var order = loaded(); var itemId = order.activeItems().getFirst().itemId();
        service.revise(order.id(), new OrderCommands.Revise(0, itemId, Map.of("quantity", 1)), operator);
        verifyNoInteractions(events); verify(activities, never()).append(any());
        verify(orders, never()).reviseItem(any(), anyLong(), any());
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
        var order = loaded(); order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        var items = order.activeItems();
        var result = service.fulfillmentAction(order.id(), new OrderCommands.FulfillmentAction(2, "CONFIRM_PICKUP"), operator);
        assertEquals("COMPLETED", result.status()); assertEquals(3, result.version()); assertEquals(NOW.plusSeconds(1), result.updatedAt());
        assertEquals(items, order.activeItems()); verify(orders).changeStatus(order, 2);
        var logged = ArgumentCaptor.forClass(OrderActivity.class); verify(activities).append(logged.capture());
        var activity = logged.getValue(); assertEquals("ORDER_FULFILLMENT_CHANGED", activity.type()); assertNull(activity.itemId());
        assertEquals("CONFIRM_PICKUP", activity.details().get("action")); assertEquals(Map.of("status", "WAITING_PICKUP"), activity.details().get("before"));
        assertEquals(Map.of("status", "COMPLETED"), activity.details().get("after")); assertEquals(operator.accountId(), activity.actorId());
        assertEquals(operator.nickname(), activity.actorNameSnapshot()); assertEquals(NOW.plusSeconds(1), activity.createdAt());
        verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_FULFILLMENT_CHANGED, 3));
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
        assertEquals(NOW.plusSeconds(1), activity.createdAt()); verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.ORDER_CANCELLED, 4));
    }
    @Test void terminalOrdersStillAllowNotesAndPaymentCorrection() {
        for (boolean completed : List.of(false, true)) {
            var order = loaded();
            if (completed) {
                order.applyProductionAction("START_PRODUCTION", NOW); order.applyProductionAction("COMPLETE_PRODUCTION", NOW); order.applyFulfillmentAction("CONFIRM_PICKUP", NOW);
            } else order.cancel("取消", NOW);
            long version = order.version(); String status = order.status(); var itemId = order.activeItems().getFirst().itemId();
            when(activities.append(any())).thenAnswer(invocation -> invocation.getArgument(0));
            service.note(order.id(), new OrderCommands.Note(itemId, "人工处理备注"), operator);
            assertEquals(version, order.version()); assertEquals(status, order.status());
            verify(events).publishEvent(new OrderChanged(order.id(), itemId, OrderChanged.Type.NOTE, version));
            service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(version, "PAID"), operator);
            assertEquals(version + 1, order.version()); assertEquals(status, order.status());
            verify(events).publishEvent(new OrderChanged(order.id(), null, OrderChanged.Type.PAYMENT_STATUS_CHANGED, version + 1));
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
        var ready = loaded(); ready.applyProductionAction("START_PRODUCTION", NOW); ready.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).changeStatus(any(), anyLong());
        assertThrows(OrderFailure.class, () -> service.fulfillmentAction(ready.id(), new OrderCommands.FulfillmentAction(2, "CONFIRM_PICKUP"), operator));
        verifyNoInteractions(activities, events);
        var order = loaded();
        assertThrows(OrderFailure.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(0, "取消"), operator));
        verifyNoInteractions(activities, events);
    }
    @Test void activityFailureAfterStatusUpdateDoesNotPublish() {
        var order = loaded(); doThrow(new IllegalStateException("unavailable")).when(activities).append(any());
        assertThrows(IllegalStateException.class, () -> service.cancel(order.id(), new OrderCommands.Cancel(0, "取消"), operator));
        verify(orders).changeStatus(order, 0); verifyNoInteractions(events);
        var ready = loaded(); ready.applyProductionAction("START_PRODUCTION", NOW); ready.applyProductionAction("COMPLETE_PRODUCTION", NOW);
        assertThrows(IllegalStateException.class, () -> service.fulfillmentAction(ready.id(), new OrderCommands.FulfillmentAction(2, "CONFIRM_PICKUP"), operator));
        verify(orders).changeStatus(ready, 2); verifyNoInteractions(events);
    }
    private Order order() {
        return Order.create(UUID.randomUUID(), "0000001", new CustomerContact(null, "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(OrderItem.create(UUID.randomUUID(), "蛋糕", null, 1, null, null, Map.of(), NOW)), operator.accountId(), NOW);
    }
}

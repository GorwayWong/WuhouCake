package org.xaspire.WuhouCake.order.application;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
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
    private final OrderService service = new OrderService(orders, activities, mock(IdGenerator.class), Clock.fixed(NOW.plusSeconds(1), ZoneOffset.UTC));
    private final OrderCommands.Operator operator = new OrderCommands.Operator(UUID.randomUUID(), "员工");

    @Test void identicalPaymentChecksDatabaseVersionWithoutWriting() {
        var order = order(); when(orders.find(order.id())).thenReturn(Optional.of(order));
        var detail = service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(0, "UNPAID"), operator);
        assertEquals(0, detail.version()); assertEquals(NOW, detail.updatedAt());
        verify(orders).verifyVersion(order.id(), 0);
        verify(orders, never()).changePaymentStatus(any(), anyLong());
        verify(activities, never()).append(any());
    }
    @Test void identicalPaymentRejectsVersionAdvancedAfterTheOrderWasLoaded() {
        var order = order(); when(orders.find(order.id())).thenReturn(Optional.of(order));
        doThrow(new OrderFailure("CONCURRENT_MODIFICATION")).when(orders).verifyVersion(order.id(), 0);
        assertEquals("CONCURRENT_MODIFICATION", assertThrows(OrderFailure.class,
                () -> service.changePaymentStatus(order.id(), new OrderCommands.PaymentStatus(0, "UNPAID"), operator)).code());
        assertEquals(0, order.version()); assertEquals(NOW, order.updatedAt());
        verify(orders, never()).changePaymentStatus(any(), anyLong()); verifyNoInteractions(activities);
    }
    private Order order() {
        return Order.create(UUID.randomUUID(), "0000001", new CustomerContact(null, "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(OrderItem.create(UUID.randomUUID(), "蛋糕", null, 1, null, null, Map.of(), NOW)), operator.accountId(), NOW);
    }
}

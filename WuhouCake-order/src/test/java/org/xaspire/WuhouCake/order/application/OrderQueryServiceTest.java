package org.xaspire.WuhouCake.order.application;

import java.time.*;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.order.application.service.OrderViewAccess;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderQueryServiceTest {
    private final OrderQueries queries = mock(OrderQueries.class);
    private final OrderQueryService service = new OrderQueryService(queries, java.time.Clock.systemUTC());
    @Test void productionSummaryUsesShanghaiBoundariesAndFillsZeroDays() {
        var from = LocalDate.of(2026, 10, 31);
        var to = LocalDate.of(2026, 11, 2);
        when(queries.productionCounts(Instant.parse("2026-10-30T16:00:00Z"), Instant.parse("2026-11-01T16:00:00Z"), java.util.Set.of("LAYER")))
                .thenReturn(List.of(new OrderQueries.ProductionDay(from, 3), new OrderQueries.ProductionDay(null, 2)));
        var summary = service.productionSummary(from, to, "LAYER");
        assertEquals(3, summary.total());
        assertEquals(2, summary.unscheduled());
        assertEquals(0, summary.days().getLast().orderCount());
        assertThrows(OrderFailure.class, () -> service.productionSummary(from, from.plusDays(43), null));
        assertThrows(OrderFailure.class, () -> service.productionSummary(from, to, "WAITING_DELIVERY"));
    }

    @Test void unscheduledProductionDetailsClampThePageAndRejectConflictingBuckets() {
        var stages = java.util.Set.of("DECORATING");
        when(queries.productionOrderCount(null, null, stages)).thenReturn(21L);
        var result = service.productionOrders(null, true, "DECORATING", 9);
        assertEquals(2, result.page());
        assertEquals(21, result.total());
        verify(queries).productionOrders(null, null, stages, 20, 20);
        assertThrows(OrderFailure.class, () -> service.productionOrders(LocalDate.of(2026, 11, 1), true, null, 1));
        assertThrows(OrderFailure.class, () -> service.productionOrders(null, false, null, 1));
        assertThrows(OrderFailure.class, () -> service.productionOrders(null, true, null, 0));
    }

    @Test void workbenchPreservesRequestedReceiveTimeIndependentlyOfHandoffAndProductionTimes() {
        var date = LocalDate.of(2026, 11, 2);
        var receiveAt = Instant.parse("2026-11-02T10:00:00Z");
        var handoffAt = Instant.parse("2026-11-02T09:00:00Z");
        var finishAt = Instant.parse("2026-11-02T08:00:00Z");
        var id = UUID.randomUUID();
        when(queries.pending(date)).thenReturn(List.of(
                new OrderQueries.PendingOrder(id, "001", date, "CAKE_BASE", null, "UNPAID", "DELIVERY",
                        handoffAt, null, "13800000000", null, null, null, finishAt, receiveAt),
                new OrderQueries.PendingOrder(UUID.randomUUID(), "002", date, "CAKE_BASE", null, "UNPAID", "DELIVERY",
                        handoffAt, null, "13800000000", null, null, null, finishAt, null)));
        var result = service.workbench(date, false);
        var productionAccess = EmployeeAccess.of(java.util.Set.of(EmployeeAccess.Permission.ORDER_READ));
        var projected = OrderViewAccess.workbench(result, productionAccess).pendingOrders();
        assertEquals(receiveAt, projected.getFirst().requestedReceiveAt());
        assertEquals(handoffAt, projected.getFirst().plannedHandoffAt());
        assertEquals(finishAt, projected.getFirst().plannedFinishAt());
        assertNull(projected.getFirst().customer());
        assertNull(projected.get(1).requestedReceiveAt());
        assertEquals(date, projected.get(1).calendarDate());
    }
    @Test void paymentOrdersUsesShanghaiRangeAndClampsPageAfterRemoval() {
        var date = LocalDate.of(2026, 10, 23);
        var from = Instant.parse("2026-10-22T16:00:00Z");
        var to = Instant.parse("2026-10-23T16:00:00Z");
        assertThrows(OrderFailure.class, () -> service.paymentOrders(date, "BAD", 1));
        assertThrows(OrderFailure.class, () -> service.paymentOrders(date, "RECEIPT", 0));
        verifyNoInteractions(queries);
        when(queries.paymentOrderCount(date, "RECEIPT", from, to)).thenReturn(11L);
        when(queries.paymentOrders(date, "RECEIPT", from, to, 10L)).thenReturn(List.of());
        var result = service.paymentOrders(date, "RECEIPT", 5);
        assertEquals(2, result.page());
        assertEquals(11, result.total());
        verify(queries).paymentOrders(date, "RECEIPT", from, to, 10L);
    }

    @Test void paymentSummaryIsADateOnlyAggregateAndKeepsExactAmountsAndMissingCounts() {
        var date = LocalDate.of(2026, 10, 23);
        assertThrows(OrderFailure.class, () -> service.paymentSummary(null));
        verifyNoInteractions(queries);
        when(queries.paymentSummary(date)).thenReturn(new OrderQueries.PaymentSummary(5, 1, 3, "9223372036854775808", 1, 2, "0", 2, 2));
        var result = service.paymentSummary(date);
        assertEquals(date, result.date()); assertEquals(5, result.totalOrderCount());
        assertEquals("9223372036854775808", result.paid().amountCents());
        assertEquals(1, result.paid().missingAmountOrderCount()); assertEquals(2, result.unpaid().orderCount());
        assertEquals(2, result.paidWithoutDateOrderCount());
        verify(queries).paymentSummary(date); verifyNoMoreInteractions(queries);
    }

    @Test void calendarPreservesPhoneSuffixAndCancelledOrdersWithoutChangingWorkbench() {
        var from = LocalDate.of(2026, 10, 20);
        var id = UUID.randomUUID();
        when(queries.calendar(from, from.plusDays(1))).thenReturn(List.of(new OrderQueries.CalendarOrder(
                id, "001", from, "CANCELLED", null, "UNPAID", "PICKUP", Instant.parse("2026-10-20T01:00:00Z"), "0012")));
        when(queries.calendarItems(List.of(id))).thenReturn(List.of(new OrderQueries.CalendarItem(id, UUID.randomUUID(), "草莓蛋糕", 2)));
        var order = service.calendar(from, from.plusDays(1)).getFirst();
        assertEquals("0012", order.customerPhoneLast4());
        assertEquals("CANCELLED", order.status());
        assertEquals(2, order.items().getFirst().quantity());
        verify(queries).calendar(from, from.plusDays(1));
        verify(queries).calendarItems(List.of(id));
        verifyNoMoreInteractions(queries);
    }

    @Test void invalidRangesAreRejectedBeforeQueryingAndSixWeeksAreAllowed() {
        var from = LocalDate.of(2026, 9, 28);
        for (var to : List.of(from, from.minusDays(1), from.plusDays(43))) {
            assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> service.calendar(from, to)).code());
        }
        assertThrows(OrderFailure.class, () -> service.calendar(null, from));
        assertThrows(OrderFailure.class, () -> service.calendar(from, null));
        assertThrows(OrderFailure.class, () -> service.workbench(null));
        verifyNoInteractions(queries);
        when(queries.calendar(from, from.plusDays(42))).thenReturn(List.of());
        assertTrue(service.calendar(from, from.plusDays(42)).isEmpty());
        verify(queries).calendar(from, from.plusDays(42)); verifyNoMoreInteractions(queries);
    }

    @Test void createdDateUsesShanghaiMidnightsAcrossMonthBoundaryAndEmptyDaysSkipItemQueries() {
        var date = LocalDate.of(2026, 9, 30);
        var from = Instant.parse("2026-09-29T16:00:00Z");
        var to = Instant.parse("2026-09-30T16:00:00Z");
        when(queries.metrics(date, from, to)).thenReturn(new OrderQueries.Metrics(9, 2, 0));
        when(queries.pending(date)).thenReturn(List.of());
        var result = service.workbench(date);
        assertEquals(date, result.date()); assertEquals(9, result.metrics().totalOrders());
        assertEquals(2, result.metrics().createdOnDate()); assertEquals(0, result.metrics().deliveryDueOnDate());
        assertTrue(result.pendingOrders().isEmpty());
        verify(queries).metrics(date, from, to); verify(queries).pending(date); verifyNoMoreInteractions(queries);
    }

    @Test void workbenchCanSkipUnusedMetricsWithoutQueryingTheOrderHistory() {
        var date = LocalDate.of(2026, 10, 20);
        when(queries.pending(date)).thenReturn(List.of());
        var result = service.workbench(date, false);
        assertEquals(date, result.date()); assertNull(result.metrics()); assertTrue(result.pendingOrders().isEmpty());
        verify(queries).pending(date); verifyNoMoreInteractions(queries);
        assertThrows(OrderFailure.class, () -> service.workbench(null, false));
        verifyNoMoreInteractions(queries);
    }
}

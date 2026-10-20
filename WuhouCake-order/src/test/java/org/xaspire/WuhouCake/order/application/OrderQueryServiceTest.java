package org.xaspire.WuhouCake.order.application;

import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderQueryServiceTest {
    private final OrderQueries queries = mock(OrderQueries.class);
    private final OrderQueryService service = new OrderQueryService(queries);

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

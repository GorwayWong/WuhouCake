package org.xaspire.WuhouCake.order.application;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.api.command.*;
import org.xaspire.WuhouCake.order.application.service.*;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.domain.repository.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderExportServiceTest {
    private final OrderExportSnapshotService snapshots = mock(OrderExportSnapshotService.class);
    private final OrderExportFiles files = mock(OrderExportFiles.class);
    private final OrderExportService service = new OrderExportService(snapshots, files);
    private final OrderCommands.Operator operator = new OrderCommands.Operator(UUID.randomUUID(), "员工");

    @Test void downloadDoesNotDependOnActivityWrites() {
        var data = List.<OrderExportFiles.Snapshot>of();
        var request = new OrderExportRequest(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 11, 1), null, null, null);
        var file = new OrderExportFiles.File("/tmp/internal", "orders.zip", "application/zip", 10);
        when(snapshots.batch(any())).thenReturn(data);
        when(files.generate(any(), anyString(), eq(true))).thenReturn(file);
        assertEquals("orders.zip", service.batch(request, operator).filename());
        var ordered = inOrder(snapshots, files); ordered.verify(snapshots).batch(any());
        ordered.verify(files).generate(any(), anyString(), eq(true)); verify(files, never()).delete(any());
    }
    @Test void generationFailureNeverAppendsLog() {
        when(snapshots.batch(any())).thenReturn(List.of());
        when(files.generate(any(), anyString(), anyBoolean())).thenThrow(new IllegalStateException("render failed"));
        assertThrows(IllegalStateException.class, () -> service.batch(new OrderExportRequest(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2), null, null, null), operator));
        verify(files, never()).delete(any());
    }
    @Test void filtersRejectInvalidDatesAndValues() {
        assertThrows(OrderFailure.class, () -> new OrderExportQueries.Filter(null, null, null, null, null));
        assertThrows(OrderFailure.class, () -> new OrderExportQueries.Filter(LocalDate.of(2026, 10, 2), LocalDate.of(2026, 10, 1), null, null, null));
        assertEquals("EXPORT_LIMIT_EXCEEDED", assertThrows(OrderFailure.class,
                () -> new OrderExportQueries.Filter(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 12, 1), null, null, null)).code());
        assertThrows(OrderFailure.class, () -> new OrderExportQueries.Filter(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2), "wrong", null, null));
    }
    @Test void snapshotsExcludeRemovedItemImagesAndKeepOnlyApplicableNotes() {
        var now = Instant.parse("2026-10-16T02:00:00Z");
        var first = OrderItem.create(UUID.randomUUID(), "蛋糕", null, 1, null, null, Map.of(), now);
        var removed = OrderItem.create(UUID.randomUUID(), "已移除", null, 1, null, null, Map.of(), now).remove(now);
        var order = Order.create(UUID.randomUUID(), "0000001", new CustomerContact(null, "1", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 10, 16), now, null), null, List.of(first, removed), operator.accountId(), now);
        var orders = mock(Orders.class); var activities = mock(OrderActivities.class); var queries = mock(OrderExportQueries.class); var images = mock(OrderImages.class);
        when(orders.find(order.id())).thenReturn(Optional.of(order));
        when(queries.contentSize(any())).thenReturn(new OrderExportQueries.ContentSize(0, 0));
        when(activities.recentItemNotes(order.id())).thenReturn(List.of(OrderActivity.append(order.id(), removed.itemId(), "NOTE", "历史备注", Map.of(), new Actor(operator.accountId(), "员工"), now)));
        when(images.list(order.id())).thenReturn(List.of(new OrderImage(UUID.randomUUID(), order.id(), removed.itemId(), "image/png", "旧图", 1, 1, 1, operator.accountId(), "员工", now)));
        var service = new OrderExportSnapshotService(orders, activities, queries, images);
        var snapshot = service.single(order.id()).getFirst();
        assertTrue(snapshot.images().isEmpty()); assertTrue(snapshot.notes().isEmpty());
        assertEquals(0, order.version()); assertEquals(now, order.updatedAt());
        when(queries.select(any())).thenReturn(Collections.nCopies(101, order.id()));
        assertEquals("EXPORT_LIMIT_EXCEEDED", assertThrows(OrderFailure.class,
                () -> service.batch(new OrderExportQueries.Filter(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 2), null, null, null))).code());
        when(queries.contentSize(any())).thenReturn(new OrderExportQueries.ContentSize(OrderFileLimits.EXPORT_TEXT_BYTES + 1, 1));
        clearInvocations(orders, activities, images);
        assertEquals("EXPORT_CONTENT_TOO_LARGE", assertThrows(OrderFailure.class, () -> service.single(order.id())).code());
        verifyNoInteractions(orders, activities, images);
    }
}

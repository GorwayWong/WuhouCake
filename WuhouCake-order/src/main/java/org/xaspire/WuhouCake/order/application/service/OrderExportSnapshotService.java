package org.xaspire.WuhouCake.order.application.service;

import java.util.*;
import org.springframework.transaction.annotation.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.domain.port.OrderExportFiles.Snapshot;
import org.xaspire.WuhouCake.order.domain.repository.*;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public class OrderExportSnapshotService {
    private final Orders orders;
    private final OrderActivities activities;
    private final OrderExportQueries queries;
    private final OrderImages images;
    private final OrderManagementQueries management;
    private final org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity;
    private final java.time.Clock clock;
    private final OrderExportFiles files;
    public OrderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images) {
        this(orders, activities, queries, images, null, null, java.time.Clock.systemUTC(), null);
    }
    public OrderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images,
            OrderManagementQueries management, org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity, java.time.Clock clock, OrderExportFiles files) {
        this.orders = orders; this.activities = activities; this.queries = queries; this.images = images;
        this.management = management; this.identity = identity; this.clock = clock;
        this.files = files;
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Snapshot> single(UUID orderId) { checkContent(List.of(orderId)); return capture(List.of(orderId)); }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Snapshot> batch(OrderExportQueries.Filter filter) {
        var ids = queries.select(filter);
        if (ids.isEmpty()) throw new OrderFailure("EXPORT_EMPTY");
        if (ids.size() > EXPORT_ORDERS) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        checkContent(ids);
        return capture(ids);
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Snapshot> management(org.xaspire.WuhouCake.order.api.query.OrderManagementQuery query) {
        var filter = OrderManagementService.filter(query);
        if (filter.deleted()) OrderReadAccess.requireDeletedRead(identity);
        var ids = management.search(filter, EXPORT_ORDERS + 1, 0).stream().map(row -> UUID.fromString(row.orderId())).toList();
        if (ids.isEmpty()) throw new OrderFailure("EXPORT_EMPTY");
        if (ids.size() > EXPORT_ORDERS) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        checkContent(ids);
        return capture(ids);
    }
    private List<Snapshot> capture(List<UUID> ids) {
        var result = new ArrayList<Snapshot>(); long imageBytes = 0; int imageCount = 0;
        try {
            for (var id : ids) {
                var snapshot = snapshot(id);
                imageCount += snapshot.images().size(); imageBytes += snapshot.images().stream().mapToLong(image -> image.size()).sum();
                if (imageCount > EXPORT_IMAGES) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
                if (imageBytes > ZIP_BYTES) throw new OrderFailure("EXPORT_FILE_TOO_LARGE");
                result.add(files == null ? snapshot : files.captureImages(snapshot));
            }
            var captured = List.copyOf(result);
            if (files != null && org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                        new org.springframework.transaction.support.TransactionSynchronization() {
                            @Override public void afterCompletion(int status) {
                                if (status != STATUS_COMMITTED) files.releaseImages(captured);
                            }
                        });
            }
            return captured;
        } catch (RuntimeException | Error failure) {
            if (files != null) try { files.releaseImages(result); } catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }
    private void checkContent(List<UUID> ids) {
        var size = queries.contentSize(ids);
        if (size.bytes() > EXPORT_TEXT_BYTES || size.rows() > EXPORT_DATA_ROWS) throw new OrderFailure("EXPORT_CONTENT_TOO_LARGE");
    }
    private Snapshot snapshot(UUID orderId) {
        var order = orders.find(orderId).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        OrderReadAccess.requireReadable(order, clock, identity);
        var activeIds = new HashSet<UUID>();
        order.activeItems().forEach(item -> activeIds.add(item.itemId()));
        var notes = new ArrayList<>(queries.orderNotes(orderId));
        activities.recentItemNotes(orderId).stream().filter(note -> activeIds.contains(note.itemId())).forEach(notes::add);
        var included = images.list(orderId).stream().filter(image -> image.itemId() == null || activeIds.contains(image.itemId())).toList();
        if (included.size() > IMAGES_PER_ORDER) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        return new Snapshot(order, notes, included);
    }
}

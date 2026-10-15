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
    public OrderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images) {
        this.orders = orders; this.activities = activities; this.queries = queries; this.images = images;
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Snapshot> single(UUID orderId) { checkContent(List.of(orderId)); return List.of(snapshot(orderId)); }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<Snapshot> batch(OrderExportQueries.Filter filter) {
        var ids = queries.select(filter);
        if (ids.isEmpty()) throw new OrderFailure("EXPORT_EMPTY");
        if (ids.size() > EXPORT_ORDERS) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        checkContent(ids);
        var result = ids.stream().map(this::snapshot).toList();
        if (result.stream().mapToInt(snapshot -> snapshot.images().size()).sum() > EXPORT_IMAGES) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        return result;
    }
    private void checkContent(List<UUID> ids) {
        var size = queries.contentSize(ids);
        if (size.bytes() > EXPORT_TEXT_BYTES || size.rows() > EXPORT_DATA_ROWS) throw new OrderFailure("EXPORT_CONTENT_TOO_LARGE");
    }
    private Snapshot snapshot(UUID orderId) {
        var order = orders.find(orderId).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        var activeIds = new HashSet<UUID>();
        order.activeItems().forEach(item -> activeIds.add(item.itemId()));
        var notes = new ArrayList<>(queries.orderNotes(orderId));
        activities.recentItemNotes(orderId).stream().filter(note -> activeIds.contains(note.itemId())).forEach(notes::add);
        var included = images.list(orderId).stream().filter(image -> image.itemId() == null || activeIds.contains(image.itemId())).toList();
        if (included.size() > IMAGES_PER_ORDER) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        return new Snapshot(order, notes, included);
    }
}

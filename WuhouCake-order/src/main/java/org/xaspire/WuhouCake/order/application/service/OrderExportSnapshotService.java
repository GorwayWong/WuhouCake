package org.xaspire.WuhouCake.order.application.service;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.transaction.annotation.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.domain.port.OrderExportFiles.Snapshot;
import org.xaspire.WuhouCake.order.domain.repository.*;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public class OrderExportSnapshotService {
    private final Orders orders;
    private final OrderActivities activities;
    private final OrderExportQueries queries;
    private final OrderImages images;
    private final OrderManagementQueries management;
    private final org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity;
    public OrderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images) {
        this(orders, activities, queries, images, null, null);
    }
    public OrderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images,
            OrderManagementQueries management, org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity) {
        this.orders = orders; this.activities = activities; this.queries = queries; this.images = images;
        this.management = management; this.identity = identity;
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 20)
    public List<Snapshot> single(UUID orderId) {
        checkContent(List.of(orderId));
        var order = orders.find(orderId).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        OrderReadAccess.requireReadable(order, identity);
        return checkImageBudgets(List.of(snapshot(order, queries.orderNotes(orderId),
                activities.recentItemNotes(orderId), images.list(orderId))));
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 20)
    public List<Snapshot> batch(OrderExportQueries.Filter filter) {
        var ids = queries.select(filter);
        if (ids.isEmpty()) throw new OrderFailure("EXPORT_EMPTY");
        if (ids.size() > EXPORT_ORDERS) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        checkContent(ids);
        return captureBatch(ids, false);
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ, timeout = 20)
    public List<Snapshot> management(org.xaspire.WuhouCake.order.api.query.OrderManagementQuery query) {
        var filter = OrderManagementService.filter(query);
        if (filter.deleted()) OrderReadAccess.requireDeletedRead(identity);
        var ids = management.search(filter, EXPORT_ORDERS + 1, 0).stream().map(row -> UUID.fromString(row.orderId())).toList();
        if (ids.isEmpty()) throw new OrderFailure("EXPORT_EMPTY");
        if (ids.size() > EXPORT_ORDERS) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        checkContent(ids);
        return captureBatch(ids, filter.deleted());
    }
    private List<Snapshot> captureBatch(List<UUID> ids, boolean deletedReadChecked) {
        var selected = orders.findAll(ids).stream().collect(Collectors.toMap(Order::id, Function.identity()));
        if (!selected.keySet().containsAll(ids)) throw new OrderFailure("ORDER_NOT_FOUND");
        if (!deletedReadChecked && selected.values().stream().anyMatch(order -> order.deletion() != null)) {
            OrderReadAccess.requireDeletedRead(identity);
        }
        var orderNotes = queries.orderNotesForOrders(ids).stream().collect(Collectors.groupingBy(OrderActivity::orderId));
        var itemNotes = activities.recentItemNotesForOrders(ids).stream().collect(Collectors.groupingBy(OrderActivity::orderId));
        var orderImages = images.listForOrders(ids).stream().collect(Collectors.groupingBy(OrderImage::orderId));
        return checkImageBudgets(ids.stream().map(id -> snapshot(selected.get(id), orderNotes.getOrDefault(id, List.of()),
                itemNotes.getOrDefault(id, List.of()), orderImages.getOrDefault(id, List.of()))).toList());
    }
    private static List<Snapshot> checkImageBudgets(List<Snapshot> snapshots) {
        long imageBytes = 0;
        int imageCount = 0;
        for (var snapshot : snapshots) {
            long workbookImageBytes = snapshot.images().stream().mapToLong(image -> image.size()).sum();
            if (workbookImageBytes > EXPORT_WORKBOOK_IMAGE_BYTES) throw new OrderFailure("EXPORT_FILE_TOO_LARGE");
            imageCount += snapshot.images().size();
            imageBytes += workbookImageBytes;
            if (imageCount > EXPORT_IMAGES) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
            if (imageBytes > ZIP_BYTES) throw new OrderFailure("EXPORT_FILE_TOO_LARGE");
        }
        return snapshots;
    }
    private void checkContent(List<UUID> ids) {
        var size = queries.contentSize(ids);
        if (size.bytes() > EXPORT_TEXT_BYTES || size.rows() > EXPORT_DATA_ROWS) throw new OrderFailure("EXPORT_CONTENT_TOO_LARGE");
    }
    private static Snapshot snapshot(Order order, List<OrderActivity> orderNotes, List<OrderActivity> itemNotes,
                                     List<OrderImage> images) {
        var activeIds = new HashSet<UUID>();
        order.activeItems().forEach(item -> activeIds.add(item.itemId()));
        var notes = new ArrayList<>(orderNotes);
        itemNotes.stream().filter(note -> activeIds.contains(note.itemId())).forEach(notes::add);
        var included = images.stream().filter(image -> image.itemId() == null || activeIds.contains(image.itemId())).toList();
        if (included.size() > EXPORT_IMAGES) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
        return new Snapshot(order, notes, included);
    }
}

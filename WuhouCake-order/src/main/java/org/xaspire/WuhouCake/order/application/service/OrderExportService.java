package org.xaspire.WuhouCake.order.application.service;

import java.time.format.DateTimeFormatter;
import java.util.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator;
import org.xaspire.WuhouCake.order.api.command.OrderExportRequest;
import org.xaspire.WuhouCake.order.domain.port.*;

public class OrderExportService {
    private final OrderExportSnapshotService snapshots;
    private final OrderExportFiles files;
    public OrderExportService(OrderExportSnapshotService snapshots, OrderExportFiles files) {
        this.snapshots = snapshots; this.files = files;
    }
    public Download single(UUID orderId, Operator operator) {
        var data = snapshots.single(orderId);
        return generate(data, false, "订单-" + data.getFirst().order().orderNo() + ".xlsx");
    }
    public Download batch(OrderExportRequest request, Operator operator) {
        var filter = new OrderExportQueries.Filter(request.from(), request.to(), request.status(), request.fulfillmentType(), request.paymentStatus());
        var data = snapshots.batch(filter);
        var format = DateTimeFormatter.BASIC_ISO_DATE;
        return generate(data, true, "orders-" + filter.from().format(format) + "-"
                + filter.to().minusDays(1).format(format) + ".zip");
    }
    private Download generate(List<OrderExportFiles.Snapshot> data, boolean batch, String filename) {
        OrderExportFiles.File file = null; Throwable failure = null;
        try {
            file = files.generate(data, filename, batch);
            return new Download(file.path(), file.filename(), file.contentType(), file.size());
        } catch (RuntimeException | Error problem) { failure = problem; throw problem; }
        finally {
            try { files.releaseImages(data); }
            catch (RuntimeException cleanup) {
                if (failure != null) failure.addSuppressed(cleanup);
                else {
                    if (file != null) try { files.delete(file); } catch (RuntimeException extra) { cleanup.addSuppressed(extra); }
                    throw cleanup;
                }
            }
        }
    }
    public void delete(Download file) { files.delete(new OrderExportFiles.File(file.path(), file.filename(), file.contentType(), file.size())); }
    public Download management(org.xaspire.WuhouCake.order.api.query.OrderManagementQuery query, Operator operator) {
        return generate(snapshots.management(query), true, query.deleted() ? "deleted-orders.zip" : "orders.zip");
    }
    public record Download(String path, String filename, String contentType, long size) { }
}

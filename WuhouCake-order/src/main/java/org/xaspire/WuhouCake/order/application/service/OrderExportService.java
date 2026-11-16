package org.xaspire.WuhouCake.order.application.service;

import java.time.format.DateTimeFormatter;
import java.time.Duration;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
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
        Runnable checkDeadline = exportDeadline();
        var data = snapshots.single(orderId);
        return generate(data, false, "订单-" + data.getFirst().order().orderNo() + ".xlsx", checkDeadline);
    }
    public Download batch(OrderExportRequest request, Operator operator) {
        Runnable checkDeadline = exportDeadline();
        var filter = new OrderExportQueries.Filter(request.from(), request.to(), request.status(), request.fulfillmentType(), request.paymentStatus());
        var data = snapshots.batch(filter);
        var format = DateTimeFormatter.BASIC_ISO_DATE;
        return generate(data, true, "orders-" + filter.from().format(format) + "-"
                + filter.to().minusDays(1).format(format) + ".zip", checkDeadline);
    }
    static Runnable exportDeadline() {
        long deadline = System.nanoTime() + Duration.ofSeconds(45).toNanos();
        return () -> {
            if (Thread.currentThread().isInterrupted() || deadline - System.nanoTime() <= 0)
                throw new OrderFailure("EXPORT_TIMEOUT");
        };
    }

    private Download generate(List<OrderExportFiles.Snapshot> data, boolean batch, String filename, Runnable checkDeadline) {
        OrderExportFiles.File file = null; Throwable failure = null;
        try {
            checkDeadline.run();
            file = files.generate(data, filename, batch, checkDeadline);
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
        Runnable checkDeadline = exportDeadline();
        return generate(snapshots.management(query), true, query.deleted() ? "deleted-orders.zip" : "orders.zip", checkDeadline);
    }
    public record Download(String path, String filename, String contentType, long size) { }
}

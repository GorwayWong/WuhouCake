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
        var file = files.generate(data, filename, batch);
        return new Download(file.path(), file.filename(), file.contentType(), file.size());
    }
    public void delete(Download file) { files.delete(new OrderExportFiles.File(file.path(), file.filename(), file.contentType(), file.size())); }
    public record Download(String path, String filename, String contentType, long size) { }
}

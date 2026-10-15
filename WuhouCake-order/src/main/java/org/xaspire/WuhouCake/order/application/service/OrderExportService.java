package org.xaspire.WuhouCake.order.application.service;

import java.time.format.DateTimeFormatter;
import java.util.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator;
import org.xaspire.WuhouCake.order.api.command.OrderExportRequest;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.Actor;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.shared.id.IdGenerator;

public class OrderExportService {
    private final OrderExportSnapshotService snapshots;
    private final OrderExportLogService logs;
    private final OrderExportFiles files;
    private final IdGenerator ids;
    public OrderExportService(OrderExportSnapshotService snapshots, OrderExportLogService logs, OrderExportFiles files, IdGenerator ids) {
        this.snapshots = snapshots; this.logs = logs; this.files = files; this.ids = ids;
    }
    public Download single(UUID orderId, Operator operator) {
        var actor = new Actor(operator.accountId(), operator.nickname());
        var data = snapshots.single(orderId);
        return generate(data, actor, null, Map.of(), "订单-" + data.getFirst().order().orderNo() + ".xlsx");
    }
    public Download batch(OrderExportRequest request, Operator operator) {
        var filter = new OrderExportQueries.Filter(request.from(), request.to(), request.status(), request.fulfillmentType(), request.paymentStatus());
        var actor = new Actor(operator.accountId(), operator.nickname());
        var data = snapshots.batch(filter);
        var format = DateTimeFormatter.BASIC_ISO_DATE;
        return generate(data, actor, ids.nextId(), filter.summary(), "orders-" + filter.from().format(format) + "-"
                + filter.to().minusDays(1).format(format) + ".zip");
    }
    private Download generate(List<OrderExportFiles.Snapshot> data, Actor actor, UUID batchId,
            Map<String, Object> filters, String filename) {
        var file = files.generate(data, filename, batchId != null);
        try { logs.append(data, actor, batchId, filters); return new Download(file.path(), file.filename(), file.contentType(), file.size()); }
        catch (RuntimeException | Error failure) {
            try { files.delete(file); } catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }
    public void delete(Download file) { files.delete(new OrderExportFiles.File(file.path(), file.filename(), file.contentType(), file.size())); }
    public record Download(String path, String filename, String contentType, long size) { }
}

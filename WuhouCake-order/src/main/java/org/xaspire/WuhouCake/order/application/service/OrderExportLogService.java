package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.Actor;
import org.xaspire.WuhouCake.order.domain.port.OrderExportFiles.Snapshot;
import org.xaspire.WuhouCake.order.domain.repository.OrderActivities;

public class OrderExportLogService {
    private final OrderActivities activities;
    private final Clock clock;
    public OrderExportLogService(OrderActivities activities, Clock clock) { this.activities = activities; this.clock = clock; }
    @Transactional
    public void append(List<Snapshot> snapshots, Actor actor, UUID batchId, Map<String, Object> filters) {
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        for (var snapshot : snapshots) {
            var details = new LinkedHashMap<String, Object>();
            details.put("mode", batchId == null ? "SINGLE" : "BATCH"); details.put("format", "XLSX");
            if (batchId != null) details.put("batchId", batchId.toString());
            if (!filters.isEmpty()) details.put("filters", filters);
            details.put("snapshotVersion", snapshot.order().version());
            details.put("imageIds", snapshot.images().stream().map(image -> image.imageId().toString()).toList());
            activities.append(OrderActivity.append(snapshot.order().id(), null, "ORDER_EXPORTED", "订单导出文件已生成并发起下载",
                    details, actor, now));
        }
    }
}

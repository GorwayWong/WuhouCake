package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.time.Instant;
import java.util.UUID;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

/** 订单软删除的时间、操作人和原因。 */
public record OrderDeletion(Instant deletedAt, UUID deletedBy, String employeeName, String reason) {
    public OrderDeletion {
        if (deletedAt == null || deletedBy == null) throw invalid();
        employeeName = requiredText(employeeName, 160);
        reason = requiredText(reason, 1000);
    }
}

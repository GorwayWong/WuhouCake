package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.time.Instant;
import java.time.Duration;
import java.util.UUID;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

/** 删除后保留三十天供只读查询，不允许恢复或延长保留期。 */
public record OrderDeletion(Instant deletedAt, UUID deletedBy, String employeeName, String reason) {
    public OrderDeletion {
        if (deletedAt == null || deletedBy == null) throw invalid();
        employeeName = requiredText(employeeName, 160);
        reason = requiredText(reason, 1000);
    }
    public Instant expiresAt() { return deletedAt.plus(Duration.ofDays(30)); }
    public boolean expired(Instant now) { return !now.isBefore(expiresAt()); }
}

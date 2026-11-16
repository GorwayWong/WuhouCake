package org.xaspire.WuhouCake.order.domain.port;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface OrderRetention {
    List<UUID> expired(Instant cutoff, UUID after, int limit);
    /** 调用方提供独立事务；锁定并再次校验到期时间后清除关联业务内容。 */
    boolean purge(UUID orderId, Instant cutoff, Instant now);
    long pending(Instant cutoff);
}

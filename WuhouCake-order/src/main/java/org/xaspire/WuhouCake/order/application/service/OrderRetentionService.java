package org.xaspire.WuhouCake.order.application.service;

import java.time.*;
import java.util.UUID;
import org.slf4j.*;
import org.springframework.transaction.support.TransactionOperations;
import org.xaspire.WuhouCake.order.domain.port.OrderRetention;

public final class OrderRetentionService {
    private static final Logger LOG = LoggerFactory.getLogger(OrderRetentionService.class);
    private final OrderRetention retention;
    private final TransactionOperations transactions;
    private final Clock clock;
    public OrderRetentionService(OrderRetention retention, TransactionOperations transactions, Clock clock) {
        this.retention = retention; this.transactions = transactions; this.clock = clock;
    }
    public Result purgeExpired() {
        Instant now = clock.instant(), cutoff = now.minus(Duration.ofDays(30));
        int purged = 0, failed = 0;
        UUID after = null;
        while (true) {
            var ids = retention.expired(cutoff, after, 100);
            if (ids.isEmpty()) break;
            for (var id : ids) {
                try {
                    if (Boolean.TRUE.equals(transactions.execute(status -> retention.purge(id, cutoff, now)))) purged++;
                } catch (RuntimeException failure) {
                    failed++;
                    LOG.warn("order_purge_failed orderId={} failureType={}", id, failure.getClass().getSimpleName());
                }
            }
            after = ids.getLast();
        }
        long pending = retention.pending(cutoff);
        LOG.info("order_retention purged={} failed={} pending={}", purged, failed, pending);
        return new Result(purged, failed, pending);
    }
    public record Result(int purged, int failed, long pending) { }
}

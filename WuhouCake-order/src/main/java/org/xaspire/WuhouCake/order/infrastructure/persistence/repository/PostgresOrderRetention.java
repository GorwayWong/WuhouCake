package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.port.OrderRetention;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderRetentionMapper;

public final class PostgresOrderRetention implements OrderRetention {
    private final OrderRetentionMapper mapper;
    public PostgresOrderRetention(OrderRetentionMapper mapper) { this.mapper = mapper; }
    @Override public List<UUID> expired(Instant cutoff, UUID after, int limit) { return mapper.expired(cutoff, after == null ? null : after.toString(), limit).stream().map(UUID::fromString).toList(); }
    @Override public long pending(Instant cutoff) { return mapper.pending(cutoff); }
    @Override public boolean purge(UUID orderId, Instant cutoff, Instant now) {
        String id = orderId.toString();
        if (mapper.lock(id, cutoff) == null) return false;
        var submissions = mapper.submissions(id);
        mapper.detach(id);
        for (String submission : submissions) {
            mapper.removeSubmissionActivities(submission);
            mapper.scrubSubmission(submission, now);
        }
        mapper.images(id); mapper.activities(id); mapper.items(id);
        mapper.preserveCreationReceipt(id);
        mapper.audit(id, now);
        return mapper.order(id, cutoff) == 1;
    }
}

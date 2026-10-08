package org.xaspire.WuhouCake.audit.api.facade;

import java.time.Instant;
import java.util.UUID;
import org.xaspire.WuhouCake.shared.response.Page;

public interface AuditFacade {
    record Command(Instant occurredAt, String action, String result, UUID actorId, String actorEmployeeNumber,
            String actorNickname, String targetId, String requestId) { }
    record Entry(UUID id, Instant occurredAt, String action, String result, UUID actorId, String actorEmployeeNumber,
            String actorNickname, String targetId, String requestId) { }
    record Query(UUID actorId, String action, String result, Instant from, Instant to, int page, int size) { }
    void append(Command command);
    Page<Entry> query(Query query);
}

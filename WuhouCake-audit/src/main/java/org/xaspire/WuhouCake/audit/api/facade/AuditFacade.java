package org.xaspire.WuhouCake.audit.api.facade;

import java.time.Instant;
import java.util.UUID;
import java.util.Map;
import org.xaspire.WuhouCake.shared.response.Page;

public interface AuditFacade {
    record Command(Instant occurredAt, String action, String result, UUID actorId, String actorEmployeeNumber,
            String actorNickname, String targetId, String requestId, Map<String, String> details) {
        public Command(Instant occurredAt, String action, String result, UUID actorId, String actorEmployeeNumber, String actorNickname, String targetId, String requestId) {
            this(occurredAt, action, result, actorId, actorEmployeeNumber, actorNickname, targetId, requestId, Map.of());
        }
    }
    record Entry(UUID id, Instant occurredAt, String action, String result, UUID actorId, String actorEmployeeNumber,
            String actorNickname, String targetId, String requestId, Map<String, String> details) { }
    record Query(UUID actorId, String action, String result, Instant from, Instant to, int page, int size) { }
    void append(Command command);
    void appendChange(Command command);
    Page<Entry> query(Query query);
}

package org.xaspire.WuhouCake.audit.domain.model.aggregate;

import java.time.Instant;
import java.util.UUID;
import java.util.Map;

public record Operation(UUID id, Instant occurredAt, String action, String result, UUID actorId,
        String actorEmployeeNumber, String actorNickname, String targetId, String requestId, Map<String, String> details) {
    public Operation(UUID id, Instant occurredAt, String action, String result, UUID actorId,
            String actorEmployeeNumber, String actorNickname, String targetId, String requestId) {
        this(id, occurredAt, action, result, actorId, actorEmployeeNumber, actorNickname, targetId, requestId, Map.of());
    }
    public Operation {
        details = Map.copyOf(details);
        if (details.size() > 20 || details.entrySet().stream().anyMatch(e -> !safe(e.getKey(), 80) || !safe(e.getValue(), 1000))) throw new IllegalArgumentException("Invalid audit details");
        if (id == null || occurredAt == null || action == null || !action.matches("[a-z][a-z0-9_.]{0,79}")
                || !("SUCCESS".equals(result) || "FAILURE".equals(result))
                || !safe(actorEmployeeNumber, 32) || !safe(actorNickname, 160)
                || !safe(targetId, 128) || !safe(requestId, 64)) throw new IllegalArgumentException("Invalid audit record");
    }
    private static boolean safe(String value, int max) {
        return value == null || (value.length() <= max && value.codePoints().noneMatch(Character::isISOControl));
    }
}

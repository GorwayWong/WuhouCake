package org.xaspire.WuhouCake.order.domain.port;

import java.util.Optional;
import java.util.UUID;

public interface OrderCreations {
    Optional<UUID> claim(UUID actorId, UUID requestId, String fingerprint);
    void complete(UUID actorId, UUID requestId, UUID orderId);
}

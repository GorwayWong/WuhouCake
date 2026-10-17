package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.Optional;
import java.util.UUID;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderCreations;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderCreationMapper;

public final class PostgresOrderCreations implements OrderCreations {
    private final OrderCreationMapper mapper;
    public PostgresOrderCreations(OrderCreationMapper mapper) { this.mapper = mapper; }
    @Override public Optional<UUID> claim(UUID actorId, UUID requestId, String fingerprint) {
        mapper.reserve(actorId.toString(), requestId.toString(), fingerprint);
        var row = mapper.lock(actorId.toString(), requestId.toString());
        if (row == null || !fingerprint.equals(row.fingerprint())) throw new OrderFailure("IDEMPOTENCY_KEY_CONFLICT");
        return Optional.ofNullable(row.orderId()).map(UUID::fromString);
    }
    @Override public void complete(UUID actorId, UUID requestId, UUID orderId) {
        if (mapper.complete(actorId.toString(), requestId.toString(), orderId.toString()) != 1) throw new OrderFailure("CONCURRENT_MODIFICATION");
    }
}

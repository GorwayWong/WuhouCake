package org.xaspire.WuhouCake.order.application.service;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.transaction.annotation.*;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.domain.port.OrderCreations;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

public class OrderCreationService {
    private final OrderService orders;
    private final OrderCreations creations;
    private final JsonCodec json;
    public OrderCreationService(OrderService orders, OrderCreations creations, JsonCodec json) {
        this.orders = orders; this.creations = creations; this.json = json;
    }
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UUID create(OrderCommands.Create command, OrderCommands.Operator operator, UUID requestId) {
        if (requestId == null) return orders.create(command, operator).orderId();
        var existing = creations.claim(operator.accountId(), requestId, fingerprint(command));
        if (existing.isPresent()) return existing.get();
        var created = orders.create(command, operator);
        creations.complete(operator.accountId(), requestId, created.orderId());
        return created.orderId();
    }
    private String fingerprint(OrderCommands.Create command) {
        String canonical = json.write(canonical(json.read(json.write(command), Map.class)));
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException failure) { throw new IllegalStateException(failure); }
    }
    private static Object canonical(Object value) {
        if (value instanceof Map<?, ?> map) {
            var sorted = new TreeMap<String, Object>();
            map.forEach((key, entry) -> sorted.put((String) key, canonical(entry))); return sorted;
        }
        if (value instanceof List<?> list) return list.stream().map(OrderCreationService::canonical).toList();
        if (value instanceof Number number) return new BigDecimal(number.toString()).stripTrailingZeros();
        return value;
    }
}

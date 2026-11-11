package org.xaspire.WuhouCake.order.api.dto;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;

public final class OrderPackageViews {
    private OrderPackageViews() { }
    public record Image(String filename, String contentType, byte[] content) { }
    public record Item(UUID itemId, UUID imageId, String name, String productType, Number quantity, Map<String, Object> attributes) { }
    public record Save(String name, List<Item> items, Number originalAmountCents, Number memberAmountCents) { }
    public record Update(long expectedVersion, String name, List<Item> items, Number originalAmountCents, Number memberAmountCents) { }
    public record Package(UUID id, String name, List<Item> items, Long originalAmountCents, Long memberAmountCents, long version, Instant updatedAt) { }
}

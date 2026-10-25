package org.xaspire.WuhouCake.order.api.dto;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;

public final class OrderPackageViews {
    private OrderPackageViews() { }
    public record Item(String name, String productType, Number quantity, Map<String, Object> attributes) { }
    public record Save(String name, List<Item> items) { }
    public record Update(long expectedVersion, String name, List<Item> items) { }
    public record Package(UUID id, String name, List<Item> items, long version, Instant updatedAt) { }
}

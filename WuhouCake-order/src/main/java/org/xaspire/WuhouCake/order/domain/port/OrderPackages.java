package org.xaspire.WuhouCake.order.domain.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;
import java.util.Optional;

public interface OrderPackages {
    record Item(String name, String productType, int quantity, Map<String, Object> attributes) { }
    record Package(UUID id, String name, List<Item> items, long version, Instant updatedAt, Instant deletedAt) {
        public Package { items = List.copyOf(items); }
    }
    List<Package> list(String keyword, int limit, long offset);
    long count(String keyword);
    Optional<Package> find(UUID id);
    Optional<Package> findCreation(UUID key);
    boolean create(Package value, UUID key);
    boolean update(Package value, long expectedVersion);
    boolean delete(UUID id, long expectedVersion, Instant now);
    void recordChange(UUID changeId, UUID actorId, Package before, Package after);
}

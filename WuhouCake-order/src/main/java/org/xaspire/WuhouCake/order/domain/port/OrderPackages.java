package org.xaspire.WuhouCake.order.domain.port;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;
import java.util.Optional;

public interface OrderPackages {
    record Item(UUID itemId, UUID imageId, String name, String productType, int quantity, Map<String, Object> attributes, Long unitPriceCents, Long memberPriceCents) { }
    record Package(UUID id, String name, List<Item> items, Long originalAmountCents, Long memberAmountCents, long version, Instant updatedAt, Instant deletedAt) {
        public Package { items = List.copyOf(items); }
    }
    record Image(String filename, String contentType, byte[] content, String fingerprint) { }
    Optional<Image> image(UUID packageId, UUID itemId, UUID imageId);
    void insertImage(UUID packageId, UUID itemId, UUID imageId, Image image);
    void cleanImages(UUID packageId);
    List<Package> list(String keyword, int limit, long offset);
    long count(String keyword);
    Optional<Package> find(UUID id);
    Optional<Package> findCreation(UUID key);
    boolean create(Package value, UUID key);
    boolean update(Package value, long expectedVersion);
    boolean delete(UUID id, long expectedVersion, Instant now);
    void recordChange(UUID changeId, UUID actorId, Package before, Package after);
}

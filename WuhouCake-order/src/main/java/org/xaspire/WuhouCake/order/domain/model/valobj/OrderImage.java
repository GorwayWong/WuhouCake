package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.time.Instant;
import java.util.UUID;

public record OrderImage(UUID imageId, UUID orderId, UUID itemId, String contentType, String filename,
        long size, int width, int height, UUID uploadedBy, String uploaderNameSnapshot, Instant uploadedAt, int processingVersion) {
    public OrderImage(UUID imageId, UUID orderId, UUID itemId, String contentType, String filename, long size,
            int width, int height, UUID uploadedBy, String uploaderNameSnapshot, Instant uploadedAt) {
        this(imageId, orderId, itemId, contentType, filename, size, width, height, uploadedBy, uploaderNameSnapshot, uploadedAt, 1);
    }

    public boolean canBeRecompressed() { return processingVersion == 0; }
}

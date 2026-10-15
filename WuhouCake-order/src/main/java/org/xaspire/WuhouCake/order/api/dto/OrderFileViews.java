package org.xaspire.WuhouCake.order.api.dto;

import java.time.Instant;
import java.util.UUID;

public final class OrderFileViews {
    private OrderFileViews() { }
    public record Image(UUID imageId, UUID orderId, UUID itemId, String contentType, String filename, long size,
            int width, int height, UUID uploadedBy, String uploaderNameSnapshot, Instant uploadedAt) { }
}

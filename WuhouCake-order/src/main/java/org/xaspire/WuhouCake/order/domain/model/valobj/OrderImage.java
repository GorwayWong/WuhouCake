package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.time.Instant;
import java.util.UUID;

public record OrderImage(UUID imageId, UUID orderId, UUID itemId, String contentType, String filename,
        long size, int width, int height, UUID uploadedBy, String uploaderNameSnapshot, Instant uploadedAt) { }

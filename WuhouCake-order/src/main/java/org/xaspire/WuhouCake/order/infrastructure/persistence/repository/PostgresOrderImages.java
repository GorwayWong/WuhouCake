package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderImage;
import org.xaspire.WuhouCake.order.domain.port.OrderImages;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderImageMapper;

public final class PostgresOrderImages implements OrderImages {
    private final OrderImageMapper mapper;
    public PostgresOrderImages(OrderImageMapper mapper) { this.mapper = mapper; }
    @Override public boolean lockOrder(UUID id) { return mapper.lockOrder(id.toString()) != null; }
    @Override public boolean activeItem(UUID orderId, UUID itemId) { return mapper.activeItem(orderId.toString(), itemId.toString()); }
    @Override public int count(UUID orderId) { return mapper.count(orderId.toString()); }
    @Override public void insert(OrderImage image, byte[] content) {
        mapper.insert(new OrderImageMapper.Row(image.imageId().toString(), image.orderId().toString(), string(image.itemId()),
                image.contentType(), image.filename(), image.size(), image.width(), image.height(), image.uploadedBy().toString(),
                image.uploaderNameSnapshot(), image.uploadedAt()), content);
    }
    @Override public List<OrderImage> list(UUID orderId) { return mapper.list(orderId.toString()).stream().map(PostgresOrderImages::image).toList(); }
    @Override public Optional<OrderImage> find(UUID orderId, UUID imageId) {
        return Optional.ofNullable(mapper.find(orderId.toString(), imageId.toString())).map(PostgresOrderImages::image);
    }
    @Override public Optional<byte[]> content(UUID orderId, UUID imageId) {
        return Optional.ofNullable(mapper.content(orderId.toString(), imageId.toString())).map(OrderImageMapper.ContentRow::content);
    }
    private static String string(UUID id) { return id == null ? null : id.toString(); }
    private static OrderImage image(OrderImageMapper.Row row) {
        return new OrderImage(UUID.fromString(row.imageId()), UUID.fromString(row.orderId()),
                row.itemId() == null ? null : UUID.fromString(row.itemId()), row.contentType(), row.filename(), row.size(), row.width(), row.height(),
                UUID.fromString(row.uploadedBy()), row.uploaderNameSnapshot(), row.uploadedAt());
    }
}

package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.support.TransactionOperations;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator;
import org.xaspire.WuhouCake.order.api.dto.OrderFileViews;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.Actor;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.domain.repository.Orders;
import org.xaspire.WuhouCake.order.domain.repository.OrderActivities;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public class OrderImageService {
    public static final int MAX_IMAGE_BYTES = IMAGE_BYTES;
    private final Orders orders;
    private final OrderImages images;
    private final OrderImageValidator validator;
    private final TransactionOperations writes;
    private final IdGenerator ids;
    private final Clock clock;
    private final OrderActivities activities;
    private final ApplicationEventPublisher events;
    public OrderImageService(Orders orders, OrderImages images, OrderImageValidator validator, TransactionOperations writes,
            IdGenerator ids, Clock clock, OrderActivities activities, ApplicationEventPublisher events) {
        this.orders = orders; this.images = images; this.validator = validator; this.writes = writes; this.ids = ids; this.clock = clock;
        this.activities = activities; this.events = events;
    }
    public OrderFileViews.Image upload(UUID orderId, UUID itemId, byte[] content, String filename, Operator operator) {
        var actor = new Actor(operator.accountId(), operator.nickname());
        var checked = validator.validate(content, filename);
        return writes.execute(transaction -> {
            if (!images.lockOrder(orderId)) throw new OrderFailure("ORDER_NOT_FOUND");
            if (itemId != null && !images.activeItem(orderId, itemId)) throw new OrderFailure("ORDER_NOT_FOUND");
            if (images.count(orderId) >= IMAGES_PER_ORDER) throw new OrderFailure("ORDER_IMAGE_LIMIT_EXCEEDED");
            var image = new OrderImage(ids.nextId(), orderId, itemId, checked.contentType(), checked.filename(), content.length,
                    checked.width(), checked.height(), actor.accountId(), actor.nickname(), clock.instant().truncatedTo(ChronoUnit.MICROS));
            images.insert(image, content);
            changed(image, actor, OrderChanged.Type.IMAGE_ADDED);
            return view(image);
        });
    }
    public void remove(UUID orderId, UUID imageId, Operator operator) {
        var actor = new Actor(operator.accountId(), operator.nickname());
        writes.executeWithoutResult(transaction -> {
            if (!images.lockOrder(orderId)) throw new OrderFailure("ORDER_NOT_FOUND");
            var image = images.find(orderId, imageId);
            if (image.isEmpty()) {
                if (!images.contains(orderId, imageId)) throw new OrderFailure("IMAGE_NOT_FOUND");
                return;
            }
            images.remove(orderId, imageId);
            changed(image.get(), actor, OrderChanged.Type.IMAGE_REMOVED);
        });
    }
    private void changed(OrderImage image, Actor actor, OrderChanged.Type type) {
        var order = orders.find(image.orderId()).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        activities.append(OrderActivity.append(image.orderId(), image.itemId(), type.name(),
                type == OrderChanged.Type.IMAGE_ADDED ? "添加参考图片" : "移除参考图片",
                Map.of("imageId", image.imageId().toString(), "filename", image.filename()), actor,
                clock.instant().truncatedTo(ChronoUnit.MICROS)));
        events.publishEvent(new OrderChanged(image.orderId(), image.itemId(), type, order.version(), order.orderNo()));
    }
    public List<OrderFileViews.Image> list(UUID orderId) {
        if (orders.find(orderId).isEmpty()) throw new OrderFailure("ORDER_NOT_FOUND");
        return images.list(orderId).stream().map(OrderImageService::view).toList();
    }
    public Content content(UUID orderId, UUID imageId) {
        var image = images.find(orderId, imageId).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND"));
        return new Content(view(image), images.content(orderId, imageId).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND")));
    }
    private static OrderFileViews.Image view(OrderImage image) {
        return new OrderFileViews.Image(image.imageId(), image.orderId(), image.itemId(), image.contentType(), image.filename(), image.size(),
                image.width(), image.height(), image.uploadedBy(), image.uploaderNameSnapshot(), image.uploadedAt());
    }
    public record Content(OrderFileViews.Image image, byte[] bytes) { }
}

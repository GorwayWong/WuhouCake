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
    private final org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity;
    public OrderImageService(Orders orders, OrderImages images, OrderImageValidator validator, TransactionOperations writes,
            IdGenerator ids, Clock clock, OrderActivities activities, ApplicationEventPublisher events) {
        this(orders, images, validator, writes, ids, clock, activities, events, null);
    }
    public OrderImageService(Orders orders, OrderImages images, OrderImageValidator validator, TransactionOperations writes,
            IdGenerator ids, Clock clock, OrderActivities activities, ApplicationEventPublisher events,
            org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity) {
        this.orders = orders; this.images = images; this.validator = validator; this.writes = writes; this.ids = ids; this.clock = clock;
        this.activities = activities; this.events = events;
        this.identity = identity;
    }
    public OrderFileViews.Image upload(UUID orderId, UUID itemId, byte[] content, String filename, Operator operator) {
        var actor = new Actor(operator.accountId(), operator.nickname());
        var checked = validator.validate(content, filename);
        byte[] stored = checked.content() == null ? content : checked.content();
        return writes.execute(transaction -> {
            if (!images.lockOrder(orderId)) throw new OrderFailure("ORDER_NOT_FOUND");
            orders.find(orderId).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND")).requireWritable();
            if (itemId != null && !images.activeItem(orderId, itemId)) throw new OrderFailure("ORDER_NOT_FOUND");
            if (images.count(orderId) >= IMAGES_PER_ORDER) throw new OrderFailure("ORDER_IMAGE_LIMIT_EXCEEDED");
            var image = new OrderImage(ids.nextId(), orderId, itemId, checked.contentType(), checked.filename(), stored.length,
                    checked.width(), checked.height(), actor.accountId(), actor.nickname(), clock.instant().truncatedTo(ChronoUnit.MICROS));
            images.insert(image, stored);
            changed(image, actor, OrderChanged.Type.IMAGE_ADDED);
            return view(image);
        });
    }
    public void remove(UUID orderId, UUID imageId, Operator operator) {
        var actor = new Actor(operator.accountId(), operator.nickname());
        writes.executeWithoutResult(transaction -> {
            if (!images.lockOrder(orderId)) throw new OrderFailure("ORDER_NOT_FOUND");
            orders.find(orderId).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND")).requireWritable();
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
        requireReadable(orderId);
        return images.list(orderId).stream().map(OrderImageService::view).toList();
    }
    @org.springframework.transaction.annotation.Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Content content(UUID orderId, UUID imageId) {
        requireReadable(orderId);
        var image = images.find(orderId, imageId).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND"));
        return new Content(view(image), images.content(orderId, imageId).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND")));
    }
    private void requireReadable(UUID orderId) {
        var order = orders.find(orderId).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        OrderReadAccess.requireReadable(order, clock, identity);
    }
    private static OrderFileViews.Image view(OrderImage image) {
        return new OrderFileViews.Image(image.imageId(), image.orderId(), image.itemId(), image.contentType(), image.filename(), image.size(),
                image.width(), image.height(), image.uploadedBy(), image.uploaderNameSnapshot(), image.uploadedAt());
    }
    public record Content(OrderFileViews.Image image, byte[] bytes) { }
}

package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator;
import org.xaspire.WuhouCake.order.api.dto.OrderViews;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.repository.*;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.response.Page;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public class OrderService {
    private final Orders orders;
    private final OrderActivities activities;
    private final IdGenerator ids;
    private final Clock clock;

    public OrderService(Orders orders, OrderActivities activities, IdGenerator ids, Clock clock) {
        this.orders = orders; this.activities = activities; this.ids = ids; this.clock = clock;
    }
    @Transactional
    public OrderViews.Detail create(OrderCommands.Create command, Operator operator) {
        var actor = actor(operator); var now = now();
        if (command.customer() == null || command.fulfillment() == null || command.items() == null || command.items().isEmpty()) throw invalid();
        var customer = command.customer(); var fulfillment = command.fulfillment();
        var contact = new CustomerContact(customer.customerName(), customer.phone(), customer.memberPhone(), customer.buyerName());
        FulfillmentType type;
        try { type = FulfillmentType.valueOf(fulfillment.type()); }
        catch (IllegalArgumentException | NullPointerException failure) { throw invalid(); }
        var plan = new FulfillmentPlan(type, fulfillment.address(), fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt());
        var items = command.items().stream().map(item -> {
            if (item == null) throw invalid();
            return OrderItem.create(ids.nextId(), item.name(), item.productType(), item.quantity(), item.unitPriceCents(), item.memberPriceCents(), item.attributes(), now);
        }).toList();
        var order = Order.create(ids.nextId(), orders.nextNumber(), contact, plan, money(command.totalAmountCents()), items, actor.accountId(), now);
        orders.create(order);
        activities.append(OrderActivity.append(order.id(), null, "CREATED", "创建订单", Map.of("status", order.status(), "paymentStatus", order.paymentStatus()), actor, now));
        return detail(order, List.of());
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderViews.Detail detail(UUID id) { return detail(requireOrder(id), activities.recentItemNotes(id)); }

    @Transactional
    public OrderViews.Detail revise(UUID id, OrderCommands.Revise command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now();
        var changed = order.reviseItem(command.itemId(), command.changes(), now);
        if (!changed.isEmpty()) {
            orders.reviseItem(order, expected, command.itemId());
            activities.append(OrderActivity.append(id, command.itemId(), "ITEM_CHANGED", "修改商品", changed, actor, now));
        }
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail changePaymentStatus(UUID id, OrderCommands.PaymentStatus command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now();
        var changed = order.changePaymentStatus(command.paymentStatus(), now);
        if (changed.isEmpty()) orders.verifyVersion(id, expected);
        else {
            orders.changePaymentStatus(order, expected);
            activities.append(OrderActivity.append(id, null, "PAYMENT_STATUS_CHANGED", "修改付款状态", changed, actor, now));
        }
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail productionAction(UUID id, OrderCommands.ProductionAction command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var previousItems = order.activeItems(); var now = now();
        var changed = order.applyProductionAction(command.action(), now);
        var changedItemIds = previousItems.stream()
                .filter(item -> !Objects.equals(item.productionStatus(), order.requireActiveItem(item.itemId()).productionStatus()))
                .map(OrderItem::itemId).toList();
        orders.changeProduction(order, expected, changedItemIds);
        activities.append(OrderActivity.append(id, null, "ORDER_PRODUCTION_CHANGED", "修改整单制作进度", changed, actor, now));
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Activity note(UUID id, OrderCommands.Note command, Operator operator) {
        var actor = actor(operator); var order = requireOrder(id);
        if (command.itemId() != null) order.requireActiveItem(command.itemId());
        return activity(activities.append(OrderActivity.append(id, command.itemId(), "NOTE", command.content(), Map.of(), actor, now())));
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<OrderViews.Activity> activities(UUID id, UUID itemId, String type, int page, int size) {
        if (page < 1 || size < 1 || size > 100 || (type != null && !OrderActivity.TYPES.contains(type))) throw invalid();
        var order = requireOrder(id);
        if (itemId != null) order.requireActiveItem(itemId);
        return new Page<>(activities.search(id, itemId, type, size, (long) (page - 1) * size).stream().map(OrderService::activity).toList(),
                activities.count(id, itemId, type), page, size);
    }
    private Order requireOrder(UUID id) { return orders.find(id).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND")); }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private static Actor actor(Operator operator) { return new Actor(operator.accountId(), operator.nickname()); }
    private static OrderViews.Activity activity(OrderActivity activity) {
        return new OrderViews.Activity(activity.id(), activity.orderId(), activity.itemId(), activity.type(), activity.content(), activity.details(),
                activity.actorId(), activity.actorNameSnapshot(), activity.createdAt());
    }
    private static OrderViews.Detail detail(Order order, List<OrderActivity> notes) {
        var byItem = new HashMap<UUID, List<OrderViews.Activity>>();
        for (var note : notes) byItem.computeIfAbsent(note.itemId(), ignored -> new ArrayList<>()).add(activity(note));
        var items = order.activeItems().stream().map(item -> new OrderViews.Item(item.itemId(), item.name(), item.productType(), item.quantity(),
                item.unitPriceCents(), item.memberPriceCents(), item.attributes(), item.productionStatus(), item.currentStageCode(),
                item.createdAt(), item.updatedAt(), byItem.getOrDefault(item.itemId(), List.of()))).toList();
        var customer = order.customer(); var fulfillment = order.fulfillment();
        return new OrderViews.Detail(order.id(), order.orderNo(), order.version(), order.status(), order.paymentStatus(), order.currentStageCode(),
                new OrderCommands.Customer(customer.customerName(), customer.phone(), customer.memberPhone(), customer.buyerName()),
                new OrderCommands.Fulfillment(fulfillment.type().name(), fulfillment.address(), fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt()),
                order.totalAmountCents(), order.createdBy(), order.createdAt(), order.confirmedAt(), order.updatedAt(), items);
    }
}

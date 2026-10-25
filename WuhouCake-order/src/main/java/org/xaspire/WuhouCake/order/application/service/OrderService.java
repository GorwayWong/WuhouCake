package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator;
import org.xaspire.WuhouCake.order.api.dto.OrderViews;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.repository.*;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.response.Page;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public class OrderService {
    private final org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity;
    private final Orders orders;
    private final OrderActivities activities;
    private final IdGenerator ids;
    private final Clock clock;
    private final ApplicationEventPublisher events;

    public OrderService(Orders orders, OrderActivities activities, IdGenerator ids, Clock clock, ApplicationEventPublisher events,
            org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity) {
        this.orders = orders; this.activities = activities; this.ids = ids; this.clock = clock;
        this.events = events;
        this.identity = identity;
    }
    @Transactional
    public OrderViews.Detail create(OrderCommands.Create command, Operator operator) {
        return createInternal(command, operator, null);
    }
    @Transactional
    public OrderViews.Detail createCustomer(OrderCommands.Create command, Operator operator, UUID submissionId) {
        if (command.creditedEmployeeId() == null) throw invalid();
        return createInternal(command, operator, submissionId);
    }
    private OrderViews.Detail createInternal(OrderCommands.Create command, Operator operator, UUID submissionId) {
        var actor = actor(operator); var now = now();
        if (command.customer() == null || command.fulfillment() == null || command.items() == null || command.items().isEmpty()) throw invalid();
        var customer = command.customer(); var fulfillment = command.fulfillment();
        var contact = new CustomerContact(customer.customerName(), customer.phone(), customer.memberPhone(), customer.buyerName());
        FulfillmentType type;
        try { type = FulfillmentType.valueOf(fulfillment.type()); }
        catch (IllegalArgumentException | NullPointerException failure) { throw invalid(); }
        var plan = new FulfillmentPlan(type, fulfillment.address(), fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt(), fulfillment.requestedReceiveAt());
        var items = command.items().stream().map(item -> {
            if (item == null) throw invalid();
            return OrderItem.create(ids.nextId(), item.name(), item.productType(), item.quantity(), item.unitPriceCents(), item.memberPriceCents(), item.attributes(), now);
        }).toList();
        var employee = selectEmployee(command.creditedEmployeeId() == null ? actor.accountId() : command.creditedEmployeeId());
        var order = Order.create(ids.nextId(), orders.nextNumber(), contact, plan, money(command.totalAmountCents()), items, actor.accountId(), now, employee);
        orders.create(order);
        var creation = new LinkedHashMap<String, Object>();
        creation.put("status", order.status()); creation.put("paymentStatus", order.paymentStatus());
        creation.put("creditedEmployeeId", employee.accountId().toString()); creation.put("creditedEmployeeName", employee.nickname());
        if (submissionId != null) { creation.put("source", "CUSTOMER_SUBMITTED"); creation.put("submissionId", submissionId.toString()); }
        activities.append(OrderActivity.append(order.id(), null, "CREATED", submissionId == null ? "创建订单" : "确认客户填单 · 来源：用户填写", creation, actor, now));
        changed(order, null, OrderChanged.Type.CREATED);
        return detail(order, List.of());
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public OrderViews.Detail detail(UUID id) { return detail(readOrder(id), activities.recentItemNotes(id)); }

    @Transactional
    public OrderViews.Detail revise(UUID id, OrderCommands.Revise command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now();
        var changed = order.reviseItem(command.itemId(), command.changes(), now);
        if (changed.isEmpty()) orders.verifyVersion(id, expected);
        else {
            orders.reviseItem(order, expected, command.itemId());
            activities.append(OrderActivity.append(id, command.itemId(), "ITEM_CHANGED", "修改商品", changed, actor, now));
            changed(order, command.itemId(), OrderChanged.Type.ITEM_CHANGED);
        }
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail removeItem(UUID id, UUID itemId, OrderCommands.RemoveItem command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now(); var changed = order.removeItem(itemId, now);
        if (changed.isEmpty()) orders.verifyVersion(id, expected);
        else {
            orders.removeItem(order, expected, itemId);
            activities.append(OrderActivity.append(id, itemId, "ITEM_REMOVED", "移除商品", changed, actor, now));
            changed(order, itemId, OrderChanged.Type.ITEM_REMOVED);
        }
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail addItem(UUID id, OrderCommands.AddItem command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now(); var input = command.item();
        if (input == null) throw invalid();
        var item = OrderItem.create(ids.nextId(), input.name(), input.productType(), input.quantity(), input.unitPriceCents(),
                input.memberPriceCents(), input.attributes(), now);
        var changed = order.addItem(item, now);
        orders.addItem(order, expected, item.itemId());
        activities.append(OrderActivity.append(id, item.itemId(), "ITEM_ADDED", "追加商品", changed, actor, now));
        changed(order, item.itemId(), OrderChanged.Type.ITEM_ADDED);
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail reviseInformation(UUID id, OrderCommands.Information command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var employee = order.creditedEmployee();
        if (command.changes().containsKey("creditedEmployeeId")) {
            UUID selected;
            try { selected = UUID.fromString((String) command.changes().get("creditedEmployeeId")); }
            catch (RuntimeException failure) { throw invalid(); }
            if (employee == null || !employee.accountId().equals(selected)) employee = selectEmployee(selected);
        }
        var now = now(); var changed = order.reviseInformation(command.changes(), now, employee);
        if (changed.isEmpty()) orders.verifyVersion(id, expected);
        else {
            orders.reviseInformation(order, expected);
            activities.append(OrderActivity.append(id, null, "ORDER_INFORMATION_CHANGED", "更正订单资料", changed, actor, now));
            changed(order, null, OrderChanged.Type.ORDER_INFORMATION_CHANGED);
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
            changed(order, null, OrderChanged.Type.PAYMENT_STATUS_CHANGED);
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
        changed(order, null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED);
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail restartCancelled(UUID id, OrderCommands.Restart command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var previousItems = order.activeItems(); var now = now();
        var changed = order.restartCancelled(now);
        var changedItemIds = previousItems.stream()
                .filter(item -> !Objects.equals(item.productionStatus(), order.requireActiveItem(item.itemId()).productionStatus()))
                .map(OrderItem::itemId).toList();
        orders.changeProduction(order, expected, changedItemIds);
        activities.append(OrderActivity.append(id, null, "ORDER_PRODUCTION_CHANGED", "恢复已取消订单至待制作", changed, actor, now));
        changed(order, null, OrderChanged.Type.ORDER_PRODUCTION_CHANGED);
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail fulfillmentAction(UUID id, OrderCommands.FulfillmentAction command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now(); var changed = order.applyFulfillmentAction(command.action(), now);
        orders.changeStatus(order, expected);
        activities.append(OrderActivity.append(id, null, "ORDER_FULFILLMENT_CHANGED", "修改整单交接状态", changed, actor, now));
        changed(order, null, OrderChanged.Type.ORDER_FULFILLMENT_CHANGED);
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail completeSimpleItem(UUID id, UUID itemId, OrderCommands.SimpleItemCompletion command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        if (command.completed() == null) throw invalid();
        var now = now(); var details = order.completeSimpleItem(itemId, command.completed(), now);
        if (details.isEmpty()) orders.verifyVersion(id, expected);
        else {
            orders.changeProduction(order, expected, List.of(itemId));
            activities.append(OrderActivity.append(id, itemId, "ORDER_PRODUCTION_CHANGED", "更新商品制作确认", details, actor, now));
            changed(order, itemId, OrderChanged.Type.ORDER_PRODUCTION_CHANGED);
        }
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail cancel(UUID id, OrderCommands.Cancel command, Operator operator) {
        var actor = actor(operator); long expected = nonNegativeInteger(command.expectedVersion());
        var order = requireOrder(id);
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now(); var changed = order.cancel(command.reason(), now);
        orders.changeStatus(order, expected);
        activities.append(OrderActivity.append(id, null, "ORDER_CANCELLED", command.reason(), changed, actor, now));
        changed(order, null, OrderChanged.Type.ORDER_CANCELLED);
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Detail delete(UUID id, OrderCommands.Delete command, Operator operator) {
        if (!identity.me().access().allows(org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_DELETE))
            throw new OrderFailure("ORDER_DELETED_FORBIDDEN");
        long expected = nonNegativeInteger(command.expectedVersion());
        var actor = actor(operator);
        var order = orders.lock(id).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        if (order.deletion() != null) {
            if (order.deletion().expired(now())) throw new OrderFailure("ORDER_NOT_FOUND");
            return detail(order, activities.recentItemNotes(id));
        }
        if (order.version() != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        var now = now(); order.delete(command.reason(), actor, now);
        orders.delete(order, expected);
        activities.append(OrderActivity.append(id, null, "ORDER_DELETED", order.deletion().reason(), Map.of(), actor, now));
        changed(order, null, OrderChanged.Type.ORDER_DELETED);
        return detail(order, activities.recentItemNotes(id));
    }
    @Transactional
    public OrderViews.Activity note(UUID id, OrderCommands.Note command, Operator operator) {
        var actor = actor(operator);
        orders.lock(id).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        var order = requireOrder(id);
        if (command.itemId() != null) order.requireActiveItem(command.itemId());
        var note = activities.append(OrderActivity.append(id, command.itemId(), "NOTE", command.content(), Map.of(), actor, now()));
        changed(order, command.itemId(), OrderChanged.Type.NOTE);
        return activity(note);
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Page<OrderViews.Activity> activities(UUID id, UUID itemId, String type, int page, int size) {
        if (page < 1 || size < 1 || size > 100 || (type != null && !OrderActivity.TYPES.contains(type))) throw invalid();
        var order = readOrder(id);
        if (itemId != null) order.requireItem(itemId);
        return new Page<>(activities.search(id, itemId, type, size, (long) (page - 1) * size).stream().map(OrderService::activity).toList(),
                activities.count(id, itemId, type), page, size);
    }
    private Order requireOrder(UUID id) {
        var order = orders.find(id).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        if (order.deletion() != null && order.deletion().expired(now())) throw new OrderFailure("ORDER_NOT_FOUND");
        order.requireWritable();
        return order;
    }
    private Order readOrder(UUID id) {
        var order = orders.find(id).orElseThrow(() -> new OrderFailure("ORDER_NOT_FOUND"));
        OrderReadAccess.requireReadable(order, clock, identity);
        return order;
    }
    private void changed(Order order, UUID itemId, OrderChanged.Type type) {
        events.publishEvent(new OrderChanged(order.id(), itemId, type, order.version(), order.orderNo()));
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private static Actor actor(Operator operator) { return new Actor(operator.accountId(), operator.nickname()); }
    private Attribution selectEmployee(UUID id) {
        var employee = identity.selectEmployee(id);
        return new Attribution(employee.accountId(), employee.employeeNumber(), employee.nickname());
    }
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
                new OrderCommands.Fulfillment(fulfillment.type().name(), fulfillment.address(), fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt(), fulfillment.requestedReceiveAt()),
                order.totalAmountCents(), order.createdBy(), order.createdAt(), order.confirmedAt(), order.updatedAt(), items,
                order.creditedEmployee() == null ? null : new OrderViews.Employee(order.creditedEmployee().accountId(),
                        order.creditedEmployee().employeeNumber(), order.creditedEmployee().nickname()), order.paidAt(),
                order.deletion() == null ? null : new OrderViews.Deletion(order.deletion().deletedAt(), order.deletion().deletedBy(),
                        order.deletion().employeeName(), order.deletion().reason(), order.deletion().expiresAt()));
    }
}

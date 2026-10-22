package org.xaspire.WuhouCake.order.application.service;

import java.util.List;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
import org.xaspire.WuhouCake.order.api.command.OrderCommands.Fulfillment;
import org.xaspire.WuhouCake.order.api.dto.OrderQueryViews;
import org.xaspire.WuhouCake.order.api.dto.OrderViews;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;

/** Projects structured customer and financial data according to the caller's effective permissions. */
public final class OrderViewAccess {
    private OrderViewAccess() { }

    public static OrderViews.Detail detail(OrderViews.Detail source, EmployeeAccess access) {
        if (source == null) return null;
        boolean customer = access.allows(ORDER_CUSTOMER_READ), amount = access.allows(ORDER_AMOUNT_READ);
        var fulfillment = source.fulfillment();
        if (!customer && fulfillment != null) fulfillment = new Fulfillment(fulfillment.type(), null,
                fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt(), fulfillment.requestedReceiveAt());
        return new OrderViews.Detail(source.orderId(), source.orderNo(), source.version(), source.status(),
                amount ? source.paymentStatus() : null, source.currentStageCode(), customer ? source.customer() : null,
                fulfillment, amount ? source.totalAmountCents() : null, source.createdBy(), source.createdAt(), source.confirmedAt(),
                source.updatedAt(), source.items().stream().map(item -> new OrderViews.Item(item.itemId(), item.name(), item.productType(),
                        item.quantity(), amount ? item.unitPriceCents() : null, amount ? item.memberPriceCents() : null,
                        item.attributes(), item.productionStatus(), item.currentStageCode(), item.createdAt(), item.updatedAt(), item.recentNotes())).toList(),
                source.creditedEmployee());
    }

    public static List<OrderQueryViews.CalendarOrder> calendar(List<OrderQueryViews.CalendarOrder> source, EmployeeAccess access) {
        if (source == null) return null;
        return source.stream().map(order -> new OrderQueryViews.CalendarOrder(order.orderId(), order.orderNo(), order.calendarDate(),
                order.status(), order.currentStageCode(), access.allows(ORDER_AMOUNT_READ) ? order.paymentStatus() : null,
                order.fulfillmentType(), order.plannedHandoffAt(), order.items())).toList();
    }

    public static OrderQueryViews.Workbench workbench(OrderQueryViews.Workbench source, EmployeeAccess access) {
        if (source == null) return null;
        boolean customer = access.allows(ORDER_CUSTOMER_READ), amount = access.allows(ORDER_AMOUNT_READ);
        var orders = source.pendingOrders().stream().map(order -> new OrderQueryViews.PendingOrder(order.orderId(), order.orderNo(),
                order.calendarDate(), order.status(), order.currentStageCode(), amount ? order.paymentStatus() : null, order.fulfillmentType(),
                order.plannedHandoffAt(), customer ? order.customer() : null, customer ? order.address() : null, order.plannedFinishAt(),
                order.items().stream().map(item -> new OrderQueryViews.Item(item.itemId(), item.name(), item.productType(), item.quantity(),
                        amount ? item.unitPriceCents() : null, amount ? item.memberPriceCents() : null, item.attributes(), item.recentNotes())).toList())).toList();
        return new OrderQueryViews.Workbench(source.date(), source.metrics(), orders);
    }
}

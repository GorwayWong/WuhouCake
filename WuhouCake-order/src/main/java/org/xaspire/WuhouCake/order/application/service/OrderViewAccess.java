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
    public static OrderQueryViews.PaymentOrders paymentOrders(OrderQueryViews.PaymentOrders source, EmployeeAccess access) {
        return new OrderQueryViews.PaymentOrders(source.date(), source.kind(), source.page(), source.total(),
                source.orders().stream().map(row -> new OrderQueryViews.PaymentOrder(row.orderId(), row.orderNo(),
                        access.allows(ORDER_BUSINESS_DETAILS_READ) ? row.createdAt() : null, row.calendarDate(),
                        access.allows(ORDER_AMOUNT_READ) ? row.paidAt() : null,
                        access.allows(ORDER_AMOUNT_READ) ? row.amountCents() : null,
                        access.allows(ORDER_AMOUNT_READ) ? row.paymentStatus() : null, row.status(), row.currentStageCode())).toList());
    }

    public static OrderViews.Detail detail(OrderViews.Detail source, EmployeeAccess access) {
        if (source == null) return null;
        boolean customer = access.allows(ORDER_CUSTOMER_READ), amount = access.allows(ORDER_AMOUNT_READ);
        boolean business = access.allows(ORDER_BUSINESS_DETAILS_READ);
        var contact = customer ? source.customer() : access.allows(ORDER_PHONE_READ) && source.customer() != null
                ? new org.xaspire.WuhouCake.order.api.command.OrderCommands.Customer(null, source.customer().phone(), null, null) : null;
        var fulfillment = source.fulfillment();
        if (!customer && fulfillment != null) fulfillment = new Fulfillment(fulfillment.type(), null,
                fulfillment.requestedReceiveDate(), fulfillment.plannedHandoffAt(), fulfillment.plannedFinishAt(), fulfillment.requestedReceiveAt());
        return new OrderViews.Detail(source.orderId(), source.orderNo(), source.version(), source.status(),
                amount ? source.paymentStatus() : null, source.currentStageCode(), contact,
                fulfillment, amount ? source.totalAmountCents() : null, business ? source.createdBy() : null, business ? source.createdAt() : null, business ? source.confirmedAt() : null,
                source.updatedAt(), source.items().stream().map(item -> new OrderViews.Item(item.itemId(), item.name(), item.productType(),
                        item.quantity(), amount ? item.unitPriceCents() : null, amount ? item.memberPriceCents() : null,
                        item.attributes(), item.productionStatus(), item.currentStageCode(), business ? item.createdAt() : null, item.updatedAt(), item.recentNotes())).toList(),
                business ? source.creditedEmployee() : null, amount ? source.paidAt() : null, source.deletion());
    }

    public static List<OrderQueryViews.CalendarOrder> calendar(List<OrderQueryViews.CalendarOrder> source, EmployeeAccess access) {
        if (source == null) return null;
        return source.stream().map(order -> new OrderQueryViews.CalendarOrder(order.orderId(), order.orderNo(), order.calendarDate(),
                order.status(), order.currentStageCode(), access.allows(ORDER_AMOUNT_READ) ? order.paymentStatus() : null,
                order.fulfillmentType(), order.plannedHandoffAt(), access.allows(ORDER_CUSTOMER_READ) ? order.customerPhoneLast4() : null, order.items())).toList();
    }

    public static OrderQueryViews.Workbench workbench(OrderQueryViews.Workbench source, EmployeeAccess access) {
        if (source == null) return null;
        boolean customer = access.allows(ORDER_CUSTOMER_READ), amount = access.allows(ORDER_AMOUNT_READ);
        var orders = source.pendingOrders().stream().map(order -> new OrderQueryViews.PendingOrder(order.orderId(), order.orderNo(),
                order.calendarDate(), order.status(), order.currentStageCode(), amount ? order.paymentStatus() : null, order.fulfillmentType(),
                order.plannedHandoffAt(), customer ? order.customer() : null, customer ? order.address() : null, order.plannedFinishAt(),
                order.items().stream().map(item -> new OrderQueryViews.Item(item.itemId(), item.name(), item.productType(), item.quantity(),
                        amount ? item.unitPriceCents() : null, amount ? item.memberPriceCents() : null, item.attributes(), item.recentNotes())).toList(),
                order.latestNote())).toList();
        return new OrderQueryViews.Workbench(source.date(), source.metrics(), orders);
    }
}

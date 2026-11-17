package org.xaspire.WuhouCake.order.application.service;

import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_DELETED_READ;

final class OrderReadAccess {
    private OrderReadAccess() { }
    static void requireReadable(Order order, IdentityFacade identity) {
        if (order.deletion() == null) return;
        if (identity == null || !identity.me().access().allows(ORDER_DELETED_READ)) throw new OrderFailure("ORDER_DELETED_FORBIDDEN");
    }
    static void requireDeletedRead(IdentityFacade identity) {
        if (identity == null || !identity.me().access().allows(ORDER_DELETED_READ)) throw new OrderFailure("ORDER_DELETED_FORBIDDEN");
    }
}

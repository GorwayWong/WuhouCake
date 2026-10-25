package org.xaspire.WuhouCake.order.application.service;

import java.time.Clock;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_DELETED_READ;

final class OrderReadAccess {
    private OrderReadAccess() { }
    static void requireReadable(Order order, Clock clock, IdentityFacade identity) {
        if (order.deletion() == null) return;
        if (order.deletion().expired(clock.instant())) throw new OrderFailure("ORDER_NOT_FOUND");
        if (identity == null || !identity.me().access().allows(ORDER_DELETED_READ)) throw new OrderFailure("ORDER_DELETED_FORBIDDEN");
    }
    static void requireDeletedRead(IdentityFacade identity) {
        if (identity == null || !identity.me().access().allows(ORDER_DELETED_READ)) throw new OrderFailure("ORDER_DELETED_FORBIDDEN");
    }
}

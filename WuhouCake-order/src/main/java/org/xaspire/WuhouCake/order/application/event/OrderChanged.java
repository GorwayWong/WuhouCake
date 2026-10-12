package org.xaspire.WuhouCake.order.application.event;

import java.util.UUID;

public record OrderChanged(UUID orderId, UUID itemId, Type changeType, long version) {
    public enum Type { CREATED, ITEM_CHANGED, NOTE, PAYMENT_STATUS_CHANGED, ORDER_PRODUCTION_CHANGED, ORDER_FULFILLMENT_CHANGED, ORDER_CANCELLED }
}

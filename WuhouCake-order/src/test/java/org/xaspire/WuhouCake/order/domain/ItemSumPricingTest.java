package org.xaspire.WuhouCake.order.domain;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import static org.junit.jupiter.api.Assertions.*;

class ItemSumPricingTest {
    private static final Instant NOW = Instant.parse("2026-11-13T08:00:00Z");
    private OrderItem item(String type, int count, Long original, Long member) {
        return OrderItem.create(UUID.randomUUID(), "商品", type, count, null, null, Map.of(), NOW).retainHistoricalPrices(original, member);
    }
    private Order order(String method, OrderItem... items) {
        return Order.create(UUID.randomUUID(), "TEST", new CustomerContact(null, "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 11, 14), null, null), null,
                List.of(items), UUID.randomUUID(), NOW, null, null, null, null, method, "ITEM_SUM");
    }
    @Test void mixedProductsUseQuantityAndMemberFallback() {
        var cake = item("CAKE", 2, 1001L, 900L); var other = item("OTHER", 3, 301L, null);
        var order = order("UNPAID", cake, other);
        assertEquals(2905L, order.originalAmountCents()); assertEquals(2703L, order.memberAmountCents());
        assertEquals(2703L, order.totalAmountCents()); assertEquals("MANUAL", order.pricingMode());
        order.reviseItem(cake.itemId(), Map.of("quantity", 3), NOW.plusSeconds(1));
        assertEquals(2703L, order.totalAmountCents());
        order.removeItem(other.itemId(), NOW.plusSeconds(2)); assertEquals(2703L, order.totalAmountCents());
        order.addItem(item("OTHER", 2, 200L, null), NOW.plusSeconds(3)); assertEquals(2703L, order.totalAmountCents());
        order.reviseInformation(Map.of("originalAmountCents", 2500, "memberAmountCents", 2000), NOW);
        assertEquals(2000L, order.totalAmountCents());
    }
    @Test void absentPricesRemainAbsentAndZeroIsPayable() {
        var priced = item("OTHER", 2, 100L, null); var missing = item("CAKE", 1, null, null);
        var order = order("UNPAID", priced, missing);
        assertNull(order.originalAmountCents()); assertNull(order.memberAmountCents()); assertNull(order.totalAmountCents());
        assertEquals("ORDER_QUOTE_INCOMPLETE", assertThrows(OrderFailure.class, () -> order.changePaymentStatus("PAID", "CASH", NOW)).getMessage());
        assertThrows(OrderFailure.class, () -> order("CASH", missing));
        order.reviseItem(missing.itemId(), Map.of("referenceMemberPriceCents", 0), NOW);
        assertNull(order.originalAmountCents()); assertNull(order.totalAmountCents());
        order.reviseInformation(Map.of("memberAmountCents", 200), NOW);
        order.changePaymentStatus("PAID", "CASH", NOW);
        assertEquals("PAID", order.paymentStatus());
        assertNull(order("UNPAID", priced).memberAmountCents());
        assertEquals(0L, order("CASH", item("OTHER", 2, 100L, 0L)).totalAmountCents());
    }
    @Test void paidQuoteStaysFixedWhenItemsChange() {
        var cake = item("CAKE", 2, 100L, 80L); var other = item("OTHER", 1, 200L, null);
        var order = order("CASH", cake, other);
        order.reviseItem(cake.itemId(), Map.of("quantity", 3), NOW);
        order.removeItem(other.itemId(), NOW);
        order.addItem(item("OTHER", 1, 1L, null), NOW);
        assertEquals(360L, order.totalAmountCents());
        assertThrows(OrderFailure.class, () -> order.reviseInformation(Map.of("memberAmountCents", 100), NOW));
        order.changePaymentStatus("UNPAID", "UNPAID", NOW);
        order.reviseInformation(Map.of("memberAmountCents", 100), NOW);
        assertEquals(100L, order.totalAmountCents());
    }
    @Test void rejectsFractionalNegativeAndOverflowValues() {
        for (Object value : List.of(-1, new BigDecimal("1.001"), 1.0, Long.MAX_VALUE))
            assertThrows(OrderFailure.class, () -> OrderValues.money(value));
        var max = item("OTHER", 1, OrderValues.MAX_MONEY_CENTS, null);
        assertEquals(OrderValues.MAX_MONEY_CENTS, order("UNPAID", max).totalAmountCents());
        assertThrows(OrderFailure.class, () -> order("UNPAID", max, item("OTHER", 1, 1L, null)));
        assertThrows(OrderFailure.class, () -> order("UNPAID", item("OTHER", Integer.MAX_VALUE, OrderValues.MAX_MONEY_CENTS, null)));
        for (Object quantity : List.of(0, -1, new BigDecimal("1.5"), 2147483648L))
            assertThrows(OrderFailure.class, () -> OrderValues.quantity(quantity));
    }
}

package org.xaspire.WuhouCake.order.domain;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import static org.junit.jupiter.api.Assertions.*;

class OrderPricingTest {
    private static final Instant NOW = Instant.parse("2026-11-08T08:00:00Z");
    private Order create(Long original, Long member, String method) {
        return Order.create(UUID.randomUUID(), "TEST", new CustomerContact("客户", "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 11, 9), null, null), null,
                List.of(OrderItem.create(UUID.randomUUID(), "蛋糕", "CAKE", 1, null, null, Map.of(), NOW)), UUID.randomUUID(), NOW,
                null, null, original, member, method);
    }
    @Test void memberQuoteWinsIncludingZeroAndAllPaymentChannelsRecordServerTime() {
        for (String method : List.of("UNIONPAY", "MEMBER_CARD", "BANK_TRANSFER", "SERVICE_WECHAT", "CASH")) {
            var order = create(15800L, 12800L, method);
            assertEquals(12800L, order.totalAmountCents()); assertEquals(15800L, order.originalAmountCents());
            assertEquals(12800L, order.memberAmountCents()); assertEquals("PAID", order.paymentStatus());
            assertEquals(method, order.paymentMethod()); assertEquals(NOW, order.paidAt()); assertEquals(0, order.version());
        }
        assertEquals(0L, create(15800L, 0L, "UNPAID").totalAmountCents());
        assertEquals(15800L, create(15800L, null, "UNPAID").totalAmountCents());
        var blank = create(null, null, "UNPAID"); assertNull(blank.totalAmountCents()); assertNull(blank.paidAt());
        assertThrows(OrderFailure.class, () -> create(-1L, null, "CASH"));
        assertThrows(OrderFailure.class, () -> create(null, 9007199254740992L, "CASH"));
        assertThrows(OrderFailure.class, () -> create(null, null, "INVALID"));
    }
    @Test void paidOrderLocksEffectiveAmountUntilPaymentIsRevoked() {
        var order = create(15800L, 12800L, "CASH");
        order.reviseInformation(Map.of("originalAmountCents", 16800), NOW.plusSeconds(1));
        assertEquals(12800L, order.totalAmountCents()); assertEquals(16800L, order.originalAmountCents());
        var clearMember = new HashMap<String, Object>(); clearMember.put("memberAmountCents", null);
        assertEquals("ORDER_PAID_AMOUNT_LOCKED", assertThrows(OrderFailure.class,
                () -> order.reviseInformation(clearMember, NOW.plusSeconds(2))).getMessage());
        assertEquals(12800L, order.totalAmountCents());
        assertEquals(NOW, order.paidAt());
        order.changePaymentStatus("UNPAID", "UNPAID", NOW.plusSeconds(2));
        order.reviseInformation(clearMember, NOW.plusSeconds(2));
        assertEquals(16800L, order.totalAmountCents()); assertNull(order.memberAmountCents()); assertNull(order.paidAt());
        var clearOriginal = new HashMap<String, Object>(); clearOriginal.put("originalAmountCents", null);
        order.reviseInformation(clearOriginal, NOW.plusSeconds(3)); assertNull(order.totalAmountCents());
        order.reviseInformation(Map.of("memberAmountCents", 0), NOW.plusSeconds(4)); assertEquals(0L, order.totalAmountCents());
        long version = order.version();
        assertThrows(OrderFailure.class, () -> order.reviseInformation(Map.of("totalAmountCents", 200), NOW.plusSeconds(5)));
        assertEquals(version, order.version()); assertEquals(0L, order.totalAmountCents());
    }
    @Test void methodCorrectionRetainsReceiptDateAndUnpaidThenPaidRecordsNewDate() {
        var order = create(100L, null, "UNIONPAY");
        assertFalse(order.changePaymentStatus("PAID", "CASH", NOW.plusSeconds(1)).isEmpty());
        assertEquals(NOW, order.paidAt()); assertEquals("CASH", order.paymentMethod()); assertEquals(1, order.version());
        assertTrue(order.changePaymentStatus("PAID", "CASH", NOW.plusSeconds(2)).isEmpty());
        order.changePaymentStatus("UNPAID", "UNPAID", NOW.plusSeconds(3)); assertNull(order.paidAt());
        order.changePaymentStatus("PAID", "MEMBER_CARD", NOW.plusSeconds(4)); assertEquals(NOW.plusSeconds(4), order.paidAt());
        long version = order.version();
        assertThrows(OrderFailure.class, () -> order.changePaymentStatus("UNPAID", "CASH", NOW.plusSeconds(5)));
        assertEquals(version, order.version());
    }
}

package org.xaspire.WuhouCake.order.domain;

import java.math.BigDecimal;
import java.math.BigInteger;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import static org.junit.jupiter.api.Assertions.*;

class OrderValuesTest {
    @Test void moneyKeepsNullZeroAndExactSafeBoundary() {
        assertNull(money(null));
        assertEquals(0L, money(0));
        assertEquals(29L, money(new BigDecimal("29")));
        assertEquals(MAX_MONEY_CENTS, money(MAX_MONEY_CENTS));
        assertEquals(MAX_MONEY_CENTS, money(new BigInteger("9007199254740991")));
        assertEquals(MAX_MONEY_CENTS, money(new BigDecimal("9007199254740991.00")));
    }

    @Test void invalidMoneyIsRejectedWithoutRounding() {
        for (Object value : new Object[]{MAX_MONEY_CENTS + 1, Long.MAX_VALUE,
                new BigInteger("9007199254740992"), new BigDecimal("9007199254740991.01"),
                -1, new BigDecimal("0.1"), 29.0d, 29.0f, "29"}) {
            assertEquals("VALIDATION_FAILED", assertThrows(OrderFailure.class, () -> money(value)).code());
        }
    }

    @Test void moneyLimitDoesNotRestrictVersionsOrOtherIntegerFields() {
        assertEquals(Long.MAX_VALUE, nonNegativeInteger(Long.MAX_VALUE));
        assertEquals(Integer.MAX_VALUE, quantity(Integer.MAX_VALUE));
    }
}

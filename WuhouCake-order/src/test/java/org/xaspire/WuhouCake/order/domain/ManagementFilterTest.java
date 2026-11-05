package org.xaspire.WuhouCake.order.domain;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.Filter;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.junit.jupiter.api.Assertions.*;

class ManagementFilterTest {
    private Filter filter(String name, boolean allUnpaid) {
        return new Filter(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 11, 1), null, null, null,
                null, null, false, false, null, null, allUnpaid, false, name);
    }
    @Test void normalizesOptionalProductNameWithoutInterpretingSpecialCharacters() {
        assertNull(filter(null, false).productName());
        assertNull(filter("　 \t", false).productName());
        assertEquals("蛋糕%_'\\", filter(" 蛋糕%_'\\ ", false).productName());
        assertEquals(100, filter("糕".repeat(100), false).productName().length());
        assertThrows(OrderFailure.class, () -> filter("糕".repeat(101), false));
    }
    @Test void historicalUnpaidModeClearsProductFilterBeforeValidation() {
        var filter = filter("糕".repeat(101), true);
        assertNull(filter.productName()); assertEquals("UNPAID", filter.paymentStatus());
    }
    @Test void existingFilterConstructorKeepsProductNameOptional() {
        assertNull(new Filter(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 11, 1), null, null, null,
                null, null, false, false, null, null).productName());
    }
    @Test void orderingMethodPreservesLiteralTextAndValidatesLengthExceptInUnpaidShortcut() {
        for (String method : new String[]{null, "　 ", "下单人", "小程序", "到店", "客服号", " 微信%_'\\ ", "长".repeat(80)}) {
            var filter = methodFilter(method, false);
            assertEquals(method == null || method.isBlank() ? null : method.strip(), filter.orderingMethod());
        }
        assertThrows(OrderFailure.class, () -> methodFilter("长".repeat(81), false));
        assertNull(methodFilter("长".repeat(81), true).orderingMethod());
        assertNull(filter(null, false).orderingMethod());
    }
    private Filter methodFilter(String method, boolean allUnpaid) {
        return new Filter(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 11, 1), null, null, null,
                null, null, false, false, null, null, allUnpaid, false, null, method);
    }
}

package org.xaspire.WuhouCake.order.domain;

import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.junit.jupiter.api.Assertions.*;

class CustomerSubmissionTest {
    private CustomerSubmission.Product cake(Map<String, String> attributes) { return new CustomerSubmission.Product("蛋糕", "CAKE", 1, attributes); }
    private CustomerSubmission.Content content(String phone) {
        return new CustomerSubmission.Content(phone, "13800000001", "DELIVERY", "合成地址", Instant.parse("2026-11-01T16:30:00Z"), List.of(cake(Map.of("size", "8"))));
    }
    @Test void cakeFieldsHaveCorrectDefaultsAndNoDefaultsLeakIntoOtherProducts() {
        var cake = cake(Map.of("size", "8.00", "flavor", "动物奶油", "filling", "芒果，奥利奥"));
        assertEquals("8", cake.attributes().get("size")); assertEquals("原味", cake.attributes().get("base"));
        assertEquals("芒果，奥利奥", cake.attributes().get("filling")); assertEquals("动物奶油", cake.attributes().get("flavor"));
        var donut = new CustomerSubmission.Product("甜甜圈", "DONUT", 6, Map.of("filling", "巧克力"));
        assertEquals(Map.of("filling", "巧克力"), donut.attributes());
        assertThrows(UnsupportedOperationException.class, () -> cake.attributes().put("size", "10"));
    }
    @Test void invalidCustomerFieldsCannotIntroduceInternalData() {
        assertThrows(OrderFailure.class, () -> cake(Map.of()));
        assertThrows(OrderFailure.class, () -> cake(Map.of("size", "-8")));
        assertThrows(OrderFailure.class, () -> cake(Map.of("size", "8", "totalAmountCents", "0")));
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Product("", "CAKE", 1, Map.of("size", "8")));
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Product("蛋糕", null, 1, Map.of()));
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Content("13800000000", null, "DELIVERY", "", Instant.now(), List.of(cake(Map.of("size", "8")))));
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Content("13800000000", null, "PICKUP", null, Instant.now(), List.of()));
    }
    @Test void receivingDateIsBeijingDateAndPhoneIsNotMemberIdentity() {
        var content = content("13800000000");
        assertEquals("2026-11-02", content.requestedDate().toString()); assertNotEquals(content.phone(), content.memberPhone());
    }
    @Test void phoneFormatIsCheckedAndSeparatorsNormalizeWithoutGuessingACountry() {
        assertEquals("13800000000", content("138 0000-0000").phone());
        assertEquals("+8613800000000", content("+86 (138) 0000-0000").phone());
        assertThrows(OrderFailure.class, () -> content("abc"));
        assertThrows(OrderFailure.class, () -> content("138abc00000000"));
    }
    @Test void reviewRequiresExplicitPriceAndAttributionButAllowsMissingHandoff() {
        var review = new CustomerSubmission.Review(content("13800000000"), null, null, null, null);
        assertEquals(1, review.prices().size()); assertThrows(OrderFailure.class, review::requireConfirmation);
        assertDoesNotThrow(() -> new CustomerSubmission.Review(review.content(), null, 0L, UUID.randomUUID(), Instant.now()).requireConfirmation());
        assertDoesNotThrow(() -> new CustomerSubmission.Review(review.content(), null, 0L, UUID.randomUUID(), null).requireConfirmation());
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Review(review.content(), null, null, UUID.randomUUID(), null).requireConfirmation());
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Review(review.content(), null, 0L, null, null).requireConfirmation());
        assertThrows(OrderFailure.class, () -> new CustomerSubmission.Review(review.content(), List.of(), 100L, UUID.randomUUID(), Instant.now()));
    }
    @Test void simpleTypesAcceptNoSizeAndReportSpecificConfirmationErrors() {
        for (var type : List.of("BREAD", "DONUT", "CUPCAKE", "DRINK")) {
            var product = new CustomerSubmission.Product("商品", type, 2, Map.of("specification", "小份"));
            assertFalse(product.attributes().containsKey("size"));
        }
        assertEquals("SUBMISSION_PRODUCT_TYPE_INVALID", assertThrows(OrderFailure.class,
                () -> new CustomerSubmission.Product("商品", "UNKNOWN", 1, Map.of())).code());
        assertEquals("SUBMISSION_CAKE_SIZE_REQUIRED", assertThrows(OrderFailure.class, () -> cake(Map.of())).code());
        assertEquals("SUBMISSION_TOTAL_REQUIRED", assertThrows(OrderFailure.class,
                () -> new CustomerSubmission.Review(content("13800000000"), null, null, UUID.randomUUID(), null).requireConfirmation()).code());
        assertEquals("SUBMISSION_EMPLOYEE_REQUIRED", assertThrows(OrderFailure.class,
                () -> new CustomerSubmission.Review(content("13800000000"), null, 100L, null, null).requireConfirmation()).code());
    }
    @Test void futureCustomerFieldDiffExcludesInternalEmployeePriceAndStateFields() {
        var before = content("13800000000"); var after = content("13800000002");
        var diff = CustomerSubmission.differences(before, after);
        assertEquals(Set.of("phone"), diff.keySet()); assertEquals(Map.of("before", "13800000000", "after", "13800000002"), diff.get("phone"));
        assertFalse(CustomerSubmission.customerFields(before).containsKey("creditedEmployeeId"));
        assertTrue(CustomerSubmission.differences(before, before).isEmpty());
    }
}

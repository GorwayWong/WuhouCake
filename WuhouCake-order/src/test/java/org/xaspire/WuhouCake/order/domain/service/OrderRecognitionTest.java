package org.xaspire.WuhouCake.order.domain.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.*;
import java.time.*;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft;
import static org.junit.jupiter.api.Assertions.*;

class OrderRecognitionTest {
    @ParameterizedTest @ValueSource(strings = {"规格（寸）", "规格(寸)", "尺寸", "蛋糕尺寸"})
    void sizeLabelsShareTheSameNumericFieldAndDoNotInferAProductType(String label) throws Exception {
        var fields = recognition().parse(label + "：6").items().getFirst().fields();
        assertEquals("6", fields.get("size").value()); assertNull(fields.get("specification").value());
        assertNull(fields.get("productType").value());
    }
    @Test void newSizeLabelsDoNotChangeOrdinarySpecificationsOrMixProductFields() throws Exception {
        var items = recognition().parse("商品1：蛋糕\n规格（寸）：6\n商品2：饮品\n规格：300ml").items();
        assertEquals("6", items.getFirst().fields().get("size").value()); assertNull(items.getFirst().fields().get("specification").value());
        assertEquals("300ml", items.getLast().fields().get("specification").value()); assertNull(items.getLast().fields().get("size").value());
        assertEquals("OTHER", items.getLast().fields().get("productType").value());
    }
    @Test void creamDefaultsOnlyForCakesAndExplicitCreamKeepsItsEvidence() throws Exception {
        var cream = recognition().parse("商品：8寸蛋糕").items().getFirst().fields().get("flavor");
        assertEquals("原味奶油", cream.value()); assertEquals(RecognitionDraft.Source.DEFAULT, cream.source()); assertTrue(cream.evidence().isEmpty());
        var explicit = recognition().parse("商品：8寸蛋糕\n奶油：巧克力奶油").items().getFirst().fields().get("flavor");
        assertEquals("巧克力奶油", explicit.value()); assertEquals(RecognitionDraft.Source.RULE, explicit.source()); assertFalse(explicit.evidence().isEmpty());
        assertNull(recognition().parse("商品：面包").items().getFirst().fields().get("flavor").value());
    }
    @ParameterizedTest @ValueSource(strings = {"订购人姓名", "订购人", "客户订购人", "客户下单人", "下单人"})
    void buyerNameLabelsKeepTheirOwnField(String label) throws Exception {
        var result = recognition().parse("客户姓名：李女士\n" + label + "：陈女士\n电话：13800000001");
        assertEquals("陈女士", result.fields().get("buyerName").value());
        assertEquals("李女士", result.fields().get("customerName").value());
    }
    private static final ObjectMapper JSON = new ObjectMapper();
    private static OrderRecognition recognition() throws Exception {
        try (var input = OrderRecognition.class.getResourceAsStream("/order/cake-defaults.json")) {
            return new OrderRecognition(JSON.readValue(input, new TypeReference<Map<String, String>>() { }),
                    Clock.fixed(Instant.parse("2026-11-09T07:00:00Z"), ZoneOffset.UTC));
        }
    }
    static Stream<Arguments> cases() throws Exception {
        try (var input = OrderRecognitionTest.class.getResourceAsStream("/recognition-cases.json")) {
            var result = new ArrayList<Arguments>();
            JSON.readTree(input).forEach(c -> result.add(Arguments.of(c.path("id").asText(), c)));
            return result.stream();
        }
    }
    @ParameterizedTest(name = "{0}") @MethodSource("cases")
    void partialFieldsAreCorrectAndDoNotLeakBetweenItems(String id, JsonNode fixture) throws Exception {
        var result = recognition().parse(fixture.path("text").asText());
        assertFields(fixture.path("fields"), result.fields());
        assertEquals(fixture.path("items").size(), result.items().size());
        for (int i = 0; i < result.items().size(); i++) assertFields(fixture.path("items").get(i), result.items().get(i).fields());
        for (var key : fixture.path("review")) assertTrue(result.fields().get(key.asText()).needsReview());
        for (var key : fixture.path("defaults")) {
            var field = result.items().getFirst().fields().get(key.asText());
            assertEquals(RecognitionDraft.Source.DEFAULT, field.source()); assertTrue(field.evidence().isEmpty());
        }
        for (var text : fixture.path("unmapped")) assertTrue(result.unmappedText().contains(text.asText()));
        result.items().forEach(item -> item.fields().values().forEach(field -> {
            if (field.source() == RecognitionDraft.Source.RULE) assertFalse(field.evidence().isEmpty());
        }));
    }
    private static void assertFields(JsonNode expected, Map<String, RecognitionDraft.Field> actual) {
        expected.fields().forEachRemaining(e -> assertEquals(e.getValue().isNull() ? null : e.getValue().asText(),
                actual.get(e.getKey()).value(), e.getKey()));
    }
    @Test void overlongAndBlankInputIsExplicitlyRejected() throws Exception {
        var parser = recognition();
        assertThrows(IllegalArgumentException.class, () -> parser.parse(" "));
        assertThrows(IllegalArgumentException.class, () -> parser.parse("字".repeat(12001)));
    }
    @Test void invalidSizePrecisionRangesSignsAndHeightNeverBecomeUsableSizes() throws Exception {
        for (String value : List.of("尺寸：8.123寸", "尺寸：1234567890寸", "商品：-8寸蛋糕", "商品：负8寸蛋糕", "商品：−8寸蛋糕", "商品：6-8寸蛋糕", "商品：4寸高蛋糕")) {
            var field = recognition().parse(value).items().getFirst().fields().get("size");
            assertNull(field.value(), value); assertTrue(field.needsReview(), value);
        }
        assertEquals("8.25", recognition().parse("尺寸：8.25寸").items().getFirst().fields().get("size").value());
        for (String value : List.of("商品：8寸蛋糕-2个", "商品：8寸蛋糕配餐具10份", "商品：8寸蛋糕12.5个")) {
            var field = recognition().parse(value).items().getFirst().fields().get("quantity");
            assertNull(field.value(), value); assertTrue(field.needsReview(), value);
        }
        assertNull(recognition().parse("商品：十二个蛋糕").items().getFirst().fields().get("quantity").value());
    }
    @Test void timeConflictsAndRangesDoNotChooseOneValue() throws Exception {
        var result = recognition().parse("【蛋糕预定单】\n收货日期：2026-09-30\n交接时间：10:00\n交接时间：11:00\n尺寸：4寸-6寸");
        assertNull(result.fields().get("plannedHandoffAt").value());
        assertTrue(result.fields().get("plannedHandoffAt").needsReview());
        assertNull(result.items().getFirst().fields().get("size").value());
    }
    @Test void templateTimeAndNoticeDoNotPolluteOtherFields() throws Exception {
        var parser = recognition();
        String body = """
                【蛋糕预定单】
                取货时间：11月12号下午１７：００
                尺寸：8寸
                口味（默认原味夹芒果）：芒果，脆啵啵，奥利奥
                电话：13800000012
                地址：合成市验收路1号
                其他要求：要10份蛋糕叉碟
                价格（客服填）：
                会员手机号：
                """.stripTrailing().replace("\n", "\r\n");
        var order = parser.parse(body);
        for (String title : List.of("【订购需知】 ：", "【订购须知】 :")) {
            assertEquals(order, parser.parse(body + "\r\n  " + title + "\r\n总价：58\n尺寸：14寸\n数量：30\n夹馅：草莓"));
        }
        assertEquals("2026-11-12T17:00", order.fields().get("plannedHandoffAt").value());
        assertTrue(order.fields().get("requestedReceiveDate").issues().getFirst().contains("2026年"));
        assertEquals("13800000012", order.fields().get("phone").value());
        assertEquals("合成市验收路1号", order.fields().get("address").value());
        assertNull(order.fields().get("totalAmountCents").value());
        assertNull(order.fields().get("memberPhone").value());
        assertEquals(1, order.items().size());
        var cake = order.items().getFirst().fields();
        assertEquals("8", cake.get("size").value());
        assertEquals("芒果、脆啵啵、奥利奥", cake.get("filling").value());
        assertNull(cake.get("quantity").value());
        assertEquals("要10份蛋糕叉碟", cake.get("requirements").value());
        var embedded = parser.parse("祝福语：印上【订购须知】四字\n电话：13800000012");
        assertEquals("印上【订购须知】四字", embedded.items().getFirst().fields().get("message").value());
        assertEquals("13800000012", embedded.fields().get("phone").value());
    }
    @Test void splitDateAndTimeCombineInEitherOrderAndConflictsStopOnlyTheAffectedField() throws Exception {
        var parser = recognition();
        String date = "收货日期：2026-11-02", time = "收货时间：17:00";
        for (String text : List.of(date + "\n" + time, time + "\n" + date, date + "\n收货时间：11月2日17:00")) {
            assertEquals("2026-11-02T17:00", parser.parse(text).fields().get("requestedReceiveAt").value());
        }
        var fields = parser.parse("收货日期：2026-11-03\n取货时间：11月2号17:00\n电话：13800000012").fields();
        assertNull(fields.get("requestedReceiveDate").value());
        assertNull(fields.get("plannedHandoffAt").value());
        assertTrue(fields.get("plannedHandoffAt").needsReview());
        assertEquals("13800000012", fields.get("phone").value());
    }
    @Test void nearestDateUsesBeijingDayAndOnlyInfersMissingYears() {
        Instant reference = Instant.parse("2026-11-08T16:30:00Z");
        for (ZoneId zone : List.of(ZoneOffset.UTC, ZoneId.of("America/Los_Angeles"))) {
            var parser = new OrderRecognition(Map.of(), Clock.fixed(reference, zone));
            var dates = Map.of("11月9号00:15", "2026-11-09", "11月8日17:00", "2027-11-08",
                    "1月1日17:00", "2027-01-01", "2月29号17:00", "2028-02-29", "2025-11-08 17:00", "2025-11-08",
                    "明天17:00", "2026-11-10", "后天", "2026-11-11");
            dates.forEach((input, expected) -> assertEquals(expected,
                    parser.parse("取货时间：" + input).fields().get("requestedReceiveDate").value(), input));
            assertNull(parser.parse("取货时间：12号17:00").fields().get("requestedReceiveAt").value());
        }
    }
    @ParameterizedTest
    @CsvSource({"下午5点,17:00", "下午五点半,17:30", "下午17:00,17:00", "上午09:00,09:00", "05:00,05:00",
            "中午1点,13:00", "中午1:00,13:00", "中午13:00,13:00", "中午12点,12:00", "中午11:00,11:00", "中午13:59,13:59"})
    void commonTimeForms(String input, String expected) throws Exception {
        var fields = recognition().parse("取货时间：2026年11月12日" + input).fields();
        assertEquals("2026-11-12T" + expected, fields.get("plannedHandoffAt").value());
    }
    @ParameterizedTest
    @ValueSource(strings = {"上午17:00", "中午2点", "中午10:59", "中午14:00", "25:00", "17:60", "5点", "17:00–18:00", "17点左右", "17:00:30", "下午"})
    void badTimeDoesNotDiscardTheKnownDateOrIndependentFields(String input) throws Exception {
        var fields = recognition().parse("取货时间：11月12日" + input + "\n出品时间：2026-11-12 16:00").fields();
        assertEquals("2026-11-12", fields.get("requestedReceiveDate").value());
        assertNull(fields.get("plannedHandoffAt").value());
        assertFalse(fields.get("plannedHandoffAt").issues().isEmpty());
        assertEquals("2026-11-12T16:00", fields.get("plannedFinishAt").value());
    }
    @ParameterizedTest
    @ValueSource(strings = {"2026-11-12", "2026-11-13"})
    void fullReceiveAndPickupTimesAreIndependentAndFinishFollowsPickupDate(String receiveDate) throws Exception {
        var fields = recognition().parse("收货时间：" + receiveDate + " 18:00\n取货时间：2026-11-12 17:00\n出品时间：16:00").fields();
        assertEquals(receiveDate + "T18:00", fields.get("requestedReceiveAt").value());
        assertEquals("2026-11-12", fields.get("requestedReceiveDate").value());
        assertEquals("2026-11-12T17:00", fields.get("plannedHandoffAt").value());
        assertEquals("2026-11-12T16:00", fields.get("plannedFinishAt").value());
        assertFalse(fields.get("plannedHandoffAt").needsReview());
    }
    @Test void conflictingPickupTimesDoNotInvalidateAnIndependentReceiveTime() throws Exception {
        var parser = recognition();
        String receive = "收货时间：2026-11-12 18:00\n";
        var fields = parser.parse(receive + "取货时间：17:00\n交接时间：19:00").fields();
        assertEquals("2026-11-12T18:00", fields.get("requestedReceiveAt").value());
        assertNull(fields.get("plannedHandoffAt").value());
        assertTrue(fields.get("plannedHandoffAt").issues().contains("时刻相互冲突，请核对"));
        var dateConflict = parser.parse(receive + "取货时间：11月13日17:00").fields();
        assertEquals("2026-11-12T18:00", dateConflict.get("requestedReceiveAt").value());
        assertNull(dateConflict.get("plannedHandoffAt").value());
        assertTrue(dateConflict.get("plannedHandoffAt").issues().contains("日期相互冲突，请核对"));
    }
    @Test void splitDatesBelongToTheirOwnLegacyOrPickupTimes() throws Exception {
        var fields = recognition().parse("收货日期：2026-11-13\n收货时间：18:00\n取货日期：2026-11-12\n取货时间：17:00\n出品时间：16:00").fields();
        assertEquals("2026-11-13T18:00", fields.get("requestedReceiveAt").value());
        assertEquals("2026-11-12", fields.get("requestedReceiveDate").value());
        assertEquals("2026-11-12T17:00", fields.get("plannedHandoffAt").value());
        assertEquals("2026-11-12T16:00", fields.get("plannedFinishAt").value());

        var withFullPickup = recognition().parse("收货日期：2026-11-13\n收货时间：2026-11-13 18:00\n取货时间：2026-11-12 17:00").fields();
        assertEquals("2026-11-12T17:00", withFullPickup.get("plannedHandoffAt").value());
    }
    @ParameterizedTest
    @ValueSource(strings = {"取货日期", "取货时间"})
    void explicitPickupDateWithoutClockRetainsItsSourceAndFinishDate(String label) throws Exception {
        var fields = recognition().parse("收货时间：2026-11-13 18:00\n" + label + "：2026-11-12\n出品时间：16:00").fields();
        assertEquals("2026-11-12", fields.get("requestedReceiveDate").value());
        assertEquals("2026-11-13T18:00", fields.get("requestedReceiveAt").value());
        var handoff = fields.get("plannedHandoffAt");
        assertEquals(RecognitionDraft.Source.RULE, handoff.source());
        assertEquals(List.of(label + "：2026-11-12"), handoff.evidence());
        assertNull(handoff.value());
        assertFalse(handoff.needsReview());
        assertEquals("2026-11-12T16:00", fields.get("plannedFinishAt").value());
    }
    @ParameterizedTest
    @ValueSource(strings = {"【蛋糕预订单】", "蛋糕订购单"})
    void concatenatedTemplatesOnlyReturnFirstOrder(String secondTitle) throws Exception {
        var parser = recognition();
        String first = "【蛋糕预定单】\n收货日期：2026-11-12\n电话：13800000012\n尺寸：8寸";
        String second = secondTitle + "\n取货时间：17:00\n电话：13800000013\n尺寸：6寸";
        assertEquals(parser.parse(first), parser.parse(first + "\n" + second));
        assertEquals(parser.parse(first), parser.parse(first + "\n【订购须知】：\n" + second));
    }
    @Test void inlineSecondTitleStopsBeforeItsFields() throws Exception {
        var parser = recognition();
        String first = "【蛋糕预定单】 尺寸：8寸";
        String second = "【蛋糕预订单】 电话：13800000012 取货时间：2026-11-13 17:00 尺寸：6寸";
        assertEquals(parser.parse(first), parser.parse(first + " " + second));
        assertEquals(parser.parse(first), parser.parse(first + second));
        var quoted = parser.parse("【蛋糕预定单】 祝福语：写上【蛋糕预订单】四字 电话：13800000012");
        assertEquals("写上【蛋糕预订单】四字", quoted.items().getFirst().fields().get("message").value());
        assertEquals("13800000012", quoted.fields().get("phone").value());
    }
    @Test void missingTimeDoesNotBecomeMidnightAndDateRangesDoNotChooseAnEndpoint() throws Exception {
        var parser = recognition();
        var fields = parser.parse("取货时间：11月12日").fields();
        assertEquals("2026-11-12", fields.get("requestedReceiveDate").value());
        assertNull(fields.get("plannedHandoffAt").value());
        for (String input : List.of("2月30日17:00", "11月12日–11月13日", "11月12日或11月13日17:00", "11月12日17:00或11月13日18:00")) {
            var invalid = parser.parse("取货时间：" + input).fields();
            assertNull(invalid.get("requestedReceiveDate").value(), input);
            assertNull(invalid.get("plannedHandoffAt").value(), input);
        }
    }
    @Test void malformedTimeAtTheTextLimitIsBoundedAndLeavesOtherFieldsUsable() throws Exception {
        var parser = recognition();
        String prefix = "电话：13800000012\n收货时间：11月12日17:00";
        var fields = assertTimeout(Duration.ofSeconds(2),
                () -> parser.parse(prefix + "，".repeat(11999 - prefix.length()) + "错")).fields();
        assertEquals("13800000012", fields.get("phone").value());
        assertNull(fields.get("requestedReceiveAt").value());
    }
    @Test void excessProductBlocksCannotWriteFieldsIntoThePreviousProduct() throws Exception {
        var text = new StringBuilder();
        for (int i = 1; i <= 21; i++) text.append("商品").append(i).append("：合成蛋糕\n数量：1\n");
        text.append("夹馅：不得串入前一商品\n");
        var result = recognition().parse(text.toString());
        assertEquals(20, result.items().size()); assertFalse(result.issues().isEmpty());
        assertEquals("芒果", result.items().getLast().fields().get("filling").value());
        assertTrue(result.unmappedText().stream().anyMatch(x -> x.contains("不得串入前一商品")));
    }
    @Test void inlineUnbracketedNoticeAndInvalidYearsAreNotOrderFacts() throws Exception {
        var result = recognition().parse("【蛋糕预定单】 电话：13800000001 夹馅：草莓 订购须知：夹馅：奥利奥 总价：58");
        assertEquals("草莓", result.items().getFirst().fields().get("filling").value());
        assertNull(result.fields().get("totalAmountCents").value());
        for (String date : List.of("0000-01-01", "-2026-09-30")) {
            assertNull(recognition().parse("收货日期：" + date).fields().get("requestedReceiveDate").value());
        }
    }
}

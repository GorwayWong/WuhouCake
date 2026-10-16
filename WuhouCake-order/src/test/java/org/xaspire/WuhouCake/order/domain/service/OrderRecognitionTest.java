package org.xaspire.WuhouCake.order.domain.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft;
import static org.junit.jupiter.api.Assertions.*;

class OrderRecognitionTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static OrderRecognition recognition() throws Exception {
        try (var input = OrderRecognition.class.getResourceAsStream("/order/cake-defaults.json")) {
            return new OrderRecognition(JSON.readValue(input, new TypeReference<Map<String, String>>() { }));
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
    @Test void timeConflictsAndRangesDoNotChooseOneValue() throws Exception {
        var result = recognition().parse("【蛋糕预定单】\n收货日期：2026-09-30\n交接时间：10:00\n交接时间：11:00\n尺寸：4寸-6寸");
        assertNull(result.fields().get("plannedHandoffAt").value());
        assertTrue(result.fields().get("plannedHandoffAt").needsReview());
        assertNull(result.items().getFirst().fields().get("size").value());
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

package org.xaspire.WuhouCake.order.application.service;

import java.util.*;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.port.RecognitionAssistant;
import org.xaspire.WuhouCake.order.domain.port.RecognitionAssistant.*;
import org.xaspire.WuhouCake.order.domain.service.OrderRecognition;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderRecognitionServiceTest {
    private final RecognitionAssistant assistant = mock(RecognitionAssistant.class);
    private final OrderRecognitionService service = new OrderRecognitionService(new OrderRecognition(Map.of("base", "原味", "filling", "芒果")), assistant);
    private static final String TEXT = "【蛋糕预定单】\n客户姓名：合成客户\n电话：13800000001\n地址：合成市验收路1号\n奶油用动物的";
    @Test void rulesReturnImmediatelyAndAssistSendsNoParsedPersonalData() {
        when(assistant.available()).thenReturn(true);
        when(assistant.suggest(anyList())).thenReturn(new Result("OK", List.of(new Suggestion("item-1", "flavor", "动物奶油", "奶油用动物的")), List.of()));
        var rules = service.parse(TEXT); assertEquals("13800000001", rules.fields().get("phone").value()); verify(assistant, never()).suggest(anyList());
        var result = service.assist(TEXT, true); assertEquals(1, result.suggestions().size()); assertTrue(result.suggestions().getFirst().candidate().needsReview());
        verify(assistant).suggest(List.of(new org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft.Fragment("item-1", "奶油用动物的")));
        assertEquals(rules.fields(), service.parse(TEXT).fields());
    }
    @Test void unavailableOrMalformedModelNeverDiscardsValidRuleFields() {
        when(assistant.suggest(anyList())).thenReturn(new Result("INVALID_RESPONSE", List.of(), List.of("模型JSON无效")));
        var before = service.parse(TEXT); assertEquals("INVALID_RESPONSE", service.assist(TEXT, true).status());
        assertEquals(before.fields(), service.parse(TEXT).fields()); assertEquals(before.items(), service.parse(TEXT).items());
    }
    @Test void explicitRulesOwnershipAndEvidenceWinOverModelSuggestions() {
        when(assistant.suggest(anyList())).thenReturn(new Result("OK", List.of(
                new Suggestion("item-1", "flavor", "动物奶油", "奶油用动物的"),
                new Suggestion("other", "base", "原味", "奶油用动物的"),
                new Suggestion("item-1", "filling", "草莓", "客户未说过草莓")), List.of()));
        var response = service.assist(TEXT + "\n奶油：淡奶油", true);
        assertTrue(response.suggestions().isEmpty()); assertEquals(3, response.issues().size());
        assertEquals("淡奶油", service.parse(TEXT + "\n奶油：淡奶油").items().getFirst().fields().get("flavor").value());
    }
    @Test void noConsentOrNoEligibleFragmentNeverCallsProvider() {
        assertEquals("CONSENT_REQUIRED", service.assist(TEXT, false).status());
        assertEquals("NOT_NEEDED", service.assist("【蛋糕预定单】\n电话：13800000001\n奶油：淡奶油", true).status());
        assertEquals("NOT_NEEDED", service.assist("【蛋糕预定单】\n奶油用动物的，地址在验收路3号", true).status());
        verify(assistant, never()).suggest(anyList());
    }
    @Test void contradictoryModelSuggestionsAreNotResolvedByTheirArrivalOrder() {
        String text = "【蛋糕预定单】\n奶油用动物的或植物的";
        when(assistant.suggest(anyList())).thenReturn(new Result("OK", List.of(
                new Suggestion("item-1", "flavor", "动物奶油", "奶油用动物的或植物的"),
                new Suggestion("item-1", "flavor", "植物奶油", "奶油用动物的或植物的")), List.of()));
        var result = service.assist(text, true);
        assertTrue(result.suggestions().isEmpty()); assertEquals(1, result.issues().size());
    }
    @Test void categoryOnlySuggestionsAreRejectedWithoutLosingSpecificCandidates() {
        String text = "【蛋糕预定单】\n奶油用动物的\n想要巧克力内胚\n夹馅想要草莓";
        when(assistant.suggest(anyList())).thenReturn(new Result("OK", List.of(
                new Suggestion("item-1", "flavor", "奶油", "奶油"),
                new Suggestion("item-1", "base", "内胚", "内胚"),
                new Suggestion("item-1", "filling", "夹馅", "夹馅")), List.of()));
        var generic = service.assist(text, true);
        assertTrue(generic.suggestions().isEmpty()); assertEquals(3, generic.issues().size());
        when(assistant.suggest(anyList())).thenReturn(new Result("OK", List.of(
                new Suggestion("item-1", "flavor", "动物奶油", "奶油用动物的"),
                new Suggestion("item-1", "base", "巧克力", "想要巧克力内胚"),
                new Suggestion("item-1", "filling", "草莓", "夹馅想要草莓")), List.of()));
        var specific = service.assist(text, true);
        assertEquals(3, specific.suggestions().size());
        assertTrue(specific.suggestions().stream().allMatch(s -> s.candidate().needsReview()));
    }
}

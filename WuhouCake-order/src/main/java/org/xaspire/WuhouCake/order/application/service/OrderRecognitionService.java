package org.xaspire.WuhouCake.order.application.service;

import java.util.*;
import org.xaspire.WuhouCake.order.api.dto.RecognitionViews;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft;
import org.xaspire.WuhouCake.order.domain.service.OrderRecognition;
import org.xaspire.WuhouCake.order.domain.port.RecognitionAssistant;

public class OrderRecognitionService {
    private final OrderRecognition recognition;
    private final RecognitionAssistant assistant;
    public OrderRecognitionService(OrderRecognition recognition, RecognitionAssistant assistant) { this.recognition = recognition; this.assistant = assistant; }
    public RecognitionViews.Draft parse(String text) { return view(recognition.parse(text)); }
    public RecognitionViews.Assist assist(String text, boolean consent) {
        var draft = recognition.parse(text); var fragments = recognition.assistFragments(draft);
        if (!consent) return new RecognitionViews.Assist("CONSENT_REQUIRED", List.of(), List.of("需要先确认允许发送预览片段"));
        if (fragments.isEmpty()) return new RecognitionViews.Assist("NOT_NEEDED", List.of(), List.of("没有适合模型补充的片段，未调用模型"));
        var response = assistant.suggest(fragments); var accepted = new ArrayList<RecognitionViews.Suggestion>();
        var conflicted = new HashSet<String>();
        var issues = new ArrayList<>(response.issues());
        for (var suggestion : response.suggestions()) {
            var item = draft.items().stream().filter(x -> x.id().equals(suggestion.itemId())).findFirst().orElse(null);
            if (item == null || !Set.of("name", "flavor", "base", "filling", "requirements", "message").contains(suggestion.field())) {
                issues.add("模型建议归属无效，已忽略"); continue;
            }
            if (!specificValue(suggestion.field(), suggestion.value())) {
                issues.add("模型建议只有类名或未提供具体内容，已转人工"); continue;
            }
            var before = item.fields().get(suggestion.field());
            if (before.source() == RecognitionDraft.Source.RULE && before.value() != null) {
                if (!before.value().equals(suggestion.value())) issues.add("模型与规则候选冲突，保留规则值");
                continue;
            }
            String value = suggestion.value(), quote = suggestion.evidence();
            boolean owned = fragments.stream().anyMatch(f -> f.itemId().equals(suggestion.itemId()) && f.text().contains(quote));
            boolean supported = !quote.isBlank() && Arrays.stream(value.split("[，,、\\s]+")).allMatch(part -> quote.contains(part)
                    || suggestion.field().equals("flavor") && part.endsWith("奶油") && quote.contains("奶油") && quote.contains(part.substring(0, part.length() - 2)));
            if (!owned || !supported || value.isBlank() || value.length() > (suggestion.field().equals("name") ? 128 : 2000)
                    || quote.matches(".*(?:不要|不加|去掉|不确定|看着办|待定).*")) {
                issues.add("模型建议缺少可靠的本商品原文依据，已转人工"); continue;
            }
            String target = item.id() + "." + suggestion.field();
            if (conflicted.contains(target)) continue;
            var existing = accepted.stream().filter(x -> x.itemId().equals(item.id()) && x.field().equals(suggestion.field())).findFirst().orElse(null);
            if (existing != null) {
                if (!existing.candidate().value().equals(value)) {
                    accepted.remove(existing); conflicted.add(target); issues.add("同一字段的AI建议互相冲突，已转人工");
                }
                continue;
            }
            accepted.add(new RecognitionViews.Suggestion(item.id(), suggestion.field(),
                    new RecognitionViews.Field(value, "MODEL", List.of(quote), true, List.of("AI语义建议，请人工确认"))));
        }
        return new RecognitionViews.Assist(response.status(), accepted, issues);
    }
    private static boolean specificValue(String field, String value) {
        String compact = value.replaceAll("\\s+", "");
        if (Set.of("未知", "未提供", "不确定", "待定", "无", "null").contains(compact)) return false;
        Set<String> generic = switch (field) {
            case "name" -> Set.of("商品", "商品名称", "蛋糕名称");
            case "flavor" -> Set.of("奶油", "奶油类型", "口味");
            case "base" -> Set.of("内胚", "蛋糕胚", "胚");
            case "filling" -> Set.of("夹馅", "夹层", "馅料");
            case "requirements" -> Set.of("其他要求", "要求", "备注");
            case "message" -> Set.of("祝福语", "写字");
            default -> Set.<String>of();
        };
        return !generic.contains(compact);
    }
    private RecognitionViews.Draft view(RecognitionDraft draft) {
        return new RecognitionViews.Draft(fields(draft.fields()), draft.items().stream()
                .map(item -> new RecognitionViews.Item(item.id(), fields(item.fields()))).toList(), draft.issues(),
                recognition.assistFragments(draft).stream().map(f -> new RecognitionViews.Fragment(f.itemId(), f.text())).toList(), draft.unmappedText(),
                assistant.available() && !recognition.assistFragments(draft).isEmpty());
    }
    private Map<String, RecognitionViews.Field> fields(Map<String, RecognitionDraft.Field> values) {
        var result = new LinkedHashMap<String, RecognitionViews.Field>();
        values.forEach((key, value) -> result.put(key, new RecognitionViews.Field(value.value(),
                value.source() == null ? null : value.source().name(), value.evidence(), value.needsReview(), value.issues())));
        return result;
    }
}

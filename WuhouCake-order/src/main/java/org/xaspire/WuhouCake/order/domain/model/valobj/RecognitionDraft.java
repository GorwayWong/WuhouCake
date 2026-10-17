package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.util.*;

/** Non-persistent, partial suggestions; values never authorize order writes. */
public record RecognitionDraft(Map<String, Field> fields, List<Item> items, List<String> issues,
        List<Fragment> fragments, List<String> unmappedText) {
    public enum Source { RULE, MODEL, DEFAULT }
    /** Values use form text, except monetary fields which contain integer cents as text. */
    public record Field(String value, Source source, List<String> evidence, boolean needsReview, List<String> issues) {
        public Field { evidence = List.copyOf(evidence); issues = List.copyOf(issues); }
        public static Field missing() { return new Field(null, null, List.of(), false, List.of()); }
    }
    public record Item(String id, Map<String, Field> fields) {
        public Item { fields = Collections.unmodifiableMap(new LinkedHashMap<>(fields)); }
    }
    public record Fragment(String itemId, String text) { }
    public RecognitionDraft {
        fields = Collections.unmodifiableMap(new LinkedHashMap<>(fields));
        items = List.copyOf(items); issues = List.copyOf(issues);
        fragments = List.copyOf(fragments); unmappedText = List.copyOf(unmappedText);
    }
}

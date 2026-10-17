package org.xaspire.WuhouCake.order.api.dto;

import java.util.*;

public final class RecognitionViews {
    private RecognitionViews() { }
    public record Field(String value, String source, List<String> evidence, boolean needsReview, List<String> issues) { }
    public record Item(String id, Map<String, Field> fields) { }
    public record Fragment(String itemId, String text) { }
    public record Suggestion(String itemId, String field, Field candidate) { }
    public record Assist(String status, List<Suggestion> suggestions, List<String> issues) { }
    public record Draft(Map<String, Field> fields, List<Item> items, List<String> issues, List<Fragment> fragments,
            List<String> unmappedText, boolean assistAvailable) { }
}

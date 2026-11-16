package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class ProductCategories {
    public static final Set<String> TYPES = Set.of("CAKE", "OTHER");
    private static final Map<String, String> LABELS = Map.of("CAKE", "蛋糕", "OTHER", "其他");

    private ProductCategories() { }
    public static String normalize(String value) {
        if (value == null) return null;
        return switch (value.strip().toUpperCase(Locale.ROOT)) {
            case "DONUT", "CUPCAKE", "BREAD", "TEA_BREAK", "COOKIE", "SNACK", "DRINK", "READY_BAKERY" -> "OTHER";
            default -> value.strip().toUpperCase(Locale.ROOT);
        };
    }
    public static String requireKnown(String value) {
        var type = normalize(value);
        if (type == null || !TYPES.contains(type)) throw OrderValues.invalid();
        return type;
    }
    public static String label(String value) {
        return value == null ? "未分类" : LABELS.getOrDefault(normalize(value), value);
    }
}

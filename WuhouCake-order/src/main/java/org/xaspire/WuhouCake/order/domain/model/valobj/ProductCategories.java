package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class ProductCategories {
    private ProductCategories() { }
    public static final Set<String> TYPES = Set.of("CAKE", "TEA_BREAK", "COOKIE", "SNACK", "DRINK", "READY_BAKERY");
    private static final Map<String, String> LABELS = Map.of("CAKE", "蛋糕", "TEA_BREAK", "茶歇", "COOKIE", "饼干",
            "SNACK", "小吃", "DRINK", "饮品", "READY_BAKERY", "现货面包甜点");

    public static String normalize(String value) {
        if (value == null) return null;
        return switch (value.strip().toUpperCase(Locale.ROOT)) {
            case "DONUT", "CUPCAKE", "OTHER" -> "TEA_BREAK";
            case "BREAD" -> "READY_BAKERY";
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

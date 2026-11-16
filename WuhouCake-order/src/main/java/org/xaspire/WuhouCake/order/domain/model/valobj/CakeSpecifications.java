package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.math.BigDecimal;
import java.util.*;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public final class CakeSpecifications {
    public static final Map<String, String> DEFAULTS = Map.of("base", "原味", "filling", "芒果", "flavor", "原味奶油");
    private CakeSpecifications() { }
    public static Map<String, Object> other(Map<String, Object> attributes) {
        var lines = new LinkedHashSet<String>();
        var labels = Map.of("size", "尺寸", "base", "内胚", "cakeBase", "内胚", "flavor", "奶油",
                "filling", "夹馅", "message", "祝福语", "greeting", "祝福语", "requirements", "特殊要求", "otherRequirements", "特殊要求");
        var values = JsonSnapshot.object(attributes);
        String requirements = values.get("requirements") instanceof String text ? text.strip() : null;
        Object specification = values.get("specification");
        if (specification != null && !specification.toString().isBlank()) lines.add(specification.toString().strip());
        new TreeMap<>(values).forEach((key, value) -> {
            if (!key.equals("specification") && !(key.equals("requirements") && requirements != null) && value != null && !value.toString().isBlank())
                lines.add(labels.getOrDefault(key, key) + "：" + value.toString().strip());
        });
        var result = new LinkedHashMap<String, Object>();
        if (!lines.isEmpty()) result.put("specification", String.join("\n", lines));
        if (requirements != null && !requirements.isBlank()) result.put("requirements", requirements);
        return JsonSnapshot.object(result);
    }
    public static String historicalSpecification(String specification, Long unitPriceCents, Long memberPriceCents) {
        var lines = new ArrayList<String>();
        if (specification != null && !specification.isBlank()) lines.add(specification);
        if (unitPriceCents != null) lines.add("原商品单价：" + BigDecimal.valueOf(unitPriceCents, 2).toPlainString() + " 元（仅供参考）");
        if (memberPriceCents != null) lines.add("原会员单价：" + BigDecimal.valueOf(memberPriceCents, 2).toPlainString() + " 元（仅供参考）");
        return String.join("\n", lines);
    }
    public static Map<String, Object> effective(String type, Map<String, Object> attributes) {
        if ("OTHER".equals(ProductCategories.normalize(type))) return other(attributes);
        var values = new LinkedHashMap<>(JsonSnapshot.object(attributes));
        if (type != null && "CAKE".equalsIgnoreCase(type.strip())) DEFAULTS.forEach((key, value) -> {
            if (values.get(key) == null || values.get(key) instanceof String text && text.isBlank()) values.put(key, value);
        });
        return JsonSnapshot.object(values);
    }
    public static String size(Object value) {
        if (value == null || value instanceof String text && text.isBlank()) return null;
        if (!(value instanceof String) && !(value instanceof Number)) throw invalid();
        String text = value.toString().strip();
        if (!text.matches("[0-9]{1,9}(?:\\.[0-9]{1,2})?")) throw invalid();
        var number = new BigDecimal(text);
        if (number.signum() <= 0) throw invalid();
        return number.stripTrailingZeros().toPlainString();
    }
    public static Map<String, Object> forWrite(String type, Map<String, Object> attributes) {
        var values = new LinkedHashMap<>(effective(type, attributes));
        if (type != null && "CAKE".equalsIgnoreCase(type.strip())) {
            String size = size(values.get("size"));
            if (size == null) values.remove("size"); else values.put("size", size);
        }
        return JsonSnapshot.object(values);
    }
}

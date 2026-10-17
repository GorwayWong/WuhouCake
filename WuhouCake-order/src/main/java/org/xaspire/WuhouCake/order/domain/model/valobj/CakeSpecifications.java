package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.math.BigDecimal;
import java.util.*;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public final class CakeSpecifications {
    public static final Map<String, String> DEFAULTS = Map.of("base", "原味", "filling", "芒果");
    private CakeSpecifications() { }
    public static Map<String, Object> effective(String type, Map<String, Object> attributes) {
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

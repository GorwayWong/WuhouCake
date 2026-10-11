package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.math.BigDecimal;
import java.util.*;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public final class JsonSnapshot {
    private JsonSnapshot() { }

    public static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?> source)) throw invalid();
        var copy = new LinkedHashMap<String, Object>();
        source.forEach((key, item) -> {
            if (!(key instanceof String name)) throw invalid();
            copy.put(name, freeze(item));
        });
        return Collections.unmodifiableMap(copy);
    }
    private static Object freeze(Object value) {
        if (value == null || value instanceof String || value instanceof Boolean) return value;
        if (value instanceof Map<?, ?>) return object(value);
        if (value instanceof List<?> source) {
            var copy = new ArrayList<Object>();
            source.forEach(item -> copy.add(freeze(item)));
            return Collections.unmodifiableList(copy);
        }
        if (value instanceof Number number) {
            try { return new BigDecimal(number.toString()).stripTrailingZeros(); }
            catch (NumberFormatException failure) { throw invalid(); }
        }
        throw invalid();
    }
}

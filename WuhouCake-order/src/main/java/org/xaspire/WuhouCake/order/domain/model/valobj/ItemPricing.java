package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.util.List;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

/** Integer-cent totals; a missing quote never produces a partial order total. */
public final class ItemPricing {
    private ItemPricing() { }
    public record Quote(int quantity, Long original, Long member) { }
    public record Totals(Long original, Long member, Long total) { }
    public static Totals calculate(List<Quote> items) {
        if (items == null || items.isEmpty()) throw invalid();
        long original = 0, effective = 0;
        boolean missingOriginal = false, missingEffective = false, hasMember = false;
        try {
            for (var item : items) {
                int count = quantity(item.quantity());
                Long regular = money(item.original()), member = money(item.member());
                Long chosen = member != null ? member : regular;
                hasMember |= member != null;
                if (regular == null) missingOriginal = true;
                else original = money(Math.addExact(original, Math.multiplyExact(regular, count)));
                if (chosen == null) missingEffective = true;
                else effective = money(Math.addExact(effective, Math.multiplyExact(chosen, count)));
            }
        } catch (ArithmeticException failure) { throw invalid(); }
        return new Totals(missingOriginal ? null : original,
                hasMember && !missingEffective ? effective : null, missingEffective ? null : effective);
    }
    public static String mode(String value) {
        if (value == null) return "MANUAL";
        if (!value.equals("MANUAL") && !value.equals("ITEM_SUM")) throw invalid();
        return value;
    }
}

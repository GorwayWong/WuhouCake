package org.xaspire.WuhouCake.order.application.service;

import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.xaspire.WuhouCake.order.api.command.SubmissionCommands;
import org.xaspire.WuhouCake.order.domain.model.aggregate.CustomerSubmission;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.optionalText;

/** Reconstructs the anonymous submit fingerprint input used at migration V26 (dfe432a). */
final class LegacySubmissionFingerprint {
    private static final Map<String, String> CAKE_DEFAULTS = Map.of("base", "原味", "filling", "芒果", "flavor", "原味奶油");

    private LegacySubmissionFingerprint() { }

    static Optional<SubmissionCommands.Content> v26(SubmissionCommands.Content raw, CustomerSubmission.Content validated) {
        var items = new ArrayList<SubmissionCommands.Product>();
        for (int i = 0; i < raw.items().size(); i++) {
            var input = raw.items().get(i);
            String type = switch (input.productType().strip().toUpperCase(Locale.ROOT)) {
                case "CUPCAKE", "DONUT", "OTHER" -> "TEA_BREAK";
                case "BREAD" -> "READY_BAKERY";
                case "CAKE", "TEA_BREAK", "COOKIE", "SNACK", "DRINK", "READY_BAKERY" ->
                        input.productType().strip().toUpperCase(Locale.ROOT);
                default -> null;
            };
            if (type == null) return Optional.empty();
            var attributes = new TreeMap<String, String>();
            try {
                if (input.attributes() != null) input.attributes().forEach((key, value) -> {
                    String text = optionalText(value, 2000);
                    if (text != null) attributes.put(key, text);
                });
                if ("CAKE".equals(type)) {
                    attributes.put("size", CakeSpecifications.size(attributes.get("size")));
                    CAKE_DEFAULTS.forEach(attributes::putIfAbsent);
                }
            } catch (OrderFailure outsideV26Contract) {
                return Optional.empty();
            }
            var item = validated.items().get(i);
            items.add(new SubmissionCommands.Product(item.name(), type, item.quantity(), attributes));
        }
        return Optional.of(new SubmissionCommands.Content(validated.phone(), validated.memberPhone(),
                validated.fulfillmentType(), validated.address(), validated.requestedReceiveAt(), items));
    }
}

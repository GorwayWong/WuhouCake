package org.xaspire.WuhouCake.order.domain.model.entity;

import java.time.Instant;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.JsonSnapshot;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;

import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

public record OrderItem(UUID itemId, String name, String productType, int quantity,
        Long unitPriceCents, Long memberPriceCents, Map<String, Object> attributes,
        String productionStatus, String currentStageCode, boolean removed, Instant createdAt, Instant updatedAt) {
    private static final Set<String> FIELDS = Set.of("name", "productType", "quantity", "unitPriceCents", "memberPriceCents", "attributes");

    public OrderItem {
        Objects.requireNonNull(itemId);
        name = requiredText(name, 128);
        productType = requiredText(productType, 32).toUpperCase(Locale.ROOT);
        quantity = OrderValues.quantity(quantity);
        unitPriceCents = money(unitPriceCents);
        memberPriceCents = money(memberPriceCents);
        attributes = CakeSpecifications.effective(productType, attributes);
    }
    public static OrderItem create(UUID id, String name, String type, Number quantity, Number price, Number memberPrice,
            Map<String, Object> attributes, Instant now) {
        return new OrderItem(id, name, type == null ? "CAKE" : type, OrderValues.quantity(quantity), money(price), money(memberPrice),
                CakeSpecifications.forWrite(type == null ? "CAKE" : type, attributes == null ? Map.of() : attributes), "NOT_STARTED", null, false, now, now);
    }
    public OrderItem revise(Map<String, Object> changes, Instant now) {
        if (changes == null || changes.isEmpty() || changes.keySet().stream().anyMatch(key -> key == null || !FIELDS.contains(key))) throw invalid();
        var merged = new LinkedHashMap<>(attributes);
        if (changes.containsKey("attributes")) {
            JsonSnapshot.object(changes.get("attributes")).forEach((key, value) -> {
                if (value == null) merged.remove(key); else merged.put(key, value);
            });
        }
        String type = changes.containsKey("productType") ? requiredText(changes.get("productType"), 32) : productType;
        boolean sizeChanged = changes.containsKey("attributes") && JsonSnapshot.object(changes.get("attributes")).containsKey("size");
        return new OrderItem(itemId,
                changes.containsKey("name") ? requiredText(changes.get("name"), 128) : name,
                changes.containsKey("productType") ? requiredText(changes.get("productType"), 32) : productType,
                changes.containsKey("quantity") ? OrderValues.quantity(changes.get("quantity")) : quantity,
                changes.containsKey("unitPriceCents") ? money(changes.get("unitPriceCents")) : unitPriceCents,
                changes.containsKey("memberPriceCents") ? money(changes.get("memberPriceCents")) : memberPriceCents,
                sizeChanged || !type.equalsIgnoreCase(productType) ? CakeSpecifications.forWrite(type, merged) : CakeSpecifications.effective(type, merged),
                productionStatus, currentStageCode, removed, createdAt, now);
    }
    public Map<String, Object> businessValues() {
        var values = new LinkedHashMap<String, Object>();
        values.put("name", name); values.put("productType", productType); values.put("quantity", quantity);
        values.put("unitPriceCents", unitPriceCents); values.put("memberPriceCents", memberPriceCents); values.put("attributes", attributes);
        return JsonSnapshot.object(values);
    }
    public OrderItem changeProductionStatus(String status, Instant now) {
        if (status == null || !Set.of("IN_PROGRESS", "COMPLETED").contains(status)) throw invalid();
        if (status.equals(productionStatus)) return this;
        return new OrderItem(itemId, name, productType, quantity, unitPriceCents, memberPriceCents, attributes,
                status, currentStageCode, removed, createdAt, now);
    }
    public OrderItem remove(Instant now) {
        return new OrderItem(itemId, name, productType, quantity, unitPriceCents, memberPriceCents, attributes,
                productionStatus, currentStageCode, true, createdAt, now);
    }
}

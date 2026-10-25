package org.xaspire.WuhouCake.order.domain.model.aggregate;

import java.time.*;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.ProductCategories;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;

/** Customer requirements are immutable; reviewed requirements remain separate until acceptance. */
public record CustomerSubmission(UUID id, UUID entryId, UUID ownerId, String ownerName, long version, String status,
        Content original, Review reviewed, UUID orderId, Instant createdAt, Instant updatedAt) {
    public static final Set<String> ATTRIBUTES = Set.of("size", "base", "filling", "flavor", "message", "requirements", "specification");
    public static final Set<String> PRODUCT_TYPES = ProductCategories.TYPES;
    public record Product(String name, String productType, int quantity, Map<String, String> attributes) {
        public Product {
            name = requiredText(name, 128);
            if (productType == null || !PRODUCT_TYPES.contains(ProductCategories.normalize(productType))) throw new OrderFailure("SUBMISSION_PRODUCT_TYPE_INVALID");
            if (quantity < 1) throw new OrderFailure("SUBMISSION_QUANTITY_INVALID");
            var values = new TreeMap<String, String>();
            if (attributes != null) attributes.forEach((key, value) -> {
                if (!ATTRIBUTES.contains(key)) throw invalid();
                String text = optionalText(value, 2000); if (text != null) values.put(key, text);
            });
            if ("CAKE".equals(productType)) {
                String size = CakeSpecifications.size(values.get("size"));
                if (size == null) throw new OrderFailure("SUBMISSION_CAKE_SIZE_REQUIRED");
                values.put("size", size); values.putIfAbsent("base", "原味"); values.putIfAbsent("filling", "芒果");
            }
            attributes = Collections.unmodifiableMap(values);
        }
    }
    public record Content(String phone, String memberPhone, String fulfillmentType, String address,
            Instant requestedReceiveAt, List<Product> items) {
        public Content {
            phone = phone(requiredText(phone, 32)); memberPhone = phone(optionalText(memberPhone, 32));
            if (!Set.of("DELIVERY", "PICKUP").contains(fulfillmentType == null ? "" : fulfillmentType) || requestedReceiveAt == null) throw invalid();
            address = "DELIVERY".equals(fulfillmentType) ? requiredText(address, 2000) : optionalText(address, 2000);
            if (items == null || items.isEmpty() || items.size() > 30 || items.stream().anyMatch(Objects::isNull)) throw invalid();
            items = List.copyOf(items);
        }
        public LocalDate requestedDate() { return requestedReceiveAt.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate(); }
        private static String phone(String value) {
            if (value == null) return null;
            if (!value.matches("\\+?[0-9 ()-]+")) throw invalid();
            String normalized = value.replaceAll("[ ()-]", "");
            if (!normalized.matches("\\+?[0-9]{6,15}")) throw invalid();
            return normalized;
        }
    }
    public record Price(Long unitPriceCents, Long memberPriceCents) {
        public Price { money(unitPriceCents); money(memberPriceCents); }
    }
    public record Review(Content content, List<Price> prices, Long totalAmountCents, UUID creditedEmployeeId, Instant plannedHandoffAt, Instant plannedFinishAt) {
        public Review(Content content, List<Price> prices, Long totalAmountCents, UUID creditedEmployeeId, Instant plannedHandoffAt) {
            this(content, prices, totalAmountCents, creditedEmployeeId, plannedHandoffAt, null);
        }
        public Review {
            Objects.requireNonNull(content); money(totalAmountCents);
            content = new Content(content.phone(), content.memberPhone(), content.fulfillmentType(), content.address(), content.requestedReceiveAt(),
                    content.items().stream().map(item -> new Product(item.name(), ProductCategories.normalize(item.productType()), item.quantity(), item.attributes())).toList());
            if (prices == null) prices = Collections.nCopies(content.items().size(), new Price(null, null));
            if (prices.size() != content.items().size() || prices.stream().anyMatch(Objects::isNull)) throw new OrderFailure("SUBMISSION_PRICES_INVALID");
            prices = List.copyOf(prices);
        }
        public void requireConfirmation() {
            if (totalAmountCents == null) throw new OrderFailure("SUBMISSION_TOTAL_REQUIRED");
            if (creditedEmployeeId == null) throw new OrderFailure("SUBMISSION_EMPLOYEE_REQUIRED");
        }
    }
    public void requirePending(long expected) {
        if (version != expected) throw new OrderFailure("CONCURRENT_MODIFICATION");
        if (!"PENDING".equals(status)) throw new OrderFailure("SUBMISSION_NOT_PENDING");
    }
    /** Field snapshots also form the basis for future, authenticated customer change logs. */
    public static Map<String, Object> customerFields(Content content) {
        var fields = new LinkedHashMap<String, Object>();
        fields.put("phone", content.phone()); fields.put("memberPhone", content.memberPhone());
        fields.put("fulfillmentType", content.fulfillmentType()); fields.put("address", content.address());
        fields.put("requestedReceiveAt", content.requestedReceiveAt().toString());
        fields.put("items", content.items().stream().map(item -> Map.of("name", item.name(), "productType", item.productType(),
                "quantity", item.quantity(), "attributes", item.attributes())).toList());
        return Collections.unmodifiableMap(fields);
    }
    public static Map<String, Object> differences(Content before, Content after) {
        var changes = new LinkedHashMap<String, Object>();
        var old = customerFields(before); var next = customerFields(after);
        old.forEach((key, value) -> {
            if (!Objects.equals(value, next.get(key))) {
                var change = new LinkedHashMap<String, Object>(); change.put("before", value); change.put("after", next.get(key)); changes.put(key, change);
            }
        });
        return Collections.unmodifiableMap(changes);
    }
}

package org.xaspire.WuhouCake.order.api.command;

import java.time.Instant;
import java.util.*;

public final class SubmissionCommands {
    private SubmissionCommands() { }
    public record Product(String name, String productType, int quantity, Map<String, String> attributes) { }
    public record Content(String phone, String memberPhone, String fulfillmentType, String address, Instant requestedReceiveAt, List<Product> items) { }
    public record Price(Number unitPriceCents, Number memberPriceCents) { }
    public record Review(Content content, List<Price> prices, Number totalAmountCents, UUID creditedEmployeeId, Instant plannedHandoffAt, Instant plannedFinishAt) {
        public Review(Content content, List<Price> prices, Number totalAmountCents, UUID creditedEmployeeId, Instant plannedHandoffAt) {
            this(content, prices, totalAmountCents, creditedEmployeeId, plannedHandoffAt, null);
        }
    }
    public record Save(Number expectedVersion, Review review) { }
    public record Confirm(Number expectedVersion, String duplicateCheckToken, UUID acknowledgedNewerSubmissionId) { }
    public record Delete(Number expectedVersion) { }
    public record EntryChange(String action) { }
}

package org.xaspire.WuhouCake.order.api.command;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;

public final class OrderCommands {
    private OrderCommands() { }

    public record Customer(String customerName, @NotBlank String phone, String memberPhone, String buyerName) { }
    public record Fulfillment(@NotNull String type, String address, @NotNull LocalDate requestedReceiveDate,
            Instant plannedHandoffAt, Instant plannedFinishAt, Instant requestedReceiveAt) {
        public Fulfillment(String type, String address, LocalDate requestedReceiveDate, Instant plannedHandoffAt, Instant plannedFinishAt) {
            this(type, address, requestedReceiveDate, plannedHandoffAt, plannedFinishAt, null);
        }
    }
    public record Item(@NotBlank String name, String productType, @NotNull Number quantity,
            Number unitPriceCents, Number memberPriceCents, Map<String, Object> attributes,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) UUID itemId,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) Number referenceUnitPriceCents,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) Number referenceMemberPriceCents) {
        public Item(String name, String productType, Number quantity, Number unitPriceCents, Number memberPriceCents, Map<String, Object> attributes, UUID itemId) {
            this(name, productType, quantity, unitPriceCents, memberPriceCents, attributes, itemId, null, null);
        }
        public Item(String name, String productType, Number quantity, Number unitPriceCents, Number memberPriceCents, Map<String, Object> attributes) {
            this(name, productType, quantity, unitPriceCents, memberPriceCents, attributes, null);
        }
    }
    public record Create(@NotNull @Valid Customer customer, @NotNull @Valid Fulfillment fulfillment,
            @NotEmpty List<@NotNull @Valid Item> items, Number totalAmountCents, UUID creditedEmployeeId,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) String orderingMethod,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) Number originalAmountCents,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) Number memberAmountCents,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) String paymentMethod,
            @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) String pricingMode) {
        public Create(Customer customer, Fulfillment fulfillment, List<Item> items, Number totalAmountCents, UUID creditedEmployeeId, String orderingMethod, Number originalAmountCents, Number memberAmountCents, String paymentMethod) {
            this(customer, fulfillment, items, totalAmountCents, creditedEmployeeId, orderingMethod, originalAmountCents, memberAmountCents, paymentMethod, null);
        }
        public Create(Customer customer, Fulfillment fulfillment, List<Item> items, Number totalAmountCents, UUID creditedEmployeeId, String orderingMethod) {
            this(customer, fulfillment, items, totalAmountCents, creditedEmployeeId, orderingMethod, null, null, null);
        }
        public Create(Customer customer, Fulfillment fulfillment, List<Item> items, Number totalAmountCents, UUID creditedEmployeeId) {
            this(customer, fulfillment, items, totalAmountCents, creditedEmployeeId, null);
        }
        public Create(Customer customer, Fulfillment fulfillment, List<Item> items, Number totalAmountCents) {
            this(customer, fulfillment, items, totalAmountCents, null);
        }
    }
    public record Revise(@NotNull Number expectedVersion, @NotNull UUID itemId, @NotEmpty Map<String, Object> changes) { }
    public record Information(@NotNull Number expectedVersion, @NotEmpty Map<String, Object> changes) { }
    public record AddItem(@NotNull Number expectedVersion, @NotNull @Valid Item item) { }
    public record RemoveItem(@NotNull Number expectedVersion) { }
    public record PaymentStatus(@NotNull Number expectedVersion, @NotBlank String paymentStatus, String paymentMethod) {
        public PaymentStatus(Number expectedVersion, String paymentStatus) { this(expectedVersion, paymentStatus, null); }
    }
    public record ProductionAction(@NotNull Number expectedVersion, @NotBlank String action) { }
    public record SimpleItemCompletion(@NotNull Number expectedVersion, @NotNull Boolean completed) { }
    public record FulfillmentAction(@NotNull Number expectedVersion, @NotBlank String action) { }
    public record Cancel(@NotNull Number expectedVersion, @NotBlank String reason) { }
    public record Delete(@NotNull Number expectedVersion, @NotBlank @Size(max = 1000) String reason) { }
    public record Restart(@NotNull Number expectedVersion) { }
    public record Note(UUID itemId, @NotBlank String content) { }
    public record Operator(UUID accountId, String nickname) { }
}

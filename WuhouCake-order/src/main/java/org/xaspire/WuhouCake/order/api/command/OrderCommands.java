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
            @NotNull Instant plannedHandoffAt, Instant plannedFinishAt) { }
    public record Item(@NotBlank String name, String productType, @NotNull Number quantity,
            Number unitPriceCents, Number memberPriceCents, Map<String, Object> attributes) { }
    public record Create(@NotNull @Valid Customer customer, @NotNull @Valid Fulfillment fulfillment,
            @NotEmpty List<@NotNull @Valid Item> items, Number totalAmountCents) { }
    public record Revise(@NotNull Number expectedVersion, @NotNull UUID itemId, @NotEmpty Map<String, Object> changes) { }
    public record Information(@NotNull Number expectedVersion, @NotEmpty Map<String, Object> changes) { }
    public record AddItem(@NotNull Number expectedVersion, @NotNull @Valid Item item) { }
    public record RemoveItem(@NotNull Number expectedVersion) { }
    public record PaymentStatus(@NotNull Number expectedVersion, @NotBlank String paymentStatus) { }
    public record ProductionAction(@NotNull Number expectedVersion, @NotBlank String action) { }
    public record FulfillmentAction(@NotNull Number expectedVersion, @NotBlank String action) { }
    public record Cancel(@NotNull Number expectedVersion, @NotBlank String reason) { }
    public record Note(UUID itemId, @NotBlank String content) { }
    public record Operator(UUID accountId, String nickname) { }
}

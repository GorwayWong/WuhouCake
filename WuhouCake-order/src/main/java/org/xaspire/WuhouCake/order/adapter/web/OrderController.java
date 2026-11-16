package org.xaspire.WuhouCake.order.adapter.web;

import jakarta.validation.Valid;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.api.dto.OrderViews;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.application.service.OrderCreationService;
import org.xaspire.WuhouCake.order.application.service.OrderViewAccess;
import org.xaspire.WuhouCake.shared.response.*;

import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_AMOUNT_READ;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.ORDER_PAYMENT_UPDATE;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private static final Set<String> ORDER_PRICES = Set.of("totalAmountCents", "originalAmountCents", "memberAmountCents");
    private static final Set<String> ITEM_PRICES = Set.of("unitPriceCents", "memberPriceCents", "referenceUnitPriceCents", "referenceMemberPriceCents");

    private final OrderService orders;
    private final OrderCreationService creations;
    public OrderController(OrderService orders, OrderCreationService creations) { this.orders = orders; this.creations = creations; }

    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderViews.Detail> create(@Valid @RequestBody OrderCommands.Create command, Authentication authentication,
            @RequestHeader(value = "Idempotency-Key", required = false) UUID requestId) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        boolean recordsPayment = command.paymentMethod() != null && !"UNPAID".equals(command.paymentMethod());
        requireAmountAccess(authentication, recordsPayment || command.totalAmountCents() != null
                || command.originalAmountCents() != null || command.memberAmountCents() != null
                || command.items().stream().anyMatch(OrderController::hasItemPrice));
        if (recordsPayment && !account.access().allows(ORDER_PAYMENT_UPDATE)) {
            throw new AccessDeniedException("ORDER_PAYMENT_UPDATE required");
        }
        return visible(orders.detail(creations.create(command, operator(authentication), requestId)), authentication);
    }
    @GetMapping("/{id}")
    public ApiResponse<OrderViews.Detail> detail(@PathVariable UUID id, Authentication authentication) { return visible(orders.detail(id), authentication); }

    @PatchMapping("/{id}")
    public ApiResponse<OrderViews.Detail> revise(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Revise command, Authentication authentication) {
        requireAmountAccess(authentication, command.changes().keySet().stream().anyMatch(ITEM_PRICES::contains));
        return visible(orders.revise(id, command, operator(authentication)), authentication);
    }
    @PostMapping("/{id}/notes") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderViews.Activity> note(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Note command, Authentication authentication,
            @RequestHeader(value = "Idempotency-Key", required = false) UUID requestId) {
        return ApiResponse.success(orders.note(id, command, operator(authentication), requestId));
    }
    @PostMapping("/{id}/items/{itemId}/remove")
    public ApiResponse<OrderViews.Detail> removeItem(@PathVariable UUID id, @PathVariable UUID itemId,
            @Valid @RequestBody OrderCommands.RemoveItem command, Authentication authentication) {
        return visible(orders.removeItem(id, itemId, command, operator(authentication)), authentication);
    }
    @PostMapping("/{id}/items") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderViews.Detail> addItem(@PathVariable UUID id, @Valid @RequestBody OrderCommands.AddItem command,
            Authentication authentication) {
        requireAmountAccess(authentication, hasItemPrice(command.item()));
        return visible(orders.addItem(id, command, operator(authentication)), authentication);
    }
    @PatchMapping("/{id}/information")
    public ApiResponse<OrderViews.Detail> reviseInformation(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Information command,
            Authentication authentication) {
        requireAmountAccess(authentication, command.changes().keySet().stream().anyMatch(ORDER_PRICES::contains));
        return visible(orders.reviseInformation(id, command, operator(authentication)), authentication);
    }
    @PatchMapping("/{id}/payment-status")
    public ApiResponse<OrderViews.Detail> changePaymentStatus(@PathVariable UUID id, @Valid @RequestBody OrderCommands.PaymentStatus command,
            Authentication authentication) {
        return visible(orders.changePaymentStatus(id, command, operator(authentication)), authentication);
    }
    @PostMapping("/{id}/production-actions")
    public ApiResponse<OrderViews.Detail> productionAction(@PathVariable UUID id, @Valid @RequestBody OrderCommands.ProductionAction command,
            Authentication authentication) {
        return visible(orders.productionAction(id, command, operator(authentication)), authentication);
    }
    @GetMapping("/{id}/activities")
    public ApiResponse<Page<OrderViews.Activity>> activities(@PathVariable UUID id, @RequestParam(required = false) UUID itemId,
            @RequestParam(required = false) String type, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(orders.activities(id, itemId, type, page, size));
    }
    @PatchMapping("/{id}/items/{itemId}/production-status")
    public ApiResponse<OrderViews.Detail> completeSimpleItem(@PathVariable UUID id, @PathVariable UUID itemId,
            @Valid @RequestBody OrderCommands.SimpleItemCompletion command, Authentication authentication) {
        return visible(orders.completeSimpleItem(id, itemId, command, operator(authentication)), authentication);
    }
    @GetMapping("/{id}/notes")
    public ApiResponse<Page<OrderViews.Activity>> notes(@PathVariable UUID id,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(orders.activities(id, null, "NOTE", page, size));
    }
    @PostMapping("/{id}/fulfillment-actions")
    public ApiResponse<OrderViews.Detail> fulfillmentAction(@PathVariable UUID id, @Valid @RequestBody OrderCommands.FulfillmentAction command,
            Authentication authentication) {
        return visible(orders.fulfillmentAction(id, command, operator(authentication)), authentication);
    }
    @PostMapping("/{id}/cancel")
    public ApiResponse<OrderViews.Detail> cancel(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Cancel command, Authentication authentication) {
        return visible(orders.cancel(id, command, operator(authentication)), authentication);
    }
    @PostMapping("/{id}/restart")
    public ApiResponse<OrderViews.Detail> restart(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Restart command, Authentication authentication) {
        return visible(orders.restartCancelled(id, command, operator(authentication)), authentication);
    }
    @PostMapping("/{id}/delete")
    public ApiResponse<OrderViews.Detail> delete(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Delete command, Authentication authentication) {
        return visible(orders.delete(id, command, operator(authentication)), authentication);
    }
    private static boolean hasItemPrice(OrderCommands.Item item) {
        return item.unitPriceCents() != null || item.memberPriceCents() != null
                || item.referenceUnitPriceCents() != null || item.referenceMemberPriceCents() != null;
    }

    private static void requireAmountAccess(Authentication authentication, boolean writesAmount) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        if (writesAmount && !account.access().allows(ORDER_AMOUNT_READ)) {
            throw new AccessDeniedException("ORDER_AMOUNT_READ required");
        }
    }

    private static ApiResponse<OrderViews.Detail> visible(OrderViews.Detail detail, Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return ApiResponse.success(OrderViewAccess.detail(detail, account.access()));
    }
    private static OrderCommands.Operator operator(Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return new OrderCommands.Operator(account.accountId(), account.nickname());
    }
}

package org.xaspire.WuhouCake.order.adapter.web;

import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.api.dto.OrderViews;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.shared.response.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orders;
    public OrderController(OrderService orders) { this.orders = orders; }

    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderViews.Detail> create(@Valid @RequestBody OrderCommands.Create command, Authentication authentication) {
        return ApiResponse.success(orders.create(command, operator(authentication)));
    }
    @GetMapping("/{id}")
    public ApiResponse<OrderViews.Detail> detail(@PathVariable UUID id) { return ApiResponse.success(orders.detail(id)); }

    @PatchMapping("/{id}")
    public ApiResponse<OrderViews.Detail> revise(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Revise command, Authentication authentication) {
        return ApiResponse.success(orders.revise(id, command, operator(authentication)));
    }
    @PostMapping("/{id}/notes") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderViews.Activity> note(@PathVariable UUID id, @Valid @RequestBody OrderCommands.Note command, Authentication authentication) {
        return ApiResponse.success(orders.note(id, command, operator(authentication)));
    }
    @PatchMapping("/{id}/payment-status")
    public ApiResponse<OrderViews.Detail> changePaymentStatus(@PathVariable UUID id, @Valid @RequestBody OrderCommands.PaymentStatus command,
            Authentication authentication) {
        return ApiResponse.success(orders.changePaymentStatus(id, command, operator(authentication)));
    }
    @PostMapping("/{id}/production-actions")
    public ApiResponse<OrderViews.Detail> productionAction(@PathVariable UUID id, @Valid @RequestBody OrderCommands.ProductionAction command,
            Authentication authentication) {
        return ApiResponse.success(orders.productionAction(id, command, operator(authentication)));
    }
    @GetMapping("/{id}/activities")
    public ApiResponse<Page<OrderViews.Activity>> activities(@PathVariable UUID id, @RequestParam(required = false) UUID itemId,
            @RequestParam(required = false) String type, @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(orders.activities(id, itemId, type, page, size));
    }
    private static OrderCommands.Operator operator(Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return new OrderCommands.Operator(account.accountId(), account.nickname());
    }
}

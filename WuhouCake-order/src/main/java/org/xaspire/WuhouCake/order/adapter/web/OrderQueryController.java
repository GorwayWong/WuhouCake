package org.xaspire.WuhouCake.order.adapter.web;

import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.application.service.OrderViewAccess;
import org.xaspire.WuhouCake.order.api.dto.OrderQueryViews;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
@RequestMapping("/api/orders")
public class OrderQueryController {
    private final OrderQueryService queries;
    public OrderQueryController(OrderQueryService queries) { this.queries = queries; }
    @GetMapping("/workbench/payment-orders")
    public ApiResponse<OrderQueryViews.PaymentOrders> paymentOrders(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam String kind, @RequestParam(defaultValue = "1") int page, Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return ApiResponse.success(OrderViewAccess.paymentOrders(queries.paymentOrders(date, kind, page), account.access()));
    }
    @GetMapping("/workbench/receipt-summary")
    public ApiResponse<OrderQueryViews.ReceiptSummary> receiptSummary(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.success(queries.receiptSummary(date));
    }
    @GetMapping("/workbench/cake-bases")
    public ApiResponse<OrderQueryViews.CakeBaseSummary> cakeBases(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.success(queries.cakeBases(date));
    }

    @GetMapping("/workbench/payment-summary")
    public ApiResponse<OrderQueryViews.PaymentSummary> paymentSummary(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return ApiResponse.success(queries.paymentSummary(date));
    }

    @GetMapping("/calendar")
    public ApiResponse<List<OrderQueryViews.CalendarOrder>> calendar(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to, Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return ApiResponse.success(OrderViewAccess.calendar(queries.calendar(from, to), account.access()));
    }

    @GetMapping("/workbench")
    public ApiResponse<OrderQueryViews.Workbench> workbench(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "true") boolean includeMetrics, Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return ApiResponse.success(OrderViewAccess.workbench(queries.workbench(date, includeMetrics), account.access()));
    }
}

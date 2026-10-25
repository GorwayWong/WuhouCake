package org.xaspire.WuhouCake.order.adapter.web;

import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.order.application.service.OrderManagementService;
import org.xaspire.WuhouCake.order.api.dto.OrderManagementViews;
import org.xaspire.WuhouCake.order.api.query.OrderManagementQuery;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
@RequestMapping("/api/admin/orders")
public class OrderManagementController {
    private final OrderManagementService service;
    private final org.xaspire.WuhouCake.order.application.service.OrderExportService exports;
    public OrderManagementController(OrderManagementService service, org.xaspire.WuhouCake.order.application.service.OrderExportService exports) {
        this.service = service; this.exports = exports;
    }
    public record Query(@DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to, String status, String paymentStatus,
            String fulfillmentType, String sizeInches, UUID creditedEmployeeId, Boolean unassigned, Boolean includeCancelled, String keyword, String dateBasis, Boolean allUnpaid, Boolean deleted) {
        OrderManagementQuery command() {
            LocalDate start = from, end = to;
            if (Boolean.TRUE.equals(deleted) && start == null && end == null) {
                end = LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).plusDays(1); start = end.minusDays(30);
            }
            return new OrderManagementQuery(start, end, status, paymentStatus, fulfillmentType, sizeInches, creditedEmployeeId,
                    Boolean.TRUE.equals(unassigned), Boolean.TRUE.equals(includeCancelled), keyword, dateBasis, Boolean.TRUE.equals(allUnpaid), Boolean.TRUE.equals(deleted));
        }
    }
    @GetMapping
    public ApiResponse<OrderManagementViews.Result> search(@ModelAttribute Query query,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(service.search(query.command(), page, size));
    }
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@ModelAttribute Query query) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=order-report.xlsx")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(service.export(query.command()));
    }
    @PostMapping("/exports/zip")
    public void zip(@RequestBody Query query, org.springframework.security.core.Authentication authentication,
            jakarta.servlet.http.HttpServletResponse response) throws java.io.IOException {
        var account = (org.xaspire.WuhouCake.identity.api.facade.IdentityFacade.AccountView) authentication.getDetails();
        OrderFileController.download(exports.management(query.command(),
                new org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator(account.accountId(), account.nickname())), response, exports);
    }
}

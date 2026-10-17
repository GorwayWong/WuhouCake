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
    public OrderManagementController(OrderManagementService service) { this.service = service; }
    public record Query(@DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to, String status, String paymentStatus,
            String fulfillmentType, String sizeInches, UUID creditedEmployeeId, Boolean unassigned, Boolean includeCancelled, String keyword, String dateBasis) {
        OrderManagementQuery command() { return new OrderManagementQuery(from, to, status, paymentStatus, fulfillmentType, sizeInches, creditedEmployeeId, Boolean.TRUE.equals(unassigned), Boolean.TRUE.equals(includeCancelled), keyword, dateBasis); }
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
}

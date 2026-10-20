package org.xaspire.WuhouCake.order.adapter.web;

import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.order.api.dto.OrderQueryViews;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
@RequestMapping("/api/orders")
public class OrderQueryController {
    private final OrderQueryService queries;
    public OrderQueryController(OrderQueryService queries) { this.queries = queries; }

    @GetMapping("/calendar")
    public ApiResponse<List<OrderQueryViews.CalendarOrder>> calendar(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return ApiResponse.success(queries.calendar(from, to));
    }

    @GetMapping("/workbench")
    public ApiResponse<OrderQueryViews.Workbench> workbench(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "true") boolean includeMetrics) {
        return ApiResponse.success(queries.workbench(date, includeMetrics));
    }
}

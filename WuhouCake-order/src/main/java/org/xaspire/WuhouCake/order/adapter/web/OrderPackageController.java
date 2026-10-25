package org.xaspire.WuhouCake.order.adapter.web;

import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.xaspire.WuhouCake.order.application.service.OrderPackageService;
import org.xaspire.WuhouCake.order.api.dto.OrderPackageViews;
import org.xaspire.WuhouCake.shared.response.ApiResponse;
import org.xaspire.WuhouCake.shared.response.Page;

@RestController
@RequestMapping("/api/order-packages")
public class OrderPackageController {
    private final OrderPackageService packages;
    public OrderPackageController(OrderPackageService packages) { this.packages = packages; }
    @GetMapping public ApiResponse<Page<OrderPackageViews.Package>> list(@RequestParam(defaultValue = "") String keyword,
            @RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) { return ApiResponse.success(packages.list(keyword, page, size)); }
    @GetMapping("/{id}") public ApiResponse<OrderPackageViews.Package> detail(@PathVariable UUID id) { return ApiResponse.success(packages.detail(id)); }
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderPackageViews.Package> save(@RequestBody OrderPackageViews.Save command,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) { return ApiResponse.success(packages.create(command.name(), command.items(), key, requestId(request))); }
    @PutMapping("/{id}") public ApiResponse<OrderPackageViews.Package> update(@PathVariable UUID id,
            @RequestBody OrderPackageViews.Update command, HttpServletRequest request) { return ApiResponse.success(packages.update(id, command, requestId(request))); }
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable UUID id, @RequestParam long expectedVersion, HttpServletRequest request) {
        packages.delete(id, expectedVersion, requestId(request)); return ApiResponse.success(null);
    }
    private String requestId(HttpServletRequest request) { return (String) request.getAttribute("wuhoucake.requestId"); }
}

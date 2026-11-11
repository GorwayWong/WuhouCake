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
    @GetMapping("/{id}/items/{itemId}/images/{imageId}")
    public org.springframework.http.ResponseEntity<byte[]> image(@PathVariable UUID id, @PathVariable UUID itemId, @PathVariable UUID imageId) {
        var image = packages.image(id, itemId, imageId);
        return org.springframework.http.ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.parseMediaType(image.contentType()))
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", org.springframework.http.ContentDisposition.inline().filename(image.filename(), java.nio.charset.StandardCharsets.UTF_8).build().toString())
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .body(image.content());
    }
    @PostMapping(consumes = "application/json") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderPackageViews.Package> save(@RequestBody OrderPackageViews.Save command,
            @RequestHeader("Idempotency-Key") UUID key, HttpServletRequest request) {
        return ApiResponse.success(packages.create(command, java.util.Map.of(), key, requestId(request)));
    }
    @PostMapping(consumes = "multipart/form-data") @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderPackageViews.Package> saveWithImages(@RequestPart("package") OrderPackageViews.Save command,
            @RequestHeader("Idempotency-Key") UUID key, org.springframework.web.multipart.MultipartHttpServletRequest request) throws java.io.IOException {
        return ApiResponse.success(packages.create(command, uploads(request), key, requestId(request)));
    }
    @PutMapping(value = "/{id}", consumes = "application/json")
    public ApiResponse<OrderPackageViews.Package> update(@PathVariable UUID id, @RequestBody OrderPackageViews.Update command, HttpServletRequest request) {
        return ApiResponse.success(packages.update(id, command, java.util.Map.of(), requestId(request)));
    }
    @PutMapping(value = "/{id}", consumes = "multipart/form-data")
    public ApiResponse<OrderPackageViews.Package> updateWithImages(@PathVariable UUID id, @RequestPart("package") OrderPackageViews.Update command,
            org.springframework.web.multipart.MultipartHttpServletRequest request) throws java.io.IOException {
        return ApiResponse.success(packages.update(id, command, uploads(request), requestId(request)));
    }
    private java.util.Map<UUID, OrderPackageService.Upload> uploads(org.springframework.web.multipart.MultipartHttpServletRequest request) throws java.io.IOException {
        var uploads = new java.util.HashMap<UUID, OrderPackageService.Upload>();
        for (var part : request.getMultiFileMap().entrySet()) {
            if (part.getKey().equals("package")) continue;
            if (part.getValue().size() != 1) throw new IllegalArgumentException("Invalid package image part");
            UUID id;
            try { id = UUID.fromString(part.getKey()); }
            catch (IllegalArgumentException invalid) { throw new IllegalArgumentException("Invalid package image part"); }
            var file = part.getValue().getFirst();
            if (uploads.putIfAbsent(id, new OrderPackageService.Upload(file.getOriginalFilename(), file.getBytes())) != null)
                throw new IllegalArgumentException("Invalid package image part");
        }
        return uploads;
    }
    @DeleteMapping("/{id}")
    public ApiResponse<Void> delete(@PathVariable UUID id, @RequestParam long expectedVersion, HttpServletRequest request) {
        packages.delete(id, expectedVersion, requestId(request)); return ApiResponse.success(null);
    }
    private String requestId(HttpServletRequest request) { return (String) request.getAttribute("wuhoucake.requestId"); }
}

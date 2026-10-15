package org.xaspire.WuhouCake.order.adapter.web;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.api.command.*;
import org.xaspire.WuhouCake.order.api.dto.OrderFileViews;
import org.xaspire.WuhouCake.order.application.service.*;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@RestController
@RequestMapping("/api/orders")
public class OrderFileController {
    private final OrderImageService images;
    private final OrderExportService exports;
    public OrderFileController(OrderImageService images, OrderExportService exports) { this.images = images; this.exports = exports; }
    @PostMapping(value = "/{orderId}/images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<OrderFileViews.Image> upload(@PathVariable UUID orderId, @RequestParam MultipartFile file,
            @RequestParam(required = false) UUID itemId, Authentication authentication) throws IOException {
        try (var input = file.getInputStream()) {
            return ApiResponse.success(images.upload(orderId, itemId, input.readNBytes(OrderImageService.MAX_IMAGE_BYTES + 1),
                    file.getOriginalFilename(), operator(authentication)));
        }
    }
    @GetMapping("/{orderId}/images")
    public ApiResponse<List<OrderFileViews.Image>> list(@PathVariable UUID orderId) { return ApiResponse.success(images.list(orderId)); }
    @GetMapping("/{orderId}/images/{imageId}")
    public ResponseEntity<byte[]> content(@PathVariable UUID orderId, @PathVariable UUID imageId) {
        var content = images.content(orderId, imageId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(content.image().contentType())).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(content.image().filename(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff").contentLength(content.bytes().length).body(content.bytes());
    }
    @PostMapping("/{orderId}/exports/xlsx")
    public void single(@PathVariable UUID orderId, Authentication authentication, HttpServletResponse response) throws IOException {
        download(exports.single(orderId, operator(authentication)), response);
    }
    @PostMapping("/exports/zip")
    public void batch(@RequestBody OrderExportRequest request, Authentication authentication, HttpServletResponse response) throws IOException {
        download(exports.batch(request, operator(authentication)), response);
    }
    private void download(OrderExportService.Download file, HttpServletResponse response) throws IOException {
        Throwable downloadFailure = null;
        try {
            response.setContentType(file.contentType()); response.setContentLengthLong(file.size());
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.filename(), StandardCharsets.UTF_8).build().toString());
            response.setHeader("X-Content-Type-Options", "nosniff");
            Files.copy(Path.of(file.path()), response.getOutputStream());
        } catch (IOException | RuntimeException | Error failure) {
            downloadFailure = failure; throw failure;
        } finally {
            try { exports.delete(file); }
            catch (RuntimeException cleanup) {
                if (downloadFailure == null) throw cleanup;
                downloadFailure.addSuppressed(cleanup);
            }
        }
    }
    private static OrderCommands.Operator operator(Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return new OrderCommands.Operator(account.accountId(), account.nickname());
    }
}

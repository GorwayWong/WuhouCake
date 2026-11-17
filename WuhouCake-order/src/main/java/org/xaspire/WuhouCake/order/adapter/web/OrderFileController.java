package org.xaspire.WuhouCake.order.adapter.web;

import jakarta.servlet.http.HttpServletResponse;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.LongSupplier;
import org.springframework.core.NestedExceptionUtils;
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
            @RequestParam UUID itemId, @RequestHeader(value = "Idempotency-Key", required = false) UUID requestId, Authentication authentication) throws IOException {
        return ApiResponse.success(images.upload(orderId, itemId, readUpload(file), file.getOriginalFilename(),
                operator(authentication), requestId));
    }

    static byte[] readUpload(MultipartFile file) throws IOException {
        long size = file.getSize();
        OrderImageService.requireUploadSize(size);
        byte[] content = new byte[Math.toIntExact(size)];
        try (var input = new DataInputStream(file.getInputStream())) {
            input.readFully(content);
            if (input.read() != -1) throw new IOException("Multipart image length changed");
        }
        return content;
    }
    @GetMapping("/{orderId}/images")
    public ApiResponse<List<OrderFileViews.Image>> list(@PathVariable UUID orderId) { return ApiResponse.success(images.list(orderId)); }
    @DeleteMapping("/{orderId}/images/{imageId}")
    public ApiResponse<Void> remove(@PathVariable UUID orderId, @PathVariable UUID imageId, Authentication authentication) {
        images.remove(orderId, imageId, operator(authentication));
        return ApiResponse.success(null);
    }
    @GetMapping("/{orderId}/images/{imageId}")
    public ResponseEntity<byte[]> content(@PathVariable UUID orderId, @PathVariable UUID imageId) {
        var content = images.content(orderId, imageId);
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(content.image().contentType())).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename(content.image().filename(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff").contentLength(content.bytes().length).body(content.bytes());
    }
    @PostMapping("/{orderId}/exports/xlsx")
    public void single(@PathVariable UUID orderId, Authentication authentication, HttpServletResponse response) throws IOException {
        download(exports.single(orderId, operator(authentication)), response, exports);
    }
    @PostMapping("/exports/zip")
    public void batch(@RequestBody OrderExportRequest request, Authentication authentication, HttpServletResponse response) throws IOException {
        download(exports.batch(request, operator(authentication)), response, exports);
    }
    static void download(OrderExportService.Download file, HttpServletResponse response, OrderExportService exports) throws IOException {
        download(file, response, exports, System::nanoTime);
    }
    static void download(OrderExportService.Download file, HttpServletResponse response, OrderExportService exports,
            LongSupplier nanoTime) throws IOException {
        Throwable downloadFailure = null;
        try {
            response.setContentType(file.contentType()); response.setContentLengthLong(file.size());
            response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
            String fallback = file.filename().replaceAll("[^A-Za-z0-9._-]", "_");
            String encoded = java.net.URLEncoder.encode(file.filename(), StandardCharsets.UTF_8).replace("+", "%20");
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded);
            response.setHeader("X-Content-Type-Options", "nosniff");
            long deadline = nanoTime.getAsLong() + java.time.Duration.ofSeconds(30).toNanos();
            try (var input = Files.newInputStream(Path.of(file.path()))) {
                var output = response.getOutputStream();
                byte[] buffer = new byte[32 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    checkTransferDeadline(deadline, nanoTime);
                    output.write(buffer, 0, count);
                }
                checkTransferDeadline(deadline, nanoTime);
                response.flushBuffer();
                checkTransferDeadline(deadline, nanoTime);
            }
        } catch (IOException | RuntimeException | Error failure) {
            if (failure instanceof IOException io
                    && NestedExceptionUtils.getMostSpecificCause(io) instanceof SocketTimeoutException) {
                var timeout = new TransferTimeout(io);
                downloadFailure = timeout;
                throw timeout;
            }
            downloadFailure = failure; throw failure;
        } finally {
            try { exports.delete(file); }
            catch (RuntimeException cleanup) {
                if (downloadFailure == null) throw cleanup;
                downloadFailure.addSuppressed(cleanup);
            }
        }
    }
    private static void checkTransferDeadline(long deadline, LongSupplier nanoTime) throws IOException {
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Order export transfer interrupted");
        if (deadline - nanoTime.getAsLong() <= 0) throw new TransferTimeout();
    }
    public static final class TransferTimeout extends IOException {
        public TransferTimeout() { this(null); }
        private TransferTimeout(IOException cause) { super("Order export transfer timed out", cause); }
    }
    private static OrderCommands.Operator operator(Authentication authentication) {
        var account = (IdentityFacade.AccountView) authentication.getDetails();
        return new OrderCommands.Operator(account.accountId(), account.nickname());
    }
}

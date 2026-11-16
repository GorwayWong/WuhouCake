package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tag;
import java.util.List;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.springframework.web.filter.OncePerRequestFilter;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

/** 在 multipart 解析前限制活跃上传，避免整批文件在主应用中并发积累。 */
public final class ImageUploadAdmissionFilter extends OncePerRequestFilter {
    private final Semaphore orders = new Semaphore(1);
    private final Semaphore orderWaiters = new Semaphore(2);
    private final Semaphore packages = new Semaphore(1);
    private final ObjectMapper mapper;
    private final MeterRegistry metrics;
    private final ScratchSpace scratch;

    public ImageUploadAdmissionFilter(ObjectMapper mapper, MeterRegistry metrics) {
        this(mapper, metrics, null);
    }
    ImageUploadAdmissionFilter(ObjectMapper mapper, MeterRegistry metrics, ScratchSpace scratch) {
        this.mapper = mapper;
        this.metrics = metrics;
        this.scratch = scratch;
        metrics.gauge("wuhou.uploads.active", List.of(Tag.of("kind", "order")), orders, limit -> 1 - limit.availablePermits());
        metrics.gauge("wuhou.uploads.active", List.of(Tag.of("kind", "package")), packages, limit -> 1 - limit.availablePermits());
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) { return !matches(request); }

    static boolean matches(HttpServletRequest request) {
        String contentType = request.getContentType();
        return contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("multipart/form-data")
                && (isPackage(request) || request.getMethod().equals("POST") && path(request).matches("/api/orders/[^/]+/images"));
    }

    static boolean isPackage(HttpServletRequest request) {
        String path = path(request);
        return request.getMethod().equals("POST") && path.equals("/api/order-packages")
                || request.getMethod().equals("PUT") && path.matches("/api/order-packages/[^/]+");
    }

    private static String path(HttpServletRequest request) {
        String path = request.getServletPath();
        return path == null || path.isEmpty() ? request.getRequestURI() : path;
    }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        boolean packageUpload = isPackage(request);
        var admission = packageUpload ? packages : orders;
        if (!(packageUpload ? admission.tryAcquire() : acquireOrderUpload())) {
            metrics.counter("wuhou.uploads.rejected", "kind", packageUpload ? "package" : "order").increment();
            unavailable(response, "IMAGE_PROCESSING_BUSY", "图片正在处理中，请稍后重试");
            return;
        }
        String kind = packageUpload ? "package" : "order";
        long bytes = packageUpload ? UploadMultipartFilter.PACKAGE_REQUEST_BYTES : UploadMultipartFilter.ORDER_REQUEST_BYTES;
        boolean completed = false;
        try (var space = scratch == null ? null : scratch.reserve(bytes)) {
            if (scratch != null && space == null) {
                unavailable(response, "TEMP_STORAGE_UNAVAILABLE", "临时空间不足，请稍后重试");
                completed = true;
                return;
            }
            chain.doFilter(request, response);
            completed = true;
        } finally {
            admission.release();
            int status = response.getStatus();
            if (completed && status >= 200 && status < 300) metrics.counter("wuhou.uploads.succeeded", "kind", kind).increment();
            else if (completed && status < 500) metrics.counter("wuhou.uploads.rejected", "kind", kind).increment();
            else metrics.counter("wuhou.uploads.failed", "kind", kind).increment();
        }
    }

    private void unavailable(HttpServletResponse response, String code, String message) throws IOException {
        response.setStatus(503); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("Retry-After", "2");
        mapper.writeValue(response.getOutputStream(), ApiResponse.failure(code, message));
    }

    private boolean acquireOrderUpload() {
        if (orders.tryAcquire()) return true;
        if (!orderWaiters.tryAcquire()) return false;
        try { return orders.tryAcquire(2, TimeUnit.SECONDS); }
        catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            orderWaiters.release();
        }
    }
}

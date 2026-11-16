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

    public ImageUploadAdmissionFilter(ObjectMapper mapper, MeterRegistry metrics) {
        this.mapper = mapper;
        this.metrics = metrics;
        metrics.gauge("wuhou.uploads.active", List.of(Tag.of("kind", "order")), orders, limit -> 1 - limit.availablePermits());
        metrics.gauge("wuhou.uploads.active", List.of(Tag.of("kind", "package")), packages, limit -> 1 - limit.availablePermits());
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String type = request.getContentType(), path = request.getRequestURI();
        return !(request.getMethod().equals("POST") || request.getMethod().equals("PUT")) || type == null
                || !type.toLowerCase(Locale.ROOT).startsWith("multipart/form-data")
                || !(path.equals("/api/order-packages") || path.startsWith("/api/order-packages/")
                || path.matches("/api/orders/[^/]+/images"));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        boolean packageUpload = request.getRequestURI().startsWith("/api/order-packages");
        var admission = packageUpload ? packages : orders;
        if (!(packageUpload ? admission.tryAcquire() : acquireOrderUpload())) {
            metrics.counter("wuhou.uploads.rejected", "kind", packageUpload ? "package" : "order").increment();
            response.setStatus(503); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
            response.setHeader("Retry-After", "2");
            mapper.writeValue(response.getOutputStream(), ApiResponse.failure("IMAGE_PROCESSING_BUSY", "图片正在处理中，请稍后重试"));
            return;
        }
        try { chain.doFilter(request, response); }
        finally { admission.release(); }
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

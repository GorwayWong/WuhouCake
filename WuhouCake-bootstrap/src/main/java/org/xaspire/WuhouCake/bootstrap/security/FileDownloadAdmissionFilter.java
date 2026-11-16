package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.Semaphore;
import java.util.regex.Pattern;
import org.springframework.web.filter.OncePerRequestFilter;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

/** 限制文件读取和生成，配额保留到响应写出或请求失败。 */
final class FileDownloadAdmissionFilter extends OncePerRequestFilter {
    private static final Pattern IMAGE = Pattern.compile("/api/(?:orders/[^/]+/images/[^/]+|order-packages/[^/]+/items/[^/]+/images/[^/]+)");
    private static final Pattern ORDER_EXPORT = Pattern.compile("/api/orders/(?:[^/]+/exports/xlsx|exports/zip)");
    private final Semaphore images = new Semaphore(2);
    private final Semaphore exports = new Semaphore(1);
    private final ObjectMapper mapper;
    private final MeterRegistry metrics;
    private final ScratchSpace scratch;

    FileDownloadAdmissionFilter(ObjectMapper mapper, MeterRegistry metrics) {
        this(mapper, metrics, null);
    }
    FileDownloadAdmissionFilter(ObjectMapper mapper, MeterRegistry metrics, ScratchSpace scratch) {
        this.mapper = mapper;
        this.metrics = metrics;
        this.scratch = scratch;
        metrics.counter("wuhou.exports.requests");
        metrics.gauge("wuhou.files.active", java.util.List.of(io.micrometer.core.instrument.Tag.of("kind", "image")),
                images, limit -> 2 - limit.availablePermits());
        metrics.gauge("wuhou.files.active", java.util.List.of(io.micrometer.core.instrument.Tag.of("kind", "export")),
                exports, limit -> 1 - limit.availablePermits());
    }

    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String path = request.getServletPath();
        if (path == null || path.isEmpty()) path = request.getRequestURI();
        String method = request.getMethod();
        boolean read = method.equals("GET") || method.equals("HEAD");
        boolean export = read && path.equals("/api/admin/orders/export")
                || method.equals("POST") && (path.equals("/api/admin/orders/exports/zip") || ORDER_EXPORT.matcher(path).matches());
        boolean image = read && IMAGE.matcher(path).matches();
        if (!export && !image) {
            chain.doFilter(request, response);
            return;
        }
        if (export) metrics.counter("wuhou.exports.requests").increment();
        var limit = export ? exports : images;
        String kind = export ? "export" : "image";
        if (!limit.tryAcquire()) {
            metrics.counter("wuhou.files.rejected", "kind", kind).increment();
            response.setStatus(503);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.setHeader("Retry-After", "2");
            mapper.writeValue(response.getOutputStream(), ApiResponse.failure(export ? "EXPORT_BUSY" : "IMAGE_DOWNLOAD_BUSY",
                    export ? "导出任务正在运行，请稍后重试" : "图片读取请求过多，请稍后重试"));
            return;
        }
        try (var space = export && scratch != null ? scratch.reserve(ScratchSpace.EXPORT_RESERVATION) : null) {
            if (export && scratch != null && space == null) {
                metrics.counter("wuhou.files.rejected", "kind", kind).increment();
                response.setStatus(503); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
                response.setHeader("Retry-After", "2");
                mapper.writeValue(response.getOutputStream(), ApiResponse.failure("TEMP_STORAGE_UNAVAILABLE", "临时空间不足，请稍后重试"));
                return;
            }
            chain.doFilter(request, response);
        } finally { limit.release(); }
    }
}

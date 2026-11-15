package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final Semaphore admission = new Semaphore(1);
    private final Semaphore waiting = new Semaphore(2);
    private final ObjectMapper mapper;
    public ImageUploadAdmissionFilter(ObjectMapper mapper) { this.mapper = mapper; }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        String type = request.getContentType(), path = request.getRequestURI();
        return !(request.getMethod().equals("POST") || request.getMethod().equals("PUT")) || type == null
                || !type.toLowerCase(Locale.ROOT).startsWith("multipart/form-data")
                || !(path.equals("/api/order-packages") || path.startsWith("/api/order-packages/")
                || path.matches("/api/orders/[^/]+/images"));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        if (!acquire()) {
            response.setStatus(503); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
            response.setHeader("Retry-After", "2");
            mapper.writeValue(response.getOutputStream(), ApiResponse.failure("IMAGE_PROCESSING_BUSY", "图片正在处理中，请稍后重试"));
            return;
        }
        try { chain.doFilter(request, response); }
        finally { admission.release(); }
    }
    private boolean acquire() {
        if (admission.tryAcquire()) return true;
        if (!waiting.tryAcquire()) return false;
        try { return admission.tryAcquire(2, TimeUnit.SECONDS); }
        catch (InterruptedException failure) { Thread.currentThread().interrupt(); return false; }
        finally { waiting.release(); }
    }
}

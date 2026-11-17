package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.security.SecurityProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class WebSupport {
    @Bean ScratchSpace scratchSpace(@Value("${wuhoucake.scratch.managed:false}") boolean managed,
            @Value("${APP_SCRATCH_REQUIRE_MOUNT:false}") boolean requireMount,
            @Value("${spring.servlet.multipart.location}") String multipartDirectory, MeterRegistry metrics) throws IOException {
        return ScratchSpace.open(managed, requireMount, multipartDirectory, metrics);
    }
    @Bean SecurityErrors securityErrors(ObjectMapper mapper) { return new SecurityErrors(mapper); }
    @Bean FilterRegistrationBean<OncePerRequestFilter> multipartRoutes(SecurityErrors errors) {
        var registration = new FilterRegistrationBean<OncePerRequestFilter>(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                    FilterChain chain) throws ServletException, IOException {
                String contentType = request.getContentType();
                if (contentType != null && contentType.stripLeading().regionMatches(true, 0, "multipart/", 0, 10)
                        && !ImageUploadAdmissionFilter.matches(request)) {
                    errors.write(response, 415, "MULTIPART_NOT_SUPPORTED");
                    return;
                }
                chain.doFilter(request, response);
            }
        });
        // 在公开提交读取正文和 Spring Security 的 CSRF 参数回退之前执行。
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 1);
        return registration;
    }
    @Bean FilterRegistrationBean<ImageUploadAdmissionFilter> imageUploadAdmission(ObjectMapper mapper, MeterRegistry metrics, SecurityProperties security, ScratchSpace scratch) {
        var registration = new FilterRegistrationBean<>(new ImageUploadAdmissionFilter(mapper, metrics, scratch));
        registration.setOrder(security.getFilter().getOrder() + 1); return registration;
    }
    @Bean FilterRegistrationBean<FileDownloadAdmissionFilter> fileDownloadAdmission(ObjectMapper mapper,
            MeterRegistry metrics, SecurityProperties security, ScratchSpace scratch) {
        var registration = new FilterRegistrationBean<>(new FileDownloadAdmissionFilter(mapper, metrics, scratch));
        registration.setOrder(security.getFilter().getOrder() + 1); return registration;
    }
    @Bean FilterRegistrationBean<UploadMultipartFilter> uploadMultipart(ObjectMapper mapper, MeterRegistry metrics, SecurityProperties security) {
        var registration = new FilterRegistrationBean<>(new UploadMultipartFilter(mapper, metrics));
        registration.setOrder(security.getFilter().getOrder() + 2);
        return registration;
    }
    @Bean FilterRegistrationBean<OncePerRequestFilter> requestIds() {
        OncePerRequestFilter filter = new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
                String id = UUID.randomUUID().toString(); request.setAttribute("wuhoucake.requestId", id); response.setHeader("X-Request-Id", id);
                if (request.getRequestURI().startsWith("/api/")) response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
                chain.doFilter(request, response);
            }
        };
        var registration = new FilterRegistrationBean<>(filter); registration.setOrder(Ordered.HIGHEST_PRECEDENCE); return registration;
    }
    @RestController
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    public static class CsrfEndpoint {
        public record Token(String headerName) { }
        @GetMapping("/api/auth/csrf") public ApiResponse<Token> csrf(CsrfToken token) {
            return ApiResponse.success(new Token(token.getHeaderName()));
        }
    }
}

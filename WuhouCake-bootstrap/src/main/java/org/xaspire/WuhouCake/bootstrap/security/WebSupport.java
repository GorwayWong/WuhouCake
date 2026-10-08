package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
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
    @Bean SecurityErrors securityErrors(ObjectMapper mapper) { return new SecurityErrors(mapper); }
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

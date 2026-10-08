package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

public final class SecurityErrors implements AuthenticationEntryPoint, AccessDeniedHandler {
    private final ObjectMapper json;
    public SecurityErrors(ObjectMapper json) { this.json = json; }
    @Override public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException failure) throws IOException {
        boolean unavailable = failure instanceof OAuth2AuthenticationException oauth && "temporarily_unavailable".equals(oauth.getError().getErrorCode());
        write(response, unavailable ? 503 : 401, unavailable ? "SERVICE_UNAVAILABLE" : "AUTHENTICATION_FAILED");
    }
    @Override public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException failure) throws IOException { write(response, 403, "FORBIDDEN"); }
    public void write(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control", "no-store");
        json.writeValue(response.getWriter(), ApiResponse.failure(code, code));
    }
}

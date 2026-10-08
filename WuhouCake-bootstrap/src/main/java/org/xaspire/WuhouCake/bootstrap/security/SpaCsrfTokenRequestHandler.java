package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.function.Supplier;
import org.springframework.security.web.csrf.*;
import org.springframework.util.StringUtils;

/** Cookie/header handling follows Spring Security's documented SPA CSRF configuration. */
public final class SpaCsrfTokenRequestHandler implements CsrfTokenRequestHandler {
    private final CsrfTokenRequestHandler plain = new CsrfTokenRequestAttributeHandler();
    private final CsrfTokenRequestHandler xor = new XorCsrfTokenRequestAttributeHandler();
    @Override public void handle(HttpServletRequest request, HttpServletResponse response, Supplier<CsrfToken> token) {
        xor.handle(request, response, token);
        token.get();
    }
    @Override public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken token) {
        return (StringUtils.hasText(request.getHeader(token.getHeaderName())) ? plain : xor).resolveCsrfTokenValue(request, token);
    }
}

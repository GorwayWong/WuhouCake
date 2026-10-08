package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;

public final class PasswordChangeFilter extends OncePerRequestFilter {
    private final SecurityErrors errors;
    public PasswordChangeFilter(SecurityErrors errors) { this.errors = errors; }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean allowed = ("GET".equals(request.getMethod()) && "/api/me".equals(request.getServletPath()))
                || ("POST".equals(request.getMethod()) && "/api/me/password".equals(request.getServletPath()));
        if (authentication != null && authentication.getDetails() instanceof IdentityFacade.AccountView account && account.passwordChangeRequired() && !allowed) {
            errors.write(response, 403, "PASSWORD_CHANGE_REQUIRED"); return;
        }
        chain.doFilter(request, response);
    }
}

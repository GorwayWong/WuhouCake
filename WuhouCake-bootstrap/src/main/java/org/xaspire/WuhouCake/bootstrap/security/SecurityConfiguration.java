package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.DispatcherType;
import java.util.ArrayList;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.*;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.access.intercept.RequestAuthorizationContext;
import org.xaspire.WuhouCake.bootstrap.configuration.ApplicationSecurityProperties;
import org.xaspire.WuhouCake.bootstrap.configuration.IdentityProperties;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;
import static org.springframework.http.HttpMethod.*;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableConfigurationProperties(ApplicationSecurityProperties.class)
public class SecurityConfiguration {
    @Bean @Order(1)
    SecurityFilterChain authenticationEndpoints(HttpSecurity http, IdentityProperties properties, SecurityErrors errors) throws Exception {
        var csrf = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrf.setCookieCustomizer(cookie -> cookie.secure(properties.secureCookie()).sameSite("Lax").path("/"));
        http.securityMatcher("/api/auth/**")
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/auth/csrf").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/auth/login", "/api/auth/refresh", "/api/auth/logout").permitAll()
                        .anyRequest().denyAll())
                .csrf(config -> config.csrfTokenRepository(csrf).csrfTokenRequestHandler(new SpaCsrfTokenRequestHandler()))
                .exceptionHandling(config -> config.authenticationEntryPoint(errors).accessDeniedHandler(errors));
        stateless(http);
        return http.build();
    }
    @Bean @Order(2)
    SecurityFilterChain customerEntryEndpoints(HttpSecurity http, SecurityErrors errors) throws Exception {
        http.securityMatcher("/api/public/order-entries/**")
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/public/order-entries/{token}").permitAll()
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/public/order-entries/{token}/submissions").permitAll()
                        .anyRequest().denyAll())
                .csrf(AbstractHttpConfigurer::disable)
                .exceptionHandling(config -> config.authenticationEntryPoint(errors).accessDeniedHandler(errors));
        stateless(http); return http.build();
    }
    @Bean @Order(3)
    SecurityFilterChain businessEndpoints(HttpSecurity http, ApplicationSecurityProperties properties, IdentityFacade identity, SecurityErrors errors) throws Exception {
        http.authorizeHttpRequests(authorize -> {
            authorize.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll();
            authorize.requestMatchers("/actuator/health", "/actuator/health/**").permitAll();
            if (properties.permitApiDocs()) {
                authorize.requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll();
            }
            authorize.requestMatchers(GET, "/api/admin/orders").access(permissions(ORDER_MANAGEMENT_READ, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ));
            authorize.requestMatchers(GET, "/api/admin/orders/export").access(permissions(ORDER_MANAGEMENT_READ, ORDER_EXPORT, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ));
            authorize.requestMatchers(POST, "/api/admin/orders/exports/zip").access(permissions(ORDER_MANAGEMENT_READ, ORDER_EXPORT, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ));
            authorize.requestMatchers(GET, "/api/admin/audit-logs").access(permissions(AUDIT_READ));
            authorize.requestMatchers(GET, "/api/admin/employees").access(permissions(EMPLOYEE_MANAGE));
            authorize.requestMatchers(POST, "/api/admin/employees", "/api/admin/employees/{id}/reset-password", "/api/admin/employees/{id}/archive").access(permissions(EMPLOYEE_MANAGE));
            authorize.requestMatchers(PATCH, "/api/admin/employees/{id}", "/api/admin/employees/{id}/password").access(permissions(EMPLOYEE_MANAGE));
            authorize.requestMatchers("/api/me", "/api/me/**").authenticated();
            authorize.requestMatchers(GET, "/api/employees/options").access(permissions(EMPLOYEE_DIRECTORY_READ));
            authorize.requestMatchers(GET, "/api/orders/{id}/activities").access(permissions(ORDER_READ, ORDER_ACTIVITY_READ, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ));
            authorize.requestMatchers(GET, "/api/orders/workbench/payment-summary").access(permissions(ORDER_READ, ORDER_AMOUNT_READ));
            authorize.requestMatchers(GET, "/api/orders/workbench/payment-orders").access(permissions(ORDER_READ, ORDER_AMOUNT_READ));
            authorize.requestMatchers(GET, "/api/orders/workbench/receipt-summary").access(permissions(ORDER_READ, ORDER_AMOUNT_READ));
            authorize.requestMatchers(GET, "/api/orders/workbench/cake-bases").access(permissions(ORDER_READ));
            authorize.requestMatchers(GET, "/api/orders/{id}/notes").access(permissions(ORDER_READ));
            authorize.requestMatchers(GET, "/api/orders/{id}/customer-origin").access(permissions(ORDER_READ, ORDER_CUSTOMER_READ));
            authorize.requestMatchers(GET, "/api/orders/calendar", "/api/orders/workbench", "/api/orders/stream", "/api/orders/{id}",
                    "/api/orders/{id}/images", "/api/orders/{id}/images/{imageId}").access(permissions(ORDER_READ));
            authorize.requestMatchers(GET, "/api/order-packages", "/api/order-packages/{id}").access(packageAccess(false));
            authorize.requestMatchers(POST, "/api/order-packages").access(packageAccess(true));
            authorize.requestMatchers(PUT, "/api/order-packages/{id}").access(packageAccess(true));
            authorize.requestMatchers(DELETE, "/api/order-packages/{id}").access(packageAccess(true));
            authorize.requestMatchers(POST, "/api/orders", "/api/orders/recognition/parse", "/api/orders/recognition/assist").access(permissions(ORDER_CREATE));
            authorize.requestMatchers(PATCH, "/api/orders/{id}", "/api/orders/{id}/information").access(permissions(ORDER_EDIT));
            authorize.requestMatchers(POST, "/api/orders/{id}/items", "/api/orders/{id}/items/{itemId}/remove").access(permissions(ORDER_EDIT));
            authorize.requestMatchers(PATCH, "/api/orders/{id}/payment-status").access(permissions(ORDER_PAYMENT_UPDATE));
            authorize.requestMatchers(POST, "/api/orders/{id}/production-actions").access(permissions(ORDER_PRODUCTION_UPDATE));
            authorize.requestMatchers(PATCH, "/api/orders/{id}/items/{itemId}/production-status").access(permissions(ORDER_PRODUCTION_UPDATE));
            authorize.requestMatchers(POST, "/api/orders/{id}/fulfillment-actions").access(permissions(ORDER_FULFILLMENT_UPDATE));
            authorize.requestMatchers(POST, "/api/orders/{id}/cancel").access(permissions(ORDER_CANCEL));
            authorize.requestMatchers(POST, "/api/orders/{id}/delete").access(permissions(ORDER_DELETE, ORDER_DELETED_READ));
            authorize.requestMatchers(POST, "/api/orders/{id}/restart").access(permissions(ORDER_CANCEL, ORDER_PRODUCTION_UPDATE));
            authorize.requestMatchers(POST, "/api/orders/{id}/notes").access(permissions(ORDER_NOTE_CREATE));
            authorize.requestMatchers(POST, "/api/orders/{id}/images").access(permissions(ORDER_IMAGE_UPLOAD));
            authorize.requestMatchers(DELETE, "/api/orders/{id}/images/{imageId}").access(permissions(ORDER_IMAGE_DELETE));
            authorize.requestMatchers(POST, "/api/orders/{id}/exports/xlsx", "/api/orders/exports/zip").access(permissions(ORDER_EXPORT, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ, ORDER_BUSINESS_DETAILS_READ));
            authorize.requestMatchers(GET, "/api/customer-submissions/entry").access(permissions(CUSTOMER_ENTRY_MANAGE));
            authorize.requestMatchers(GET, "/api/customer-submissions/pending-count").access(permissions(CUSTOMER_SUBMISSION_PROCESS));
            authorize.requestMatchers(POST, "/api/customer-submissions/entry").access(permissions(CUSTOMER_ENTRY_MANAGE));
            authorize.requestMatchers(GET, "/api/customer-submissions", "/api/customer-submissions/{id}").access(permissions(CUSTOMER_SUBMISSION_PROCESS, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ));
            authorize.requestMatchers(PATCH, "/api/customer-submissions/{id}").access(permissions(CUSTOMER_SUBMISSION_PROCESS, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ));
            authorize.requestMatchers(POST, "/api/customer-submissions/{id}/confirm").access(permissions(CUSTOMER_SUBMISSION_PROCESS, ORDER_CREATE, ORDER_CUSTOMER_READ, ORDER_AMOUNT_READ));
            authorize.requestMatchers(DELETE, "/api/customer-submissions/{id}").access(permissions(CUSTOMER_SUBMISSION_PROCESS));
            authorize.anyRequest().denyAll();
        });
        http.csrf(AbstractHttpConfigurer::disable)
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(token -> authenticate(identity, token)))
                        .authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .exceptionHandling(config -> config.authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .addFilterAfter(new PasswordChangeFilter(errors), BearerTokenAuthenticationFilter.class);
        stateless(http);
        return http.build();
    }
    private static AbstractAuthenticationToken authenticate(IdentityFacade identity, Jwt jwt) {
        IdentityFacade.AccountView account;
        try {
            account = identity.authenticate(UUID.fromString(jwt.getSubject()), UUID.fromString(jwt.getClaimAsString("sid")), ((Number) jwt.getClaim("ver")).longValue());
        } catch (IdentityFailure failure) { throw new OAuth2AuthenticationException(new OAuth2Error("invalid_token")); }
        catch (RuntimeException failure) { throw new OAuth2AuthenticationException(new OAuth2Error("temporarily_unavailable")); }
        var authorities = new ArrayList<SimpleGrantedAuthority>();
        authorities.add(new SimpleGrantedAuthority("ROLE_" + account.systemRole()));
        account.access().permissions().forEach(permission -> authorities.add(new SimpleGrantedAuthority(permission.authority())));
        var result = new JwtAuthenticationToken(jwt, authorities, account.accountId().toString());
        result.setDetails(account);
        return result;
    }
    private static AuthorizationManager<RequestAuthorizationContext> permissions(Permission... required) {
        return (authentication, context) -> {
            var current = authentication.get();
            var granted = current.getAuthorities().stream().map(org.springframework.security.core.GrantedAuthority::getAuthority).collect(java.util.stream.Collectors.toSet());
            return new AuthorizationDecision(current.isAuthenticated()
                    && java.util.Arrays.stream(required).allMatch(permission -> granted.contains(permission.authority())));
        };
    }
    private static AuthorizationManager<RequestAuthorizationContext> packageAccess(boolean write) {
        return (authentication, context) -> {
            var current = authentication.get();
            boolean allowed = current.getDetails() instanceof IdentityFacade.AccountView account
                    && (account.jobRoles().contains("MANAGER") || account.jobRoles().contains("STORE_MANAGER") || !write && account.access().allows(ORDER_CREATE));
            return new AuthorizationDecision(current.isAuthenticated() && allowed);
        };
    }
    private static void stateless(HttpSecurity http) throws Exception {
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.requestCache(AbstractHttpConfigurer::disable);
        http.formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable);
    }
}

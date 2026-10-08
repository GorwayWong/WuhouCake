package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.DispatcherType;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.AbstractAuthenticationToken;
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
import org.xaspire.WuhouCake.bootstrap.configuration.ApplicationSecurityProperties;
import org.xaspire.WuhouCake.bootstrap.configuration.IdentityProperties;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;

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
    SecurityFilterChain businessEndpoints(HttpSecurity http, ApplicationSecurityProperties properties, IdentityFacade identity, SecurityErrors errors) throws Exception {
        http.authorizeHttpRequests(authorize -> {
            authorize.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll();
            authorize.requestMatchers("/actuator/health", "/actuator/health/**").permitAll();
            if (properties.permitApiDocs()) {
                authorize.requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll();
            }
            authorize.requestMatchers("/api/admin/**").hasRole("SUPER_ADMIN");
            authorize.requestMatchers("/api/me", "/api/me/**").authenticated();
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
        var result = new JwtAuthenticationToken(jwt, List.of(new SimpleGrantedAuthority("ROLE_" + account.systemRole())), account.accountId().toString());
        result.setDetails(account);
        return result;
    }
    private static void stateless(HttpSecurity http) throws Exception {
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.requestCache(AbstractHttpConfigurer::disable);
        http.formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable);
    }
}

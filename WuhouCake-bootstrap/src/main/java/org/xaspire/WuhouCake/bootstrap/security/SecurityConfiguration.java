package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.DispatcherType;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.xaspire.WuhouCake.bootstrap.configuration.ApplicationSecurityProperties;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ApplicationSecurityProperties.class)
public class SecurityConfiguration {
    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, ApplicationSecurityProperties properties)
            throws Exception {
        http.authorizeHttpRequests(authorize -> {
            authorize.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll();
            authorize.requestMatchers("/actuator/health", "/actuator/health/**").permitAll();
            if (properties.permitApiDocs()) {
                authorize.requestMatchers("/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html").permitAll();
            }
            authorize.anyRequest().denyAll();
        });
        http.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
        http.formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable);
        return http.build();
    }
}

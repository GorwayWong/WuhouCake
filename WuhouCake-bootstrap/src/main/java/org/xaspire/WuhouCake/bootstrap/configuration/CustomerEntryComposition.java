package org.xaspire.WuhouCake.bootstrap.configuration;

import java.net.URI;
import java.time.Clock;
import java.util.List;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.xaspire.WuhouCake.bootstrap.security.*;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.application.service.*;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.CustomerSubmissionMapper;
import org.xaspire.WuhouCake.order.infrastructure.persistence.repository.PostgresCustomerSubmissions;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(CustomerEntryProperties.class)
public class CustomerEntryComposition {
    @Bean @org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
    org.xaspire.WuhouCake.order.adapter.web.CustomerSubmissionController customerSubmissionController(CustomerSubmissionService service) {
        return new org.xaspire.WuhouCake.order.adapter.web.CustomerSubmissionController(service);
    }
    @Bean @org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
    org.xaspire.WuhouCake.order.adapter.web.PublicOrderEntryController publicOrderEntryController(CustomerSubmissionService service, com.fasterxml.jackson.databind.ObjectMapper json) {
        return new org.xaspire.WuhouCake.order.adapter.web.PublicOrderEntryController(service, json);
    }
    @Bean CustomerSubmissions customerSubmissions(CustomerSubmissionMapper mapper, JsonCodec json) { return new PostgresCustomerSubmissions(mapper, json); }
    @Bean CustomerSubmissionService customerSubmissionService(CustomerSubmissions submissions, IdentityFacade identity, OrderService orders,
            JsonCodec json, Clock clock, CustomerEntryProperties properties, org.xaspire.WuhouCake.audit.api.facade.AuditFacade audit, Environment environment) {
        var publicOrigin = properties.publicOrigin();
        if ("auto".equals(publicOrigin)) {
            if (!environment.matchesProfiles("dev") || environment.matchesProfiles("prod"))
                throw new IllegalArgumentException("Automatic customer entry origin is only available in dev without prod");
            publicOrigin = DevCustomerEntryOrigin.resolve();
        }
        var origin = URI.create(publicOrigin);
        if ("http".equals(origin.getScheme()) && (environment.matchesProfiles("prod")
                || !environment.matchesProfiles("dev") && !List.of("localhost", "127.0.0.1", "[::1]").contains(origin.getHost())))
            throw new IllegalArgumentException("Customer entry requires HTTPS in prod; non-local HTTP origins require the dev profile");
        return new CustomerSubmissionService(submissions, identity, orders, json, clock, publicOrigin, audit);
    }
    @Bean @org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
    FilterRegistrationBean<CustomerEntryProtection> customerEntryProtection(StringRedisTemplate redis, CustomerEntryProperties properties,
            SecurityErrors errors, Clock clock, IdentityProperties identity) {
        var registration = new FilterRegistrationBean<>(new CustomerEntryProtection(redis, properties, errors, clock, identity.redisNamespace()));
        registration.setOrder(org.springframework.core.Ordered.HIGHEST_PRECEDENCE + 10); return registration;
    }
}

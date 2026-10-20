package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
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
            JsonCodec json, Clock clock, CustomerEntryProperties properties) {
        return new CustomerSubmissionService(submissions, identity, orders, json, clock, properties.publicOrigin());
    }
    @Bean @org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
    FilterRegistrationBean<CustomerEntryProtection> customerEntryProtection(StringRedisTemplate redis, CustomerEntryProperties properties,
            SecurityErrors errors, Clock clock, IdentityProperties identity) {
        var registration = new FilterRegistrationBean<>(new CustomerEntryProtection(redis, properties, errors, clock, identity.redisNamespace()));
        registration.setOrder(org.springframework.core.Ordered.HIGHEST_PRECEDENCE + 10); return registration;
    }
}

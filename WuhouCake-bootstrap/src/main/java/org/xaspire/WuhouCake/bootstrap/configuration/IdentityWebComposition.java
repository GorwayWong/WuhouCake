package org.xaspire.WuhouCake.bootstrap.configuration;

import io.micrometer.core.instrument.FunctionCounter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.xaspire.WuhouCake.audit.adapter.web.AuditController;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.identity.adapter.web.IdentityController;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class IdentityWebComposition {
    @Bean IdentityController identityController(IdentityFacade identity, IdentityProperties properties) { return new IdentityController(identity, properties.secureCookie()); }
    @Bean AuditController auditController(AuditFacade audit) { return new AuditController(audit); }
    @Bean FunctionCounter auditFailureCounter(MeterRegistry registry, IdentityService identity) {
        return FunctionCounter.builder("wuhoucake.audit.failures", identity, IdentityService::auditFailureCount).register(registry);
    }
}

package org.xaspire.WuhouCake.bootstrap.configuration;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class IdentityOpenApi {
    @Bean OpenAPI identityApi() {
        return new OpenAPI().components(new Components().addSecuritySchemes("bearerAuth", new SecurityScheme()
                .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")));
    }
    @Bean OpenApiCustomizer identityApiSecurity() {
        return api -> api.getPaths().forEach((path, item) -> {
            if (path.startsWith("/api/me") || path.startsWith("/api/admin/"))
                item.readOperations().forEach(operation -> operation.addSecurityItem(new SecurityRequirement().addList("bearerAuth")));
        });
    }
}

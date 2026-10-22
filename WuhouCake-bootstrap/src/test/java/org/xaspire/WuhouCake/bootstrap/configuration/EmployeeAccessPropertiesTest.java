package org.xaspire.WuhouCake.bootstrap.configuration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.xaspire.WuhouCake.identity.application.service.EmployeeAccessPolicy;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.JobRole;
import java.util.Set;
import static org.assertj.core.api.Assertions.assertThat;
import static org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission.*;

class EmployeeAccessPropertiesTest {
    private final ApplicationContextRunner context = new ApplicationContextRunner().withUserConfiguration(Config.class);
    @Configuration(proxyBeanMethods = false) @EnableConfigurationProperties(EmployeeAccessProperties.class)
    static class Config {
        @Bean EmployeeAccessPolicy policy(EmployeeAccessProperties properties) { return new EmployeeAccessPolicy(properties.jobPermissions()); }
    }

    @Test void typedConfigurationSupportsRestrictedAndEmptyJobPermissions() {
        context.withPropertyValues("wuhoucake.authorization.job-permissions.PASTRY_CHEF=ORDER_READ,ORDER_PRODUCTION_UPDATE",
                "wuhoucake.authorization.job-permissions.FRONT_DESK=").run(result -> {
            assertThat(result).hasNotFailed();
            var grants = result.getBean(EmployeeAccessProperties.class).jobPermissions();
            assertThat(grants.get(JobRole.PASTRY_CHEF)).isEqualTo(Set.of(ORDER_READ, ORDER_PRODUCTION_UPDATE));
            assertThat(grants.get(JobRole.FRONT_DESK)).isEmpty();
        });
    }

    @Test void unknownRolesPermissionsAndJobBasedSystemPrivilegesFailStartup() {
        for (var property : Set.of("wuhoucake.authorization.job-permissions.UNKNOWN=ORDER_READ",
                "wuhoucake.authorization.job-permissions.PASTRY_CHEF=UNKNOWN_PERMISSION",
                "wuhoucake.authorization.job-permissions.MANAGER=EMPLOYEE_MANAGE")) {
            context.withPropertyValues(property).run(result -> assertThat(result).hasFailed());
        }
    }
}

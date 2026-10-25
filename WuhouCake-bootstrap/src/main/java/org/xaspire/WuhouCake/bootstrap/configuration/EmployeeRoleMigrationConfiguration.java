package org.xaspire.WuhouCake.bootstrap.configuration;

import java.nio.file.*;
import java.util.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "wuhoucake.maintenance.role-assignments")
public class EmployeeRoleMigrationConfiguration {
    @Bean ApplicationRunner migrateEmployeeRoles(IdentityService identity, ObjectMapper json, Environment environment) {
        return args -> {
            MaintenanceBackup.require(environment);
            var path = Path.of(environment.getRequiredProperty("wuhoucake.maintenance.role-assignments"));
            var assignments = json.readValue(Files.readString(path), new TypeReference<Map<String, Set<String>>>() { });
            if (assignments.isEmpty() || assignments.values().stream().anyMatch(value -> value == null || value.isEmpty()))
                throw new IllegalArgumentException("岗位清单不能为空");
            var result = identity.migrateLegacyJobs(environment.getRequiredProperty("wuhoucake.maintenance.administrator"), assignments);
            org.slf4j.LoggerFactory.getLogger(EmployeeRoleMigrationConfiguration.class).info("employee_roles_migrated count={}", result.size());
        };
    }
}

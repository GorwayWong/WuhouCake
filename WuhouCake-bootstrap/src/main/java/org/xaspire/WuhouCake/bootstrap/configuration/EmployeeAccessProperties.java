package org.xaspire.WuhouCake.bootstrap.configuration;

import java.util.EnumMap;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess.Permission;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.JobRole;

@ConfigurationProperties("wuhoucake.authorization")
public record EmployeeAccessProperties(Map<JobRole, Set<Permission>> jobPermissions) {
    public EmployeeAccessProperties {
        var copy = new EnumMap<JobRole, Set<Permission>>(JobRole.class);
        if (jobPermissions != null) jobPermissions.forEach((role, permissions) -> copy.put(role, Set.copyOf(permissions)));
        jobPermissions = Map.copyOf(copy);
    }
}

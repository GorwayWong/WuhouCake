package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.AccessTokens;
import static org.junit.jupiter.api.Assertions.*;

class NonWebIdentityTokensConfigurationTest {
    @Test void maintenanceCanConstructIdentityServicesWithoutIssuingTokens() {
        new ApplicationContextRunner().withUserConfiguration(NonWebIdentityTokensConfiguration.class).run(context -> {
            assertNull(context.getStartupFailure());
            assertThrows(IllegalStateException.class, () -> context.getBean(AccessTokens.class)
                    .issue(UUID.randomUUID(), UUID.randomUUID(), 0, Instant.now(), Instant.now().plusSeconds(60)));
        });
    }
}

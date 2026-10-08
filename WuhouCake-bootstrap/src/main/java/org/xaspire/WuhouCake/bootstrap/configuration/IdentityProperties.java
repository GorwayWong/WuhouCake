package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("wuhoucake.identity")
public record IdentityProperties(String privateKey, String publicKey, String issuer, String audience,
        Duration accessLifetime, Duration sessionLifetime, Boolean secureCookie, String redisNamespace) {
    public IdentityProperties {
        issuer = issuer == null ? "urn:wuhoucake:identity" : issuer;
        audience = audience == null ? "wuhoucake-api" : audience;
        accessLifetime = accessLifetime == null ? Duration.ofMinutes(15) : accessLifetime;
        sessionLifetime = sessionLifetime == null ? Duration.ofDays(7) : sessionLifetime;
        secureCookie = secureCookie == null || secureCookie;
        redisNamespace = redisNamespace == null ? "wuhoucake:identity" : redisNamespace;
        if (accessLifetime.compareTo(Duration.ofSeconds(1)) < 0 || sessionLifetime.compareTo(Duration.ofSeconds(1)) < 0
                || accessLifetime.compareTo(sessionLifetime) > 0 || sessionLifetime.compareTo(Duration.ofDays(7)) > 0)
            throw new IllegalArgumentException("Invalid identity lifetimes");
    }
}

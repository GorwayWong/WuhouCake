package org.xaspire.WuhouCake.bootstrap.configuration;

import java.net.URI;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("wuhoucake.customer-entry")
public record CustomerEntryProperties(String publicOrigin, Integer perMinute, Integer perHour, Integer maxBodyBytes, List<String> trustedProxies) {
    public CustomerEntryProperties {
        publicOrigin = publicOrigin == null ? "http://localhost:5173" : publicOrigin;
        var origin = URI.create(publicOrigin);
        if (!"auto".equals(publicOrigin)) {
            if (origin.getHost() == null || origin.getUserInfo() != null || origin.getQuery() != null || origin.getFragment() != null
                    || !("https".equals(origin.getScheme()) || "http".equals(origin.getScheme()))
                    || !(origin.getPath().isEmpty() || "/".equals(origin.getPath()))) throw new IllegalArgumentException("Customer entry requires an HTTP or HTTPS origin without credentials, path, query or fragment");
        }
        perMinute = perMinute == null ? 10 : perMinute; perHour = perHour == null ? 100 : perHour;
        maxBodyBytes = maxBodyBytes == null ? 131072 : maxBodyBytes;
        trustedProxies = trustedProxies == null ? List.of() : List.copyOf(trustedProxies);
        if (perMinute < 1 || perHour < 1 || maxBodyBytes < 1024 || maxBodyBytes > 1048576) throw new IllegalArgumentException("Invalid customer entry limits");
    }
}

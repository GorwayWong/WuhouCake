package org.xaspire.WuhouCake.bootstrap.configuration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("wuhoucake.security")
public record ApplicationSecurityProperties(boolean permitApiDocs) {
}

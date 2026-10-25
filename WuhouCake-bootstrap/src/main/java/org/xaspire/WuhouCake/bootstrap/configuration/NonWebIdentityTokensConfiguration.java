package org.xaspire.WuhouCake.bootstrap.configuration;

import org.springframework.boot.autoconfigure.condition.ConditionalOnNotWebApplication;
import org.springframework.context.annotation.*;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.AccessTokens;

/** 本地维护命令需要身份服务编排，但不启动认证端点或签发访问令牌。 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnNotWebApplication
public class NonWebIdentityTokensConfiguration {
    @Bean AccessTokens commandTokens() {
        return (account, session, version, issued, expires) -> { throw new IllegalStateException("Commands cannot issue tokens"); };
    }
}

package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import java.util.Map;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
import org.xaspire.WuhouCake.audit.application.service.AuditService;
import org.xaspire.WuhouCake.audit.domain.port.AuditAccess;
import org.xaspire.WuhouCake.audit.domain.repository.Operations;
import org.xaspire.WuhouCake.audit.infrastructure.persistence.mapper.OperationMapper;
import org.xaspire.WuhouCake.audit.infrastructure.persistence.repository.PostgresOperations;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.identity.application.service.EmployeeAccessPolicy;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.*;
import org.xaspire.WuhouCake.identity.domain.repository.Accounts;
import org.xaspire.WuhouCake.identity.infrastructure.gateway.*;
import org.xaspire.WuhouCake.identity.infrastructure.persistence.mapper.AccountMapper;
import org.xaspire.WuhouCake.identity.infrastructure.persistence.repository.PostgresAccounts;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.xaspire.WuhouCake.identity.domain.model.valobj.AccountValues.Actor;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({IdentityProperties.class, EmployeeAccessProperties.class})
@MapperScan({"org.xaspire.WuhouCake.identity.infrastructure.persistence.mapper", "org.xaspire.WuhouCake.audit.infrastructure.persistence.mapper"})
public class IdentityComposition {
    @Bean Accounts accounts(AccountMapper mapper) { return new PostgresAccounts(mapper); }
    @Bean Operations operations(OperationMapper mapper, org.xaspire.WuhouCake.shared.json.JsonCodec json) { return new PostgresOperations(mapper, json); }
    @Bean Credentials credentials() {
        var argon2 = new Argon2PasswordEncoder(16, 32, 1, 19456, 2);
        return new SpringCredentials(new DelegatingPasswordEncoder("argon2id", Map.of("argon2id", argon2)));
    }
    @Bean Sessions sessions(StringRedisTemplate redis, Clock clock, IdentityProperties properties) { return new RedisSessions(redis, clock, properties.redisNamespace()); }
    @Bean Attempts attempts(StringRedisTemplate redis, IdentityProperties properties) { return new RedisAttempts(redis, properties.redisNamespace()); }
    @Bean ActorSource actors() {
        return () -> {
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication == null || !authentication.isAuthenticated() || !(authentication.getDetails() instanceof IdentityFacade.AccountView account))
                throw new IdentityFailure("AUTHENTICATION_FAILED");
            var request = RequestContextHolder.getRequestAttributes();
            String id = request instanceof ServletRequestAttributes attributes ? (String) attributes.getRequest().getAttribute("wuhoucake.requestId") : null;
            return new Actor(account.accountId(), account.credentialVersion(), id);
        };
    }
    @Bean AuditAccess auditAccess(ActorSource actors, Accounts accounts) {
        return () -> {
            var actor = actors.current();
            var account = accounts.find(actor.accountId()).orElseThrow(() -> new IdentityFailure("AUTHENTICATION_FAILED"));
            if (account.credentialVersion() != actor.credentialVersion()) throw new IdentityFailure("AUTHENTICATION_FAILED");
            account.requireAdministrator();
        };
    }
    @Bean AuditService auditService(Operations operations, AuditAccess access, IdGenerator ids) { return new AuditService(operations, access, ids); }
    @Bean EmployeeAccessPolicy employeeAccessPolicy(EmployeeAccessProperties properties) { return new EmployeeAccessPolicy(properties.jobPermissions()); }
    @Bean IdentityService identityService(Accounts accounts, Credentials credentials, Sessions sessions, Attempts attempts,
            AccessTokens tokens, ActorSource actors, AuditFacade audit, IdGenerator ids, Clock clock, IdentityProperties properties, ApplicationEventPublisher events, EmployeeAccessPolicy accessPolicy) {
        return new IdentityService(accounts, credentials, sessions, attempts, tokens, actors, audit, ids, clock, properties.accessLifetime(), properties.sessionLifetime(), events, accessPolicy);
    }
}

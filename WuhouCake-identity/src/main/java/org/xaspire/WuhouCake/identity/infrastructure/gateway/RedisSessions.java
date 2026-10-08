package org.xaspire.WuhouCake.identity.infrastructure.gateway;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.xaspire.WuhouCake.identity.domain.model.entity.LoginSession;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.Sessions;

public final class RedisSessions implements Sessions {
    private static final DefaultRedisScript<Long> SAVE = new DefaultRedisScript<>(
            "redis.call('HSET',KEYS[1],'account',ARGV[1],'version',ARGV[2],'hash',ARGV[3],'expires',ARGV[4]); "
                    + "redis.call('PEXPIRE',KEYS[1],ARGV[5]); return 1", Long.class);
    private final StringRedisTemplate redis;
    private final Clock clock;
    private final String namespace;
    public RedisSessions(StringRedisTemplate redis, Clock clock, String namespace) { this.redis = redis; this.clock = clock; this.namespace = namespace; }
    private String key(UUID id) { return namespace + ":session:" + id; }
    @Override public void save(LoginSession session) {
        long ttl = Duration.between(clock.instant(), session.expiresAt()).toMillis();
        if (ttl <= 0) throw new IllegalArgumentException("Expired session");
        redis.execute(SAVE, java.util.List.of(key(session.id())), session.accountId().toString(), Long.toString(session.credentialVersion()),
                session.refreshHash(), session.expiresAt().toString(), Long.toString(ttl));
    }
    @Override public Optional<LoginSession> find(UUID id) {
        Map<Object, Object> values = redis.opsForHash().entries(key(id));
        if (values.isEmpty()) return Optional.empty();
        return Optional.of(new LoginSession(id, UUID.fromString((String) values.get("account")), Long.parseLong((String) values.get("version")),
                (String) values.get("hash"), Instant.parse((String) values.get("expires"))));
    }
    @Override public void remove(UUID id) { redis.delete(key(id)); }
}

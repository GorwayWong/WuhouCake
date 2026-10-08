package org.xaspire.WuhouCake.shared.infrastructure.redis;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

/**
 * A non-reentrant lease lock. Callers supply a fresh ownership token for each acquisition.
 * Leases are not renewed; work must finish within the TTL. This lock provides no fencing.
 */
public final class RedisLock {
    private static final DefaultRedisScript<Long> RELEASE = new DefaultRedisScript<>(
            "if redis.call('get', KEYS[1]) == ARGV[1] then "
                    + "return redis.call('del', KEYS[1]) else return 0 end", Long.class);

    private final StringRedisTemplate redis;

    public RedisLock(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public boolean tryAcquire(String key, String token, Duration ttl) {
        Objects.requireNonNull(token);
        if (token.isBlank() || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("Ownership token and positive TTL are required");
        }
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key, token, ttl));
    }

    public boolean release(String key, String token) {
        return Long.valueOf(1).equals(redis.execute(RELEASE, List.of(key), token));
    }
}

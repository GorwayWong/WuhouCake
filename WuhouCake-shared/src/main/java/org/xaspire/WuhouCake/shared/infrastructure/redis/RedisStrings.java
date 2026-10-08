package org.xaspire.WuhouCake.shared.infrastructure.redis;

import java.time.Duration;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;

public final class RedisStrings {
    private final StringRedisTemplate redis;

    public RedisStrings(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public void put(String key, String value, Duration ttl) {
        if (ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("TTL must be positive");
        }
        redis.opsForValue().set(key, value, ttl);
    }

    public Optional<String> get(String key) {
        return Optional.ofNullable(redis.opsForValue().get(key));
    }

    public boolean delete(String key) {
        return Boolean.TRUE.equals(redis.delete(key));
    }
}

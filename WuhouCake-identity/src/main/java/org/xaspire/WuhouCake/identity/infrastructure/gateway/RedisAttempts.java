package org.xaspire.WuhouCake.identity.infrastructure.gateway;

import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.Attempts;

public final class RedisAttempts implements Attempts {
    private static final DefaultRedisScript<Long> FAILED = new DefaultRedisScript<>(
            "local n=redis.call('INCR',KEYS[1]); if n==1 or n==5 then redis.call('EXPIRE',KEYS[1],600) end; return n", Long.class);
    private final StringRedisTemplate redis;
    private final String namespace;
    public RedisAttempts(StringRedisTemplate redis, String namespace) { this.redis = redis; this.namespace = namespace; }
    private String key(String number) { return namespace + ":attempts:" + number; }
    @Override public void check(String number) {
        String count = redis.opsForValue().get(key(number));
        if (count != null && Long.parseLong(count) >= 5) throw new IdentityFailure("LOGIN_THROTTLED");
    }
    @Override public void failed(String number) { redis.execute(FAILED, List.of(key(number))); }
    @Override public void clear(String number) { redis.delete(key(number)); }
}

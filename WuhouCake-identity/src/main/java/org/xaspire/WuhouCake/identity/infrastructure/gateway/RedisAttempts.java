package org.xaspire.WuhouCake.identity.infrastructure.gateway;

import java.util.List;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.Attempts;

public final class RedisAttempts implements Attempts {
    private static final DefaultRedisScript<Long> BEGIN = new DefaultRedisScript<>("""
            local now=tonumber(redis.call('TIME')[1])
            redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now)
            local failed=tonumber(redis.call('GET',KEYS[1]) or '0')
            if failed+redis.call('ZCARD',KEYS[2])>=5 then return 0 end
            redis.call('ZADD',KEYS[2],now+600,ARGV[1])
            redis.call('EXPIRE',KEYS[2],600)
            return 1
            """, Long.class);
    private static final DefaultRedisScript<Long> FINISH = new DefaultRedisScript<>("""
            if redis.call('ZREM',KEYS[2],ARGV[1])==0 then return 0 end
            if ARGV[2]=='failed' then
                local n=redis.call('INCR',KEYS[1])
                if n==1 or n==5 then redis.call('EXPIRE',KEYS[1],600) end
            elseif ARGV[2]=='success' then redis.call('DEL',KEYS[1]) end
            return 1
            """, Long.class);
    private final StringRedisTemplate redis;
    private final String namespace;
    public RedisAttempts(StringRedisTemplate redis, String namespace) { this.redis = redis; this.namespace = namespace; }
    private String key(String number) { return namespace + ":attempts:" + number; }
    @Override public Attempt begin(String number) {
        var keys = List.of(key(number), key(number) + ":pending");
        String token = UUID.randomUUID().toString();
        if (!Long.valueOf(1).equals(redis.execute(BEGIN, keys, token))) throw new IdentityFailure("LOGIN_THROTTLED");
        return new Attempt() {
            private boolean finished;
            private void finish(String outcome) {
                if (!finished) {
                    redis.execute(FINISH, keys, token, outcome);
                    finished = true;
                }
            }
            @Override public void failed() { finish("failed"); }
            @Override public void succeeded() { finish("success"); }
            @Override public void close() { finish("release"); }
        };
    }
}

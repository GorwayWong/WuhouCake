package org.xaspire.WuhouCake.bootstrap.configuration;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import io.lettuce.core.ClientOptions;
import org.springframework.boot.autoconfigure.data.redis.LettuceClientOptionsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.id.UuidGenerator;
import org.xaspire.WuhouCake.shared.infrastructure.redis.RedisLock;
import org.xaspire.WuhouCake.shared.infrastructure.redis.RedisStrings;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

@Configuration(proxyBeanMethods = false)
public class SharedComposition {
    @Bean
    IdGenerator idGenerator() { return new UuidGenerator(); }

    @Bean
    Clock clock() { return Clock.systemUTC(); }

    @Bean
    JsonCodec jsonCodec(ObjectMapper mapper) { return new JsonCodec(mapper); }

    @Bean
    RedisStrings redisStrings(StringRedisTemplate redis) { return new RedisStrings(redis); }

    @Bean
    @Profile("prod")
    LettuceClientOptionsBuilderCustomizer redisAdmission() {
        return options -> options.requestQueueSize(64)
                .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)
                .replayFilter(command -> true);
    }

    @Bean
    RedisLock redisLock(StringRedisTemplate redis) { return new RedisLock(redis); }
}

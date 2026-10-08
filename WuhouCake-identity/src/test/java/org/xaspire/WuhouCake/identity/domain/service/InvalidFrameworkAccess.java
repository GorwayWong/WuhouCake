package org.xaspire.WuhouCake.identity.domain.service;
import org.springframework.data.redis.core.StringRedisTemplate;
public record InvalidFrameworkAccess(StringRedisTemplate redis) { }

package org.xaspire.WuhouCake.sample.domain.service;
import org.springframework.data.redis.core.StringRedisTemplate;
public record InvalidFrameworkAccess(StringRedisTemplate redis) { }

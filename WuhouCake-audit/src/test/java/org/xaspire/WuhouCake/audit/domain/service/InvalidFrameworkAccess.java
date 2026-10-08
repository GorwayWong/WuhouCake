package org.xaspire.WuhouCake.audit.domain.service;
import org.springframework.data.redis.core.StringRedisTemplate;
public record InvalidFrameworkAccess(StringRedisTemplate redis) { }

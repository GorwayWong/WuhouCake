package org.xaspire.WuhouCake.bootstrap.security;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.time.Clock;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.web.filter.OncePerRequestFilter;
import org.xaspire.WuhouCake.bootstrap.configuration.CustomerEntryProperties;

public final class CustomerEntryProtection extends OncePerRequestFilter {
    private static final DefaultRedisScript<Long> LIMIT = new DefaultRedisScript<>("""
            local minute = redis.call('INCR', KEYS[1])
            if minute == 1 then redis.call('EXPIRE', KEYS[1], 120) end
            local hour = redis.call('INCR', KEYS[2])
            if hour == 1 then redis.call('EXPIRE', KEYS[2], 7200) end
            if minute > tonumber(ARGV[1]) or hour > tonumber(ARGV[2]) then return 0 end
            return 1
            """, Long.class);
    private final StringRedisTemplate redis; private final CustomerEntryProperties properties;
    private final SecurityErrors errors; private final Clock clock; private final String namespace;
    public CustomerEntryProtection(StringRedisTemplate redis, CustomerEntryProperties properties, SecurityErrors errors, Clock clock, String namespace) {
        this.redis = redis; this.properties = properties; this.errors = errors; this.clock = clock; this.namespace = namespace;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getMethod().equals("POST") || !request.getRequestURI().matches("/api/public/order-entries/[^/]+/submissions");
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        long seconds = clock.instant().getEpochSecond(); String ip = clientAddress(request, properties.trustedProxies());
        String key = namespace + ":customer-entry:" + ip;
        try {
            Long allowed = redis.execute(LIMIT, List.of(key + ":m:" + seconds / 60, key + ":h:" + seconds / 3600), properties.perMinute().toString(), properties.perHour().toString());
            if (allowed == null) { errors.write(response, 503, "SERVICE_UNAVAILABLE"); return; }
            if (allowed == 0) { response.setHeader("Retry-After", "60"); errors.write(response, 429, "SUBMISSION_THROTTLED"); return; }
        } catch (org.springframework.dao.DataAccessException failure) { errors.write(response, 503, "SERVICE_UNAVAILABLE"); return; }
        byte[] body = request.getInputStream().readNBytes(properties.maxBodyBytes() + 1);
        if (body.length > properties.maxBodyBytes()) { errors.write(response, 413, "SUBMISSION_TOO_LARGE"); return; }
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() {
                var input = new ByteArrayInputStream(body);
                return new ServletInputStream() {
                    @Override public int read() { return input.read(); }
                    @Override public boolean isFinished() { return input.available() == 0; }
                    @Override public boolean isReady() { return true; }
                    @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                };
            }
            @Override public BufferedReader getReader() { return new BufferedReader(new InputStreamReader(getInputStream(), java.nio.charset.StandardCharsets.UTF_8)); }
        }, response);
    }
    static String clientAddress(HttpServletRequest request, List<String> trusted) {
        String current = request.getRemoteAddr();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (!trusted.contains(current) || forwarded == null || forwarded.length() > 1024) return current;
        var addresses = forwarded.split(",");
        for (int i = addresses.length - 1; i >= 0 && trusted.contains(current); i--) {
            String address = addresses[i].strip();
            if (!address.matches("[0-9a-fA-F:.]{3,45}")) return request.getRemoteAddr();
            current = address;
        }
        return current;
    }
}

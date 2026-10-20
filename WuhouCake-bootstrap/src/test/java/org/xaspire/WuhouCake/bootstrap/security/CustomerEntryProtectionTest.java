package org.xaspire.WuhouCake.bootstrap.security;

import java.time.Clock;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.xaspire.WuhouCake.bootstrap.configuration.CustomerEntryProperties;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CustomerEntryProtectionTest {
    @Test void forwardedAddressesAreOnlyAcceptedThroughExplicitTrustedHops() {
        var request = new MockHttpServletRequest(); request.setRemoteAddr("198.51.100.10"); request.addHeader("X-Forwarded-For", "1.1.1.1");
        assertEquals("198.51.100.10", CustomerEntryProtection.clientAddress(request, List.of()));
        request.setRemoteAddr("127.0.0.1"); request.removeHeader("X-Forwarded-For"); request.addHeader("X-Forwarded-For", "1.1.1.1, 198.51.100.20");
        assertEquals("198.51.100.20", CustomerEntryProtection.clientAddress(request, List.of("127.0.0.1")));
    }
    @Test void invalidOrOversizeBodiesAndRedisFailureNeverReachTheController() throws Exception {
        var redis = mock(StringRedisTemplate.class); var errors = new SecurityErrors(new com.fasterxml.jackson.databind.ObjectMapper());
        var filter = new CustomerEntryProtection(redis, new CustomerEntryProperties(null, 10, 100, 1024, null), errors, Clock.systemUTC(), "test");
        var request = new MockHttpServletRequest("POST", "/api/public/order-entries/token/submissions"); request.setContent(new byte[1025]);
        when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class))).thenReturn(1L);
        var response = new MockHttpServletResponse(); var chain = new MockFilterChain(); filter.doFilter(request, response, chain);
        assertEquals(413, response.getStatus()); assertNull(chain.getRequest());
        reset(redis); when(redis.execute(any(RedisScript.class), anyList(), any(Object[].class))).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("offline"));
        response = new MockHttpServletResponse(); chain = new MockFilterChain(); filter.doFilter(request, response, chain);
        assertEquals(503, response.getStatus()); assertNull(chain.getRequest());
    }
}

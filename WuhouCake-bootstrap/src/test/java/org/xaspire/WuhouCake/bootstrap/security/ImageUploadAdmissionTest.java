package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import static org.junit.jupiter.api.Assertions.*;

class ImageUploadAdmissionTest {
    private static MockHttpServletRequest upload(String path) {
        var request = new MockHttpServletRequest("POST", path); request.setContentType("multipart/form-data; boundary=test"); return request;
    }
    @Test void onlyOneUploadIsAdmittedAndOrdinaryReadsRemainAvailable() throws Exception {
        var filter = new ImageUploadAdmissionFilter(new ObjectMapper());
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> {
                filter.doFilter(upload("/api/order-packages"), new MockHttpServletResponse(), (request, response) -> {
                    entered.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException failure) { Thread.currentThread().interrupt(); }
                }); return null;
            });
            try {
                assertTrue(entered.await(2, TimeUnit.SECONDS));
                var busy = new MockHttpServletResponse();
                filter.doFilter(upload("/api/orders/order/images"), busy, (request, response) -> fail("multipart parser must not be invoked"));
                assertEquals(503, busy.getStatus()); assertEquals("2", busy.getHeader("Retry-After"));
                assertTrue(busy.getContentAsString().contains("IMAGE_PROCESSING_BUSY"));
                var read = new MockHttpServletResponse();
                filter.doFilter(new MockHttpServletRequest("GET", "/api/auth/csrf"), read, (request, response) -> response.getWriter().write("available"));
                assertEquals("available", read.getContentAsString());
            } finally { release.countDown(); }
            first.get(2, TimeUnit.SECONDS);
            var next = new MockHttpServletResponse();
            filter.doFilter(upload("/api/order-packages"), next, (request, response) -> response.getWriter().write("accepted"));
            assertEquals("accepted", next.getContentAsString());
        }
    }
}

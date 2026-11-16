package org.xaspire.WuhouCake.bootstrap.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import static org.junit.jupiter.api.Assertions.*;

class FileDownloadAdmissionTest {
    private final SimpleMeterRegistry metrics = new SimpleMeterRegistry();

    @Test void exportsShareOneSlotAndDisconnectReleasesIt() throws Exception {
        var filter = new FileDownloadAdmissionFilter(new ObjectMapper(), metrics);
        assertThrows(IOException.class, () -> filter.doFilter(
                new MockHttpServletRequest("GET", "/api/admin/orders/export"), new MockHttpServletResponse(), (request, response) -> {
                    var busy = new MockHttpServletResponse();
                    filter.doFilter(new MockHttpServletRequest("POST", "/api/orders/exports/zip"), busy, (r, s) -> fail("second export admitted"));
                    assertEquals(503, busy.getStatus());
                    assertTrue(busy.getContentAsString().contains("EXPORT_BUSY"));
                    filter.doFilter(new MockHttpServletRequest("GET", "/api/orders/order"), new MockHttpServletResponse(), (r, s) -> s.getWriter().write("available"));
                    throw new IOException("Client disconnected");
                }));
        var next = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("POST", "/api/orders/order/exports/xlsx"), next, (r, s) -> s.getWriter().write("available"));
        assertEquals("available", next.getContentAsString());
        assertEquals(1, metrics.counter("wuhou.files.rejected", "kind", "export").count());
    }

    @Test void orderAndPackageImageDownloadsShareTwoSlots() throws Exception {
        var filter = new FileDownloadAdmissionFilter(new ObjectMapper(), metrics);
        filter.doFilter(new MockHttpServletRequest("GET", "/api/orders/order/images/first"), new MockHttpServletResponse(),
                (r, s) -> filter.doFilter(new MockHttpServletRequest("GET", "/api/order-packages/package/items/item/images/second"),
                        new MockHttpServletResponse(), (request, response) -> {
                            var busy = new MockHttpServletResponse();
                            filter.doFilter(new MockHttpServletRequest("HEAD", "/api/orders/order/images/third"), busy,
                                    (other, result) -> fail("third image download admitted"));
                            assertEquals(503, busy.getStatus());
                        }));
        assertEquals(1, metrics.counter("wuhou.files.rejected", "kind", "image").count());
    }
}

package org.xaspire.WuhouCake.order.adapter.web;

import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletResponse;
import java.io.*;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.catalina.connector.ClientAbortException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.order.application.service.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderFileControllerTest {
    @TempDir Path directory;
    private final OrderExportService exports = mock(OrderExportService.class);
    private final OrderFileController controller = new OrderFileController(mock(OrderImageService.class), exports);
    private final UUID orderId = UUID.randomUUID();

    @Test void successfulDownloadDeletesFileAfterWriting() throws Exception {
        var file = prepared(); var response = new MockHttpServletResponse();
        doAnswer(invocation -> { Files.delete(Path.of(file.path())); return null; }).when(exports).delete(file);
        controller.single(orderId, operator(), response);
        assertEquals("file content", response.getContentAsString()); assertEquals("no-store", response.getHeader("Cache-Control"));
        assertFalse(Files.exists(Path.of(file.path()))); verify(exports).delete(file);
    }
    @Test void disconnectedClientStillDeletesFile() throws Exception {
        var file = prepared();
        var disconnected = new ClientAbortException(new SocketException("Connection reset by peer"));
        doAnswer(invocation -> { Files.delete(Path.of(file.path())); return null; }).when(exports).delete(file);
        assertSame(disconnected, assertThrows(IOException.class, () -> controller.single(orderId, operator(), disconnected(disconnected))));
        assertFalse(Files.exists(Path.of(file.path()))); verify(exports).delete(file);
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void tomcatSocketTimeoutDuringWriteOrFlushIsReportedAndDeletesFile(boolean flush) throws Exception {
        var file = prepared();
        var socketTimeout = new ClientAbortException(new SocketTimeoutException("response write timed out"));
        var response = flush ? mock(HttpServletResponse.class) : disconnected(socketTimeout);
        if (flush) {
            when(response.getOutputStream()).thenReturn(new MockHttpServletResponse().getOutputStream());
            doThrow(socketTimeout).when(response).flushBuffer();
        }
        doAnswer(invocation -> { Files.delete(Path.of(file.path())); return null; }).when(exports).delete(file);

        var timeout = assertThrows(OrderFileController.TransferTimeout.class,
                () -> controller.single(orderId, operator(), response));
        assertSame(socketTimeout, timeout.getCause());
        assertFalse(Files.exists(Path.of(file.path())));
    }
    @Test void slowFinalWriteTimesOutAndStillDeletesFile() throws Exception {
        var file = prepared();
        var time = new AtomicLong();
        var response = new MockHttpServletResponse() {
            @Override public ServletOutputStream getOutputStream() {
                return new ServletOutputStream() {
                    @Override public boolean isReady() { return true; }
                    @Override public void setWriteListener(WriteListener listener) { }
                    @Override public void write(int value) { time.set(java.time.Duration.ofSeconds(30).toNanos()); }
                };
            }
        };
        doAnswer(invocation -> { Files.delete(Path.of(file.path())); return null; }).when(exports).delete(file);
        assertThrows(OrderFileController.TransferTimeout.class,
                () -> OrderFileController.download(file, response, exports, time::get));
        assertFalse(Files.exists(Path.of(file.path())));
    }
    @Test void cleanupFailureDoesNotHideDownloadFailure() throws Exception {
        var file = prepared(); var disconnected = new IOException("client disconnected");
        var cleanup = new UncheckedIOException(new IOException("delete failed"));
        doThrow(cleanup).when(exports).delete(file);
        var failure = assertThrows(IOException.class, () -> controller.single(orderId, operator(), disconnected(disconnected)));
        assertSame(disconnected, failure); assertArrayEquals(new Throwable[] {cleanup}, failure.getSuppressed());
        verify(exports).delete(file);
    }
    private OrderExportService.Download prepared() throws IOException {
        var path = directory.resolve("order.xlsx"); Files.writeString(path, "file content");
        var file = new OrderExportService.Download(path.toString(), "order.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Files.size(path));
        when(exports.single(eq(orderId), any())).thenReturn(file); return file;
    }
    private static HttpServletResponse disconnected(IOException failure) throws IOException {
        var response = mock(HttpServletResponse.class);
        when(response.getOutputStream()).thenReturn(new ServletOutputStream() {
            @Override public boolean isReady() { return true; }
            @Override public void setWriteListener(WriteListener listener) { }
            @Override public void write(int value) throws IOException { throw failure; }
        });
        return response;
    }
    private static Authentication operator() {
        var authentication = mock(Authentication.class);
        when(authentication.getDetails()).thenReturn(new IdentityFacade.AccountView(UUID.randomUUID(), "0002", "员工", Set.of("FRONT_DESK"),
                "STAFF", "ACTIVE", false, 0, Instant.now(), null));
        return authentication;
    }
}

package org.xaspire.WuhouCake.bootstrap.security;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.io.*;
import java.lang.reflect.*;
import java.net.SocketException;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.http.converter.StringHttpMessageConverter;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.xaspire.WuhouCake.shared.response.ApiResponse;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiErrorsTest {
    private final Endpoints endpoints = new Endpoints();
    private final ErrorConverter json = new ErrorConverter();
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private final Logger logger = (Logger) LoggerFactory.getLogger(ApiErrors.class);
    private Level previous;
    private MockMvc mvc;
    private final String requestId = UUID.randomUUID().toString();

    @BeforeEach void setup() {
        previous = logger.getLevel(); logger.setLevel(Level.DEBUG); logs.start(); logger.addAppender(logs);
        mvc = MockMvcBuilders.standaloneSetup(endpoints).setControllerAdvice(new ApiErrors())
                .setMessageConverters(new StringHttpMessageConverter(), json).build();
    }
    @AfterEach void close() { logger.detachAppender(logs); logs.stop(); logger.setLevel(previous); }
    static Stream<Arguments> disconnects() {
        return Stream.of(
                Arguments.of(new AsyncRequestNotUsableException("Response not usable after async completion")),
                Arguments.of(new AsyncRequestNotUsableException("ServletOutputStream failed", new IOException("Broken pipe"))),
                Arguments.of(new IllegalStateException("async wrapper", new SocketException("Connection reset by peer"))),
                Arguments.of(new EOFException("client disconnected")));
    }
    private MvcResult stream(boolean ready) throws Exception {
        return mvc.perform(get("/events").param("ready", Boolean.toString(ready)).accept(MediaType.TEXT_EVENT_STREAM)
                        .requestAttr("wuhoucake.requestId", requestId))
                .andExpect(status().isOk()).andExpect(request().asyncStarted()).andReturn();
    }
    @ParameterizedTest @MethodSource("disconnects")
    void disconnectedStreamIsHandledWithoutErrorLogOrJsonConversion(Exception failure) throws Exception {
        var started = stream(true); String before = started.getResponse().getContentAsString();
        assertTrue(started.getResponse().isCommitted()); assertTrue(before.contains("event:ready"));
        endpoints.emitter.completeWithError(failure);
        mvc.perform(asyncDispatch(started)).andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM));
        assertEquals(before, started.getResponse().getContentAsString()); assertEquals(0, json.errorAttempts);
        assertTrue(events(Level.ERROR).isEmpty()); assertEquals(1, events(Level.DEBUG).size());
    }
    @Test void disconnectBeforeTheFirstFlushDoesNotAttemptAnErrorBody() throws Exception {
        var started = stream(false); assertFalse(started.getResponse().isCommitted());
        endpoints.emitter.completeWithError(new AsyncRequestNotUsableException("response unusable before first flush"));
        mvc.perform(asyncDispatch(started));
        assertEquals("", started.getResponse().getContentAsString()); assertEquals(0, json.errorAttempts);
        assertTrue(events(Level.ERROR).isEmpty()); assertEquals(1, events(Level.DEBUG).size());
    }
    static Stream<Arguments> serverFailures() {
        return Stream.of(Arguments.of(new IllegalStateException("synthetic server failure")),
                Arguments.of(new IOException("synthetic local file failure")),
                Arguments.of(new ResourceAccessException("upstream unavailable", new IOException("Broken pipe"))));
    }
    @ParameterizedTest @MethodSource("serverFailures")
    void genuineFailureAfterReadyStillLogsErrorButDoesNotRewriteCommittedSse(Exception failure) throws Exception {
        var started = stream(true); String before = started.getResponse().getContentAsString();
        endpoints.emitter.completeWithError(failure); mvc.perform(asyncDispatch(started));
        assertEquals(before, started.getResponse().getContentAsString()); assertEquals(0, json.errorAttempts);
        assertEquals(1, events(Level.ERROR).size()); assertTrue(events(Level.DEBUG).isEmpty());
    }
    @Test void genuineFailureBeforeReadyStillReturns500JsonEvenWhenSseWasNegotiated() throws Exception {
        var started = stream(false); endpoints.emitter.completeWithError(new IllegalStateException("synthetic server failure"));
        mvc.perform(asyncDispatch(started)).andExpect(status().isInternalServerError())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)).andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
        assertTrue(json.errorAttempts > 0); assertEquals(1, events(Level.ERROR).size());
    }
    @Test void localFileEofBeforeAsyncHandlingIsNotMistakenForClientDisconnect() throws Exception {
        mvc.perform(get("/file-eof").requestAttr("wuhoucake.requestId", requestId)).andExpect(status().isInternalServerError())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON)).andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
        assertTrue(json.errorAttempts > 0); assertEquals(1, events(Level.ERROR).size()); assertTrue(events(Level.DEBUG).isEmpty());
    }
    private List<ILoggingEvent> events(Level level) {
        return logs.list.stream().filter(event -> event.getLevel().equals(level) && event.getFormattedMessage().contains(requestId)).toList();
    }
    static final class ErrorConverter extends MappingJackson2HttpMessageConverter {
        int errorAttempts;
        @Override public boolean canWrite(Type type, Class<?> context, MediaType mediaType) {
            if (type == ApiResponse.class || type instanceof ParameterizedType parameterized && parameterized.getRawType() == ApiResponse.class) errorAttempts++;
            return super.canWrite(type, context, mediaType);
        }
    }
    @RestController static class Endpoints {
        private SseEmitter emitter;
        @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
        SseEmitter events(@RequestParam(defaultValue = "true") boolean ready) throws IOException {
            emitter = new SseEmitter(10000L);
            if (ready) emitter.send(SseEmitter.event().name("ready").data(Map.of()));
            return emitter;
        }
        @GetMapping("/file-eof") void fileEof() throws IOException { throw new EOFException("synthetic local file EOF"); }
    }
}

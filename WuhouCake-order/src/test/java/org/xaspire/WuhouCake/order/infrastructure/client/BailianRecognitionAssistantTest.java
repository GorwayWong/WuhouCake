package org.xaspire.WuhouCake.order.infrastructure.client;

import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.xaspire.WuhouCake.order.domain.model.valobj.RecognitionDraft.Fragment;
import static org.junit.jupiter.api.Assertions.*;

class BailianRecognitionAssistantTest {
    private final ObjectMapper json = new ObjectMapper();
    private HttpServer server; private ExecutorService executor;
    private final AtomicInteger requests = new AtomicInteger();
    private final AtomicReference<String> payload = new AtomicReference<>();
    private final AtomicReference<String> authorization = new AtomicReference<>();
    private final AtomicReference<Reply> reply = new AtomicReference<>();
    private final AtomicReference<CountDownLatch> block = new AtomicReference<>();
    private final CountDownLatch arrived = new CountDownLatch(1);
    record Reply(int status, String body) { }
    @BeforeEach void start() throws Exception {
        reply.set(new Reply(200, envelope("{\"suggestions\":[{\"itemId\":\"item-1\",\"field\":\"flavor\",\"value\":\"动物奶油\",\"evidence\":\"奶油用动物的\"}]}")));
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0); executor = Executors.newVirtualThreadPerTaskExecutor(); server.setExecutor(executor);
        server.createContext("/v1/chat/completions", exchange -> {
            requests.incrementAndGet(); payload.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization")); arrived.countDown();
            var latch = block.get();
            try { if (latch != null && !latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("test response release missing"); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); exchange.close(); return; }
            var response = reply.get(); byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json"); exchange.sendResponseHeaders(response.status(), bytes.length);
            try (var output = exchange.getResponseBody()) { output.write(bytes); }
        });
        server.start();
    }
    @AfterEach void stop() { var latch = block.get(); if (latch != null) latch.countDown(); server.stop(0); executor.close(); }
    private String envelope(String content) throws Exception { return json.writeValueAsString(Map.of("choices", List.of(Map.of("finish_reason", "stop", "message", Map.of("content", content))))); }
    private BailianRecognitionAssistant client(long timeout, int concurrent) throws Exception {
        try (var input = getClass().getResourceAsStream("/order/recognition-assist-schema.json")) {
            return new BailianRecognitionAssistant(new BailianRecognitionAssistant.Settings(true, "synthetic-key",
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/v1", "qwen3.7-flash", timeout, concurrent), json, json.readTree(input));
        }
    }
    private List<Fragment> fragments() { return List.of(new Fragment("item-1", "奶油用动物的")); }
    @Test void usesStrictSchemaNonThinkingAndOnlyProvidedFragments() throws Exception {
        try (var client = client(2000, 1)) {
            var result = client.suggest(fragments()); assertEquals("OK", result.status()); assertEquals(1, result.suggestions().size());
            assertEquals("动物奶油", result.suggestions().getFirst().value()); assertEquals("Bearer synthetic-key", authorization.get());
            JsonNode body = json.readTree(payload.get()); assertEquals("qwen3.7-flash", body.path("model").asText());
            assertFalse(body.path("enable_thinking").asBoolean(true)); assertTrue(body.at("/response_format/json_schema/strict").asBoolean());
            assertEquals("json_schema", body.at("/response_format/type").asText());
            assertEquals(1, json.readTree(body.at("/messages/1/content").asText()).size()); assertEquals(1, requests.get());
        }
    }
    @ParameterizedTest @ValueSource(strings = {"not json", "{}", "{\"suggestions\":{}}", "{\"suggestions\":[],\"paymentStatus\":\"PAID\"}", "{\"suggestions\":[]} trailing"})
    void malformedResponsesDegradeWithoutRetry(String content) throws Exception {
        reply.set(new Reply(200, envelope(content)));
        try (var client = client(2000, 1)) { var result = client.suggest(fragments()); assertEquals("INVALID_RESPONSE", result.status()); assertTrue(result.suggestions().isEmpty()); assertEquals(1, requests.get()); }
    }
    @Test void invalidSuggestionDoesNotDiscardOtherValidSuggestions() throws Exception {
        reply.set(new Reply(200, envelope("{\"suggestions\":[{\"itemId\":\"item-1\",\"field\":\"flavor\",\"value\":\"动物奶油\",\"evidence\":\"奶油用动物的\"},{\"itemId\":\"item-1\",\"field\":\"paymentStatus\",\"value\":1,\"evidence\":\"假\"}]}")));
        try (var client = client(2000, 1)) { var result = client.suggest(fragments()); assertEquals(1, result.suggestions().size()); assertEquals(1, result.issues().size()); }
    }
    @ParameterizedTest @ValueSource(ints = {400, 429, 500})
    void providerFailuresDoNotRetry(int status) throws Exception {
        reply.set(new Reply(status, "{\"sensitive\":\"must not be echoed\"}"));
        try (var client = client(2000, 1)) {
            var result = client.suggest(fragments()); assertEquals(status == 429 ? "RATE_LIMITED" : "UNAVAILABLE", result.status());
            assertFalse(result.issues().toString().contains("sensitive")); assertEquals(1, requests.get());
        }
    }
    @Test void timeoutReturnsPartialFallbackAndReleasesConcurrencySlot() throws Exception {
        var release = new CountDownLatch(1); block.set(release);
        try (var client = client(150, 1)) {
            try { assertEquals("UNAVAILABLE", client.suggest(fragments()).status()); assertTrue(arrived.await(2, TimeUnit.SECONDS)); assertEquals(1, requests.get()); }
            finally { release.countDown(); block.set(null); }
            assertEquals("OK", client.suggest(fragments()).status()); assertEquals(2, requests.get());
        }
    }
    @Test void concurrencyIsBoundedWithoutQueueOrDuplicateRequests() throws Exception {
        var release = new CountDownLatch(1); block.set(release);
        try (var client = client(3000, 1); var calls = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = calls.submit(() -> client.suggest(fragments()));
            try {
                assertTrue(arrived.await(2, TimeUnit.SECONDS)); assertEquals("BUSY", client.suggest(fragments()).status()); assertEquals(1, requests.get());
            } finally { release.countDown(); block.set(null); }
            assertEquals("OK", first.get(3, TimeUnit.SECONDS).status());
            assertEquals("OK", client.suggest(fragments()).status()); assertEquals(2, requests.get());
        }
    }
    @Test void disabledAndMisconfiguredAssistCannotBreakManualUseOrLeakSettings() throws Exception {
        try (var input = getClass().getResourceAsStream("/order/recognition-assist-schema.json")) {
            var settings = new BailianRecognitionAssistant.Settings(false, "secret-test-key", "", "qwen3.7-flash", 8000, 2);
            assertFalse(settings.toString().contains("secret-test-key"));
            try (var client = new BailianRecognitionAssistant(settings, json, json.readTree(input))) {
                assertFalse(client.available()); assertEquals("DISABLED", client.suggest(fragments()).status()); assertEquals(0, requests.get());
            }
        }
    }
    @Test void unsupportedSchemaKeywordsAreExplicitProgrammingErrors() throws Exception {
        var invalid = json.readTree("{\"type\":\"string\",\"$ref\":\"https://example.invalid/schema\"}");
        assertThrows(IllegalArgumentException.class, () -> RecognitionSchema.check(invalid));
    }
}

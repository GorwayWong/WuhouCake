package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("integration")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CustomerSubmissionIT {
    private static final String SCHEMA = "customer_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:customer-it:" + UUID.randomUUID();
    private static final String INITIAL = "Initial password for test!", PASSWORD = "Permanent password for test!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        JwtTestKeys.properties(registry);
        registry.add("spring.flyway.default-schema", () -> SCHEMA); registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.datasource.hikari.schema", () -> SCHEMA); registry.add("wuhoucake.identity.redis-namespace", () -> NAMESPACE);
    }
    @LocalServerPort int port;
    @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc; @Autowired StringRedisTemplate redis; @Autowired IdentityService identity;
    @MockitoSpyBean CustomerSubmissions store;
    @BeforeEach void clean() {
        reset(store); jdbc.execute("TRUNCATE customer_order_entry,customer_order_submission,customer_submission_activity,cake_order,identity_account,audit_operation CASCADE");
        clearRedis();
    }
    @AfterAll void cleanup() { reset(store); clearRedis(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE"); }
    private void clearRedis() { var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys); }

    @Test void anonymousMultiProductRequirementsRemainOutsideOrdersUntilExplicitConfirmation() throws Exception {
        var staff = admin(); String token = entry(staff); var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        var receipt = submit(token, input, UUID.randomUUID()); String id = receipt.at("/data/submissionId").asText();
        assertEquals(0, count("cake_order")); assertEquals(1, count("customer_order_submission"));
        var detail = staff.data("GET", "/api/customer-submissions/" + id, null);
        assertEquals("客户（手机号未验证）", detail.at("/activities/0/actorName").asText());
        assertTrue(detail.at("/activities/0/actorId").isNull()); assertEquals("CUSTOMER", detail.at("/activities/0/actorType").asText());
        assertEquals("原味", detail.at("/submission/original/items/0/attributes/base").asText());
        assertFalse(detail.at("/submission/original/items/1/attributes").has("base"));
        var review = review(input, staff.id, 12300);
        assertEquals(400, staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 0)).status);
        staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review));
        var confirmed = staff.data("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1));
        String orderId = confirmed.at("/submission/orderId").asText(); assertEquals(1, count("cake_order"));
        var order = staff.data("GET", "/api/orders/" + orderId, null);
        assertEquals(staff.id, order.at("/creditedEmployee/accountId").asText()); assertEquals(staff.id, order.path("createdBy").asText());
        assertEquals("WAITING_PRODUCTION", order.path("status").asText()); assertEquals("UNPAID", order.path("paymentStatus").asText());
        assertEquals(12300, order.path("totalAmountCents").asLong()); assertEquals(2, order.path("items").size());
        assertEquals("2026-11-02T08:00:00Z", order.at("/fulfillment/plannedHandoffAt").asText());
        assertEquals("CUSTOMER_SUBMITTED", jdbc.queryForObject("SELECT source FROM cake_order WHERE id=?::uuid", String.class, orderId));
        var log = staff.data("GET", "/api/orders/" + orderId + "/activities", null).at("/items/0");
        assertEquals("CUSTOMER_SUBMITTED", log.at("/details/source").asText()); assertEquals(staff.id, log.path("actorId").asText());
        var origin = staff.data("GET", "/api/orders/" + orderId + "/customer-origin", null);
        assertEquals(id, origin.path("submissionId").asText()); assertEquals("2026-11-02T10:00:00Z", origin.path("requestedReceiveAt").asText());
        assertEquals(orderId, staff.data("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).at("/submission/orderId").asText());
        assertEquals(409, staff.request("DELETE", "/api/customer-submissions/" + id, Map.of("expectedVersion", 2)).status);
    }
    @Test void publicRequestsRejectInternalFieldsAndExposeNoReadOrModificationCapabilities() throws Exception {
        var staff = admin(); String token = entry(staff); var client = new Client(); var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        for (String field : List.of("totalAmountCents", "creditedEmployeeId", "source", "status")) {
            var injected = new LinkedHashMap<>(input); injected.put(field, "0"); assertEquals(400, client.request("POST", submitPath(token), injected, UUID.randomUUID().toString()).status);
        }
        var id = submit(token, input, UUID.randomUUID()).at("/data/submissionId").asText();
        assertEquals(401, client.request("GET", "/api/customer-submissions/" + id, null).status);
        assertEquals(401, client.request("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0)).status);
        assertTrue(client.request("GET", submitPath(token) + "/" + id, null).status >= 400);
        assertEquals(400, client.request("POST", submitPath(token), input).status);
        assertEquals(0, count("cake_order")); assertEquals(1, count("customer_order_submission"));
    }
    @Test void sameRequestIsIdempotentButNewRequestsAreRetainedAndLatestRequiresAcknowledgement() throws Exception {
        var staff = admin(); String token = entry(staff); var input = content("13800000000", "2026-11-02T18:00:00+08:00"); var key = UUID.randomUUID();
        String first = submit(token, input, key).at("/data/submissionId").asText();
        assertEquals(first, submit(token, input, key).at("/data/submissionId").asText());
        assertEquals(409, new Client().request("POST", submitPath(token), content("13800000001", "2026-11-02T18:00:00+08:00"), key.toString()).status);
        String second = submit(token, input, UUID.randomUUID()).at("/data/submissionId").asText();
        submit(token, content("13800000000", "2026-11-03T18:00:00+08:00"), UUID.randomUUID());
        assertEquals(3, count("customer_order_submission"));
        assertEquals(second, staff.data("GET", "/api/customer-submissions/" + first, null).path("newerSubmissionId").asText());
        staff.data("PATCH", "/api/customer-submissions/" + first, Map.of("expectedVersion", 0, "review", review(input, staff.id, 12300)));
        assertEquals(409, staff.request("POST", "/api/customer-submissions/" + first + "/confirm", Map.of("expectedVersion", 1)).status);
        assertEquals(200, staff.request("POST", "/api/customer-submissions/" + first + "/confirm", Map.of("expectedVersion", 1, "acknowledgedNewerSubmissionId", second)).status);
        staff.data("DELETE", "/api/customer-submissions/" + second, Map.of("expectedVersion", 0));
        assertEquals("DELETED", staff.data("GET", "/api/customer-submissions/" + second, null).at("/submission/status").asText());
        assertEquals(3, count("customer_order_submission")); assertEquals(1, staff.data("GET", "/api/customer-submissions?mine=false", null).path("total").asInt());
    }
    @Test void anotherFrontDeskCanConfirmWithoutCreditingTheEntryOwnerAndChefsCannotHandleSubmissions() throws Exception {
        var admin = admin(); var front = employee(admin, "0002", "FRONT_DESK"); var chef = employee(admin, "0003", "PASTRY_CHEF");
        var input = content("13800000000", "2026-11-02T18:00:00+08:00"); String id = submit(entry(front), input, UUID.randomUUID()).at("/data/submissionId").asText();
        assertEquals(403, chef.request("GET", "/api/customer-submissions?mine=false", null).status);
        assertEquals(403, chef.request("GET", "/api/customer-submissions/" + id, null).status);
        assertEquals(403, chef.request("POST", "/api/customer-submissions/entry", Map.of("action", "CREATE")).status);
        assertEquals(0, admin.data("GET", "/api/customer-submissions", null).path("total").asInt());
        assertEquals(1, admin.data("GET", "/api/customer-submissions?mine=false", null).path("total").asInt());
        admin.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review(input, admin.id, 10000)));
        String orderId = admin.data("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).at("/submission/orderId").asText();
        assertEquals(admin.id, admin.data("GET", "/api/orders/" + orderId, null).at("/creditedEmployee/accountId").asText());
        assertEquals(front.id, admin.data("GET", "/api/orders/" + orderId + "/customer-origin", null).path("entryOwnerId").asText());
    }
    @Test void resetDisableAndArchivedOwnerRejectNewSubmissionsButKeepExistingRequirements() throws Exception {
        var admin = admin(); var front = employee(admin, "0002", "FRONT_DESK"); String old = entry(front);
        submit(old, content("13800000000", "2026-11-02T18:00:00+08:00"), UUID.randomUUID());
        front.data("POST", "/api/customer-submissions/entry", Map.of("action", "DISABLE"));
        assertEquals(404, new Client().request("GET", "/api/public/order-entries/" + old, null).status);
        front.data("POST", "/api/customer-submissions/entry", Map.of("action", "RESET"));
        assertEquals(404, new Client().request("POST", submitPath(old), content("13800000000", "2026-11-02T18:00:00+08:00"), UUID.randomUUID().toString()).status);
        String current = entry(front); assertNotEquals(old, current);
        admin.data("POST", "/api/admin/employees/" + front.id + "/archive", Map.of());
        assertEquals(404, new Client().request("GET", "/api/public/order-entries/" + current, null).status);
        assertEquals(1, admin.data("GET", "/api/customer-submissions?mine=false", null).path("total").asInt());
    }
    @Test void concurrentConfirmationsCreateExactlyOneOrderAndReturnTheSameResult() throws Exception {
        var staff = admin(); var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        String id = submit(entry(staff), input, UUID.randomUUID()).at("/data/submissionId").asText();
        staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review(input, staff.id, 10000)));
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1); var a = pool.submit(() -> { start.await(); return staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)); });
            var b = pool.submit(() -> { start.await(); return staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)); }); start.countDown();
            var first = a.get(15, TimeUnit.SECONDS); var second = b.get(15, TimeUnit.SECONDS);
            assertEquals(200, first.status); assertEquals(200, second.status); assertEquals(first.body.at("/data/submission/orderId"), second.body.at("/data/submission/orderId"));
        }
        assertEquals(1, count("cake_order"));
    }
    @Test void confirmationLogFailureRollsBackOrderAndSubmissionTogether() throws Exception {
        var staff = admin(); var input = content("13800000000", "2026-11-02T18:00:00+08:00"); String id = submit(entry(staff), input, UUID.randomUUID()).at("/data/submissionId").asText();
        staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review(input, staff.id, 10000)));
        doThrow(new DataAccessResourceFailureException("log offline")).when(store).append(any(), eq("CONFIRMED"), any(), anyString(), anyMap(), any());
        assertEquals(503, staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).status); reset(store);
        assertEquals(0, count("cake_order")); assertEquals("PENDING", staff.data("GET", "/api/customer-submissions/" + id, null).at("/submission/status").asText());
        assertEquals(1, staff.data("GET", "/api/customer-submissions/" + id, null).at("/submission/version").asLong());
    }
    @Test void sourceIpIsRateLimitedWithoutBlockingByCustomerPhone() throws Exception {
        var staff = admin(); String token = entry(staff);
        for (int i = 0; i < 10; i++) submit(token, content("1380000000" + i, "2026-11-02T18:00:00+08:00"), UUID.randomUUID());
        assertEquals(429, new Client().request("POST", submitPath(token), content("13800000099", "2026-11-02T18:00:00+08:00"), UUID.randomUUID().toString()).status);
        assertEquals(10, count("customer_order_submission"));
    }
    @Test void reviewPreservesOriginalAndRejectsStaleVersionsAndIncompleteConfirmation() throws Exception {
        var staff = admin(); var original = content("13800000000", "2026-11-02T18:00:00+08:00");
        String id = submit(entry(staff), original, UUID.randomUUID()).at("/data/submissionId").asText();
        var changed = new LinkedHashMap<>(original); changed.put("address", "核对后的合成地址");
        var draft = new LinkedHashMap<String, Object>(); draft.put("content", changed);
        var saved = staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", draft));
        assertEquals("合成地址", saved.at("/submission/original/address").asText());
        assertEquals("核对后的合成地址", saved.at("/submission/reviewed/content/address").asText());
        assertEquals("合成地址", saved.at("/activities/0/details/customerFieldChanges/address/before").asText());
        assertEquals("核对后的合成地址", saved.at("/activities/0/details/customerFieldChanges/address/after").asText());
        assertEquals(409, staff.request("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", draft)).status);
        assertEquals(400, staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).status);
        assertEquals(0, count("cake_order"));
        var fractional = new LinkedHashMap<>(review(changed, staff.id, 12300)); fractional.put("totalAmountCents", 1.5);
        assertEquals(400, staff.request("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 1, "review", fractional)).status);
        var stats = staff.data("GET", "/api/admin/orders?from=2026-11-01&to=2026-11-04", null);
        assertEquals(0, stats.at("/totals/orderCount").asInt());
    }
    @Test void concurrentIdenticalAnonymousRequestsHaveOneReceiptAndOneSubmissionActivity() throws Exception {
        var staff = admin(); String token = entry(staff); String key = UUID.randomUUID().toString(); var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1); var a = pool.submit(() -> { start.await(); return new Client().request("POST", submitPath(token), input, key); });
            var b = pool.submit(() -> { start.await(); return new Client().request("POST", submitPath(token), input, key); }); start.countDown();
            var first = a.get(15, TimeUnit.SECONDS); var second = b.get(15, TimeUnit.SECONDS);
            assertEquals(201, first.status, first.body.toString()); assertEquals(201, second.status, second.body.toString()); assertEquals(first.body, second.body);
        }
        assertEquals(1, count("customer_order_submission")); assertEquals(1, count("customer_submission_activity"));
    }
    @Test void confirmationAndDeletionRaceHasOneConsistentWinner() throws Exception {
        var staff = admin(); var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        String id = submit(entry(staff), input, UUID.randomUUID()).at("/data/submissionId").asText();
        staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review(input, staff.id, 10000)));
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1); var a = pool.submit(() -> { start.await(); return staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)); });
            var b = pool.submit(() -> { start.await(); return staff.request("DELETE", "/api/customer-submissions/" + id, Map.of("expectedVersion", 1)); }); start.countDown();
            var first = a.get(15, TimeUnit.SECONDS); var second = b.get(15, TimeUnit.SECONDS);
            assertEquals(Set.of(200, 409), Set.of(first.status, second.status));
        }
        var data = staff.data("GET", "/api/customer-submissions/" + id, null).path("submission");
        assertEquals(2, data.path("version").asLong()); assertEquals(data.path("status").asText().equals("CONFIRMED") ? 1 : 0, count("cake_order"));
    }
    private long count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class); }
    private String entry(Client staff) throws Exception { return staff.data("POST", "/api/customer-submissions/entry", Map.of("action", "CREATE")).path("url").asText().split("/fill/")[1]; }
    private static String submitPath(String token) { return "/api/public/order-entries/" + token + "/submissions"; }
    private JsonNode submit(String token, Object input, UUID key) throws Exception { var result = new Client().request("POST", submitPath(token), input, key.toString()); assertEquals(201, result.status, result.body.toString()); return result.body; }
    private static Map<String, Object> content(String phone, String at) {
        return Map.of("phone", phone, "memberPhone", "13800000088", "fulfillmentType", "DELIVERY", "address", "合成地址", "requestedReceiveAt", at,
                "items", List.of(Map.of("name", "生日蛋糕", "productType", "CAKE", "quantity", 1, "attributes", Map.of("size", "8", "filling", "芒果，奥利奥", "message", "生日快乐")),
                Map.of("name", "纸杯蛋糕", "productType", "CUPCAKE", "quantity", 6, "attributes", Map.of("filling", "香草"))));
    }
    private static Map<String, Object> review(Object content, String creditedId, long amount) {
        return Map.of("content", content, "totalAmountCents", amount, "creditedEmployeeId", creditedId, "plannedHandoffAt", "2026-11-02T16:00:00+08:00");
    }
    private Client admin() throws Exception {
        identity.initializeAdministrator("0001", "店长", INITIAL); var client = new Client(); client.login("0001", INITIAL);
        client.data("POST", "/api/me/password", Map.of("currentPassword", INITIAL, "newPassword", PASSWORD)); client.login("0001", PASSWORD);
        client.id = client.data("GET", "/api/me", null).path("accountId").asText(); return client;
    }
    private Client employee(Client admin, String number, String role) throws Exception {
        var provisioned = admin.data("POST", "/api/admin/employees", Map.of("employeeNumber", number, "nickname", role, "jobRoles", List.of(role), "systemRole", "STAFF"));
        String temporary = provisioned.path("temporaryPassword").asText(); var client = new Client(); client.login(number, temporary);
        client.data("POST", "/api/me/password", Map.of("currentPassword", temporary, "newPassword", PASSWORD)); client.login(number, PASSWORD);
        client.id = provisioned.at("/account/accountId").asText(); return client;
    }
    record Result(int status, JsonNode body) { }
    final class Client {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build(); String token; String id;
        void login(String number, String password) throws Exception { token = data("POST", "/api/auth/login", Map.of("employeeNumber", number, "password", password)).path("accessToken").asText(); }
        JsonNode data(String method, String path, Object body) throws Exception { var result = request(method, path, body); assertTrue(result.status >= 200 && result.status < 300, result.body.toString()); return result.body.path("data"); }
        Result request(String method, String path, Object body) throws Exception { return request(method, path, body, null); }
        Result request(String method, String path, Object body, String key) throws Exception {
            boolean auth = path.startsWith("/api/auth/"); if (auth && !method.equals("GET")) request("GET", "/api/auth/csrf", null);
            var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(java.time.Duration.ofSeconds(20)).header("Content-Type", "application/json");
            if (token != null && !auth) builder.header("Authorization", "Bearer " + token); if (key != null) builder.header("Idempotency-Key", key);
            if (auth && !method.equals("GET")) cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("XSRF-TOKEN")).findFirst().ifPresent(c -> builder.header("X-XSRF-TOKEN", c.getValue()));
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            var response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString()); return new Result(response.statusCode(), json.readTree(response.body()));
        }
    }
}

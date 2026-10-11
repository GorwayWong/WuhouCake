package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
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
import org.xaspire.WuhouCake.order.domain.repository.OrderActivities;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("integration")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OrderIT {
    private static final String SCHEMA = "order_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:order-it:" + UUID.randomUUID();
    private static final String INITIAL = "Initial password for test!";
    private static final String PASSWORD = "Permanent password for test!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        JwtTestKeys.properties(registry);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.datasource.hikari.schema", () -> SCHEMA);
        registry.add("wuhoucake.identity.redis-namespace", () -> NAMESPACE);
    }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired IdentityService identity;
    @MockitoSpyBean OrderActivities activities;
    @MockitoSpyBean Clock clock;
    @BeforeEach void clean() {
        reset(activities, clock);
        jdbc.execute("TRUNCATE cake_order_activity, cake_order_item, cake_order, audit_operation, identity_account_role, identity_account CASCADE");
        clearSessions();
    }
    @AfterAll void removeTestData() {
        reset(activities, clock); clearSessions();
        jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE");
    }
    private void clearSessions() {
        var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys);
    }

    @Test void multiItemWorkflowPersistsChangesHistoryAndIndependentRecentNotes() throws Exception {
        var staff = staff();
        var start = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        doReturn(start).when(clock).instant();
        var created = staff.request("POST", "/api/orders", create()); assertEquals(201, created.status, created.body.toString());
        var original = created.body.path("data"); String orderId = original.path("orderId").asText();
        String first = idForName(original, "蛋糕"), second = idForName(original, "纸杯");
        assertNotEquals(first, second); assertEquals("WAITING_PRODUCTION", original.path("status").asText());
        assertEquals("UNPAID", original.path("paymentStatus").asText()); assertEquals(0, original.path("version").asLong());
        assertEquals(staff.accountId, original.path("createdBy").asText());
        assertEquals(start, Instant.parse(original.path("updatedAt").asText()));
        assertEquals(start, Instant.parse(original.path("confirmedAt").asText()));
        var before = staff.request("GET", "/api/orders/" + orderId, null).body.path("data");
        assertEquals(item(original, second), item(before, second));
        doReturn(start.plusSeconds(1)).when(clock).instant();
        var changes = new LinkedHashMap<String, Object>();
        changes.put("name", "生日蛋糕"); changes.put("quantity", 2); changes.put("unitPriceCents", 12000);
        changes.put("memberPriceCents", null); changes.put("attributes", Map.of("size", "10寸", "flavors", List.of("草莓")));
        var revised = staff.request("PATCH", "/api/orders/" + orderId, patch(first, 0, changes));
        assertEquals(200, revised.status, revised.body.toString()); assertEquals(1, revised.body.at("/data/version").asLong());
        var after = staff.request("GET", "/api/orders/" + orderId, null).body.path("data");
        assertEquals(item(before, second), item(after, second));
        var changed = item(after, first);
        assertEquals("生日蛋糕", changed.path("name").asText()); assertEquals(2, changed.path("quantity").asInt());
        assertEquals("10寸", changed.at("/attributes/size").asText()); assertEquals("生日快乐", changed.at("/attributes/greeting").asText());
        assertTrue(changed.path("memberPriceCents").isNull()); assertEquals("NOT_STARTED", changed.path("productionStatus").asText());
        assertEquals(start.plusSeconds(1), Instant.parse(changed.path("updatedAt").asText()));
        assertEquals(start.plusSeconds(1), Instant.parse(after.path("updatedAt").asText()));
        assertEquals("10寸", jdbc.queryForObject("SELECT attributes->>'size' FROM cake_order_item WHERE id=?::uuid", String.class, first));
        assertEquals(2, jdbc.queryForObject("SELECT quantity FROM cake_order_item WHERE id=?::uuid", Integer.class, first));

        var stale = staff.request("PATCH", "/api/orders/" + orderId, patch(first, 0, Map.of("quantity", 99)));
        assertEquals(409, stale.status); assertEquals("CONCURRENT_MODIFICATION", stale.body.path("code").asText());
        assertEquals(after, staff.request("GET", "/api/orders/" + orderId, null).body.path("data"));
        var history = staff.request("GET", "/api/orders/" + orderId + "/activities?itemId=" + first + "&type=ITEM_CHANGED", null);
        assertEquals(200, history.status); assertEquals(1, history.body.at("/data/total").asLong());
        var log = history.body.at("/data/items/0");
        assertEquals("蛋糕", log.at("/details/before/name").asText()); assertEquals("生日蛋糕", log.at("/details/after/name").asText());
        assertEquals("8寸", log.at("/details/before/attributes/size").asText()); assertEquals("10寸", log.at("/details/after/attributes/size").asText());
        assertEquals(8000, log.at("/details/before/memberPriceCents").asLong()); assertTrue(log.at("/details/after/memberPriceCents").isNull());
        assertEquals(staff.accountId, log.path("actorId").asText()); assertEquals("前台员工", log.path("actorNameSnapshot").asText());
        assertEquals(orderId, log.path("orderId").asText()); assertEquals(first, log.path("itemId").asText());

        doReturn(start.plusSeconds(2)).when(clock).instant();
        for (int i = 1; i <= 4; i++) assertEquals(201, staff.request("POST", "/api/orders/" + orderId + "/notes", Map.of("itemId", first, "content", "A" + i)).status);
        for (int i = 1; i <= 2; i++) assertEquals(201, staff.request("POST", "/api/orders/" + orderId + "/notes", Map.of("itemId", second, "content", "B" + i)).status);
        assertEquals(201, staff.request("POST", "/api/orders/" + orderId + "/notes", Map.of("content", "整单备注")).status);
        var withNotes = staff.request("GET", "/api/orders/" + orderId, null).body.path("data");
        assertEquals(List.of("A4", "A3", "A2"), contents(item(withNotes, first).path("recentNotes")));
        assertEquals(List.of("B2", "B1"), contents(item(withNotes, second).path("recentNotes")));
        assertEquals(1, withNotes.path("version").asLong()); assertEquals(after.path("updatedAt"), withNotes.path("updatedAt"));
        assertEquals(changed.path("updatedAt"), item(withNotes, first).path("updatedAt"));
        var notes = staff.request("GET", "/api/orders/" + orderId + "/activities?itemId=" + first + "&type=NOTE&page=2&size=2", null);
        assertEquals(4, notes.body.at("/data/total").asLong()); assertEquals(List.of("A2", "A1"), contents(notes.body.at("/data/items")));
        var note = item(withNotes, first).at("/recentNotes/0");
        assertEquals(staff.accountId, note.path("actorId").asText()); assertEquals(first, note.path("itemId").asText());
        var noop = staff.request("PATCH", "/api/orders/" + orderId, patch(first, 1, Map.of("quantity", 2)));
        assertEquals(200, noop.status); assertEquals(withNotes, noop.body.path("data"));
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ITEM_CHANGED'", Long.class));
    }
    @Test void concurrentModificationsWithSameVersionHaveOneWinner() throws Exception {
        var staff = staff(); var order = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = order.path("orderId").asText(), first = order.at("/items/0/itemId").asText();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.request("PATCH", "/api/orders/" + id, patch(first, 0, Map.of("name", "修改 A"))); });
            var b = executor.submit(() -> { start.await(); return staff.request("PATCH", "/api/orders/" + id, patch(first, 0, Map.of("name", "修改 B"))); });
            start.countDown(); var responses = List.of(a.get(), b.get());
            assertEquals(Set.of(200, 409), Set.of(responses.get(0).status, responses.get(1).status));
            var winner = responses.stream().filter(result -> result.status == 200).findFirst().orElseThrow();
            var detail = staff.request("GET", "/api/orders/" + id, null).body.path("data");
            assertEquals(1, detail.path("version").asLong()); assertEquals(item(winner.body.path("data"), first), item(detail, first));
        }
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ITEM_CHANGED'", Long.class));
        assertEquals(1L, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
    }
    @Test void activityFailureRollsBackItemVersionAndOrderCreation() throws Exception {
        var staff = staff(); var before = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = before.path("orderId").asText(), first = before.at("/items/0/itemId").asText();
        doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("ITEM_CHANGED")));
        assertEquals(503, staff.request("PATCH", "/api/orders/" + id, patch(first, 0, Map.of("quantity", 99))).status);
        reset(activities);
        assertEquals(before, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        assertEquals(0L, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
        assertEquals(1, jdbc.queryForObject("SELECT quantity FROM cake_order_item WHERE id=?::uuid", Integer.class, first));
        assertEquals(0L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ITEM_CHANGED'", Long.class));
        doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("CREATED")));
        assertEquals(503, staff.request("POST", "/api/orders", create()).status); reset(activities);
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order", Long.class));
        assertEquals(2L, jdbc.queryForObject("SELECT count(*) FROM cake_order_item", Long.class));
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
    }
    @Test void authenticationValidationAndItemOwnershipAreEnforced() throws Exception {
        var staff = staff(); var order = staff.request("POST", "/api/orders", create()).body.path("data");
        var other = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = order.path("orderId").asText(), itemId = order.at("/items/0/itemId").asText(), foreign = other.at("/items/0/itemId").asText();
        var anonymous = new Client();
        assertEquals(401, anonymous.request("POST", "/api/orders", create()).status);
        assertEquals(401, anonymous.request("GET", "/api/orders/" + id, null).status);
        assertEquals(401, anonymous.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("quantity", 2))).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "备注")).status);
        assertEquals(401, anonymous.request("GET", "/api/orders/" + id + "/activities", null).status);
        assertEquals(404, staff.request("GET", "/api/orders/" + UUID.randomUUID(), null).status);
        assertEquals(404, staff.request("PATCH", "/api/orders/" + id, patch(foreign, 0, Map.of("quantity", 2))).status);
        assertEquals(404, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", foreign, "content", "串单")).status);
        assertEquals(404, staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + foreign, null).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("productionStatus", "READY"))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of())).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, Map.of("itemId", itemId, "changes", Map.of("quantity", 2))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0.5, Map.of("quantity", 2))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("quantity", 1.5))).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", " ")).status);
        var forged = new LinkedHashMap<>(create()); forged.put("actorId", UUID.randomUUID());
        assertEquals(400, staff.request("POST", "/api/orders", forged).status);
        forged.remove("actorId"); forged.put("status", "COMPLETED");
        assertEquals(400, staff.request("POST", "/api/orders", forged).status);
        var invalid = new LinkedHashMap<>(create()); invalid.put("customer", Map.of("phone", " "));
        assertEquals(400, staff.request("POST", "/api/orders", invalid).status);
        invalid = new LinkedHashMap<>(create()); invalid.put("items", List.of(Map.of("name", "蛋糕", "quantity", 1.5)));
        assertEquals(400, staff.request("POST", "/api/orders", invalid).status);
        assertEquals(0L, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
    }

    private Client staff() throws Exception {
        identity.initializeAdministrator("0001", "店长", INITIAL);
        var admin = new Client(); admin.login("0001", INITIAL); admin.changePassword(INITIAL); admin.login("0001", PASSWORD);
        var provisioned = admin.request("POST", "/api/admin/employees", Map.of("employeeNumber", "0002", "nickname", "前台员工", "jobRoles", List.of("FRONT_DESK"), "systemRole", "STAFF"));
        assertEquals(201, provisioned.status, provisioned.body.toString());
        var staff = new Client(); staff.accountId = provisioned.body.at("/data/account/accountId").asText();
        String temporary = provisioned.body.at("/data/temporaryPassword").asText();
        staff.login("0002", temporary);
        assertEquals(403, staff.request("POST", "/api/orders", create()).status);
        staff.changePassword(temporary); staff.login("0002", PASSWORD); return staff;
    }
    private static Map<String, Object> create() {
        return Map.of("customer", Map.of("customerName", "客户", "phone", "13800000000"),
                "fulfillment", Map.of("type", "DELIVERY", "address", "示例地址", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"),
                "items", List.of(Map.of("name", "蛋糕", "productType", "CAKE", "quantity", 1, "unitPriceCents", 10000, "memberPriceCents", 8000,
                        "attributes", Map.of("size", "8寸", "flavors", List.of("芒果"), "greeting", "生日快乐")),
                        Map.of("name", "纸杯", "productType", "CUPCAKE", "quantity", 6, "unitPriceCents", 1000, "attributes", Map.of("flavor", "香草"))));
    }
    private static Map<String, Object> patch(String itemId, Number version, Map<String, Object> changes) {
        return Map.of("expectedVersion", version, "itemId", itemId, "changes", changes);
    }
    private static JsonNode item(JsonNode detail, String id) {
        for (var item : detail.path("items")) if (item.path("itemId").asText().equals(id)) return item;
        throw new AssertionError("missing item " + id);
    }
    private static String idForName(JsonNode detail, String name) {
        for (var item : detail.path("items")) if (item.path("name").asText().equals(name)) return item.path("itemId").asText();
        throw new AssertionError("missing item " + name);
    }
    private static List<String> contents(JsonNode notes) { var result = new ArrayList<String>(); notes.forEach(note -> result.add(note.path("content").asText())); return result; }
    record Result(int status, JsonNode body) { }
    final class Client {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
        private String token;
        private String accountId;
        void login(String number, String password) throws Exception {
            var result = request("POST", "/api/auth/login", Map.of("employeeNumber", number, "password", password));
            assertEquals(200, result.status, result.body.toString()); token = result.body.at("/data/accessToken").asText();
        }
        void changePassword(String current) throws Exception {
            assertEquals(200, request("POST", "/api/me/password", Map.of("currentPassword", current, "newPassword", PASSWORD)).status);
        }
        Result request(String method, String path, Object body) throws Exception {
            boolean auth = path.startsWith("/api/auth/");
            if (auth && !method.equals("GET")) request("GET", "/api/auth/csrf", null);
            var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json");
            if (token != null && !auth) builder.header("Authorization", "Bearer " + token);
            if (auth && !method.equals("GET")) cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                    .findFirst().ifPresent(cookie -> builder.header("X-XSRF-TOKEN", cookie.getValue()));
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(response.statusCode(), response.body().isBlank() ? json.nullNode() : json.readTree(response.body()));
        }
    }
}

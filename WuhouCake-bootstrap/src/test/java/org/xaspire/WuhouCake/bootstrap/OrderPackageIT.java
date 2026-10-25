package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import java.io.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.audit.domain.repository.Operations;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("integration")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OrderPackageIT {
    private static final String SCHEMA = "package_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:package-it:" + UUID.randomUUID();
    private static final String INITIAL = "Initial package test password!", PASSWORD = "Permanent package test password!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        JwtTestKeys.properties(r); r.add("spring.flyway.default-schema", () -> SCHEMA); r.add("spring.flyway.schemas", () -> SCHEMA);
        r.add("spring.datasource.hikari.schema", () -> SCHEMA); r.add("wuhoucake.identity.redis-namespace", () -> NAMESPACE);
    }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired IdentityService identity;
    @Autowired javax.sql.DataSource dataSource;
    @MockitoSpyBean Operations operations;
    Client manager, staff;
    @BeforeEach void setup() throws Exception {
        reset(operations);
        jdbc.execute("TRUNCATE cake_order_package,audit_operation,identity_account_role,identity_account CASCADE"); clearRedis();
        identity.initializeAdministrator("MANAGER", "套餐店长", INITIAL);
        manager = new Client(); manager.login("MANAGER", INITIAL); manager.changePassword(INITIAL); manager.login("MANAGER", PASSWORD);
        staff = employee("STAFF", List.of("FRONT_DESK"), "STAFF");
    }
    @AfterAll void cleanup() { reset(operations); clearRedis(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE"); }
    private void clearRedis() { var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys); }

    @Test void packageWritesNotifyOtherAccountsAndFailedOrRepeatedWritesDoNotNotify() throws Exception {
        try (var stream = staff.stream()) {
            String key = UUID.randomUUID().toString(); var body = bundle("协作套餐", 1);
            var created = manager.raw("POST", "/api/order-packages", body, key); assertEquals(201, created.statusCode(), created.body());
            String id = json.readTree(created.body()).at("/data/id").asText(); stream.changed(id, 0, false);
            assertEquals(201, manager.raw("POST", "/api/order-packages", body, key).statusCode()); stream.none();
            manager.data("PUT", "/api/order-packages/" + id, revised("协作套餐新版", 2, 0)); stream.changed(id, 1, false);
            assertEquals(409, manager.raw("PUT", "/api/order-packages/" + id, revised("旧覆盖", 1, 0)).statusCode()); stream.none();
            doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic package audit unavailable")).when(operations).append(argThat(op -> op.action().startsWith("order.package_")));
            assertEquals(503, manager.raw("POST", "/api/order-packages", bundle("应回滚的套餐", 1)).statusCode());
            assertEquals(503, manager.raw("PUT", "/api/order-packages/" + id, revised("应回滚的修改", 3, 1)).statusCode());
            assertEquals(503, manager.raw("DELETE", "/api/order-packages/" + id + "?expectedVersion=1", null).statusCode()); stream.none();
            reset(operations);
            manager.data("DELETE", "/api/order-packages/" + id + "?expectedVersion=1", null); stream.changed(id, 2, true);
            manager.data("DELETE", "/api/order-packages/" + id + "?expectedVersion=1", null); stream.none();
        }
    }

    @Test void managerMaintainsTemplatesAndStaffCanOnlyReadThem() throws Exception {
        var body = bundle("  下午茶  ", 1);
        assertEquals(401, new Client().raw("GET", "/api/order-packages", null).statusCode());
        assertEquals(403, staff.raw("POST", "/api/order-packages", body).statusCode());
        var created = manager.data("POST", "/api/order-packages", body); String id = created.path("id").asText();
        assertEquals("下午茶", created.path("name").asText()); assertEquals(0, created.path("version").asLong());
        assertEquals(0, created.at("/items/0/attributes").size()); assertFalse(created.at("/items/0").has("unitPriceCents"));
        assertEquals(created, staff.data("GET", "/api/order-packages/" + id, null));
        assertEquals(1, staff.data("GET", "/api/order-packages?keyword=" + encode("下午") + "&size=1", null).path("total").asInt());
        var update = revised("新下午茶", 2, 0);
        assertEquals(403, staff.raw("PUT", "/api/order-packages/" + id, update).statusCode());
        assertEquals(403, staff.raw("DELETE", "/api/order-packages/" + id + "?expectedVersion=0", null).statusCode());
        var adminWithoutManager = employee("SYSADMIN", List.of("FRONT_DESK"), "SUPER_ADMIN");
        assertEquals(403, adminWithoutManager.raw("POST", "/api/order-packages", bundle("越权", 1)).statusCode());
        var saved = manager.data("PUT", "/api/order-packages/" + id, update);
        assertEquals(1, saved.path("version").asLong()); assertEquals(2, saved.at("/items/0/quantity").asInt());
        assertEquals(409, manager.raw("PUT", "/api/order-packages/" + id, revised("旧覆盖", 3, 0)).statusCode());
        assertEquals(409, manager.raw("DELETE", "/api/order-packages/" + id + "?expectedVersion=0", null).statusCode());
        assertEquals(saved, staff.data("GET", "/api/order-packages/" + id, null));
        manager.data("DELETE", "/api/order-packages/" + id + "?expectedVersion=1", null);
        assertEquals(404, staff.raw("GET", "/api/order-packages/" + id, null).statusCode());
        assertEquals(0, staff.data("GET", "/api/order-packages", null).path("total").asInt());
        assertEquals(true, jdbc.queryForObject("SELECT deleted_at IS NOT NULL FROM cake_order_package WHERE id=?::uuid", Boolean.class, id));
        manager.data("DELETE", "/api/order-packages/" + id + "?expectedVersion=1", null);
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action LIKE 'order.package_%'", Integer.class));
        manager.data("POST", "/api/order-packages", bundle("新下午茶", 1));
    }
    @Test void uniqueNamesAndCreationKeysPreventDuplicatesIncludingConcurrentRequests() throws Exception {
        String key = UUID.randomUUID().toString(); var body = bundle("固定套餐", 1);
        var first = manager.raw("POST", "/api/order-packages", body, key); assertEquals(201, first.statusCode(), first.body());
        var retry = manager.raw("POST", "/api/order-packages", body, key); assertEquals(201, retry.statusCode(), retry.body());
        assertEquals(json.readTree(first.body()).at("/data/id"), json.readTree(retry.body()).at("/data/id"));
        assertEquals(409, manager.raw("POST", "/api/order-packages", bundle("固定套餐", 2), key).statusCode());
        assertCode("PACKAGE_NAME_CONFLICT", manager.raw("POST", "/api/order-packages", bundle(" 固定套餐 ", 1)));
        var other = manager.data("POST", "/api/order-packages", bundle("另一套餐", 1));
        assertCode("PACKAGE_NAME_CONFLICT", manager.raw("PUT", "/api/order-packages/" + other.path("id").asText(), revised("固定套餐", 1, 0)));
        assertEquals("另一套餐", staff.data("GET", "/api/order-packages/" + other.path("id").asText(), null).path("name").asText());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var ready = new CountDownLatch(2); var go = new CountDownLatch(1);
            Callable<Integer> create = () -> { ready.countDown(); assertTrue(go.await(5, TimeUnit.SECONDS)); return manager.raw("POST", "/api/order-packages", bundle("并发套餐", 1)).statusCode(); };
            var a = executor.submit(create); var b = executor.submit(create); assertTrue(ready.await(5, TimeUnit.SECONDS)); go.countDown();
            assertEquals(Set.of(201, 409), Set.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS)));
        }
        assertEquals(1, staff.data("GET", "/api/order-packages?keyword=" + encode("并发套餐"), null).path("total").asInt());
        String concurrentKey = UUID.randomUUID().toString();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> manager.raw("POST", "/api/order-packages", bundle("并发幂等套餐", 1), concurrentKey));
            var b = executor.submit(() -> manager.raw("POST", "/api/order-packages", bundle("并发幂等套餐", 1), concurrentKey));
            var firstResult = a.get(10, TimeUnit.SECONDS); var secondResult = b.get(10, TimeUnit.SECONDS);
            assertEquals(201, firstResult.statusCode(), firstResult.body()); assertEquals(201, secondResult.statusCode(), secondResult.body());
            assertEquals(json.readTree(firstResult.body()).at("/data/id"), json.readTree(secondResult.body()).at("/data/id"));
        }
        assertEquals(4, jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action='order.package_created'", Integer.class));
    }
    @Test void validatesOptionalSpecificationsAndPaginatesWithoutLimitingPackageCount() throws Exception {
        assertEquals(400, manager.raw("POST", "/api/order-packages", bundle(" ", 1)).statusCode());
        assertEquals(400, manager.raw("POST", "/api/order-packages", Map.of("name", "空套餐", "items", List.of())).statusCode());
        for (var count : List.of(0, -1, 1.5)) assertEquals(400, manager.raw("POST", "/api/order-packages", bundle("无效数量", count)).statusCode());
        assertEquals(400, manager.raw("POST", "/api/order-packages", Map.of("name", "无类型", "items", List.of(Map.of("name", "蛋糕", "quantity", 1)))).statusCode());
        assertEquals(400, manager.raw("POST", "/api/order-packages", Map.of("name", "无效规格", "items", List.of(Map.of("name", "蛋糕", "productType", "CAKE", "quantity", 1, "attributes", Map.of("size", "8寸"))))).statusCode());
        for (int i = 0; i < 23; i++) manager.data("POST", "/api/order-packages", bundle("分页套餐" + i, 1));
        var first = staff.data("GET", "/api/order-packages?size=20", null); var second = staff.data("GET", "/api/order-packages?size=20&page=2", null);
        assertEquals(23, first.path("total").asInt()); assertEquals(20, first.path("items").size()); assertEquals(3, second.path("items").size());
        var ids = new HashSet<String>(); for (var row : first.path("items")) assertTrue(ids.add(row.path("id").asText()));
        for (var row : second.path("items")) assertTrue(ids.add(row.path("id").asText()));
        assertEquals(0, staff.data("GET", "/api/order-packages?keyword=%25", null).path("total").asInt());
    }
    @Test void auditFailureRollsBackCreatesUpdatesAndDeletesWithBeforeAfterEvidence() throws Exception {
        var created = manager.data("POST", "/api/order-packages", bundle("审计套餐", 1)); String id = created.path("id").asText();
        manager.data("PUT", "/api/order-packages/" + id, revised("新审计套餐", 2, 0));
        var log = manager.data("GET", "/api/admin/audit-logs?action=order.package_updated", null).at("/items/0");
        assertEquals(manager.id, log.path("actorId").asText());
        assertEquals("审计套餐", json.readTree(log.at("/details/before").asText()).path("name").asText());
        assertEquals("新审计套餐", json.readTree(log.at("/details/after").asText()).path("name").asText());
        String changeId = log.at("/details/changeId").asText();
        assertEquals(2, jdbc.queryForObject("SELECT (after_content->'items'->0->>'quantity')::int FROM cake_order_package_change WHERE id=?::uuid", Integer.class, changeId));
        var before = staff.data("GET", "/api/order-packages/" + id, null);
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic package audit unavailable")).when(operations).append(argThat(op -> op.action().startsWith("order.package_")));
        assertEquals(503, manager.raw("POST", "/api/order-packages", bundle("应回滚", 1)).statusCode());
        assertEquals(503, manager.raw("PUT", "/api/order-packages/" + id, revised("应回滚", 3, 1)).statusCode());
        assertEquals(503, manager.raw("DELETE", "/api/order-packages/" + id + "?expectedVersion=1", null).statusCode());
        assertEquals(before, staff.data("GET", "/api/order-packages/" + id, null));
        assertEquals(1, staff.data("GET", "/api/order-packages", null).path("total").asInt());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cake_order_package_change", Integer.class));
    }
    @Test void largePackageChangesKeepFullAuditSnapshots() throws Exception {
        String requirements = "通用商品要求".repeat(300);
        var content = Map.of("name", "大型套餐", "items", java.util.stream.IntStream.range(0, 25).mapToObj(i ->
                Map.of("name", "商品" + i, "productType", "BREAD", "quantity", 1, "attributes", Map.of("requirements", requirements))).toList());
        var saved = manager.data("POST", "/api/order-packages", content);
        var log = manager.data("GET", "/api/admin/audit-logs?action=order.package_created", null).at("/items/0");
        String snapshot = jdbc.queryForObject("SELECT after_content::text FROM cake_order_package_change WHERE id=?::uuid", String.class, log.at("/details/changeId").asText());
        assertEquals(saved.path("items"), json.readTree(snapshot).path("items"));
        assertEquals(25, saved.path("items").size());
    }
    @Test void migrationPreservesHistoricalPackagesAndStopsOnDuplicateNames() {
        String schema = "package_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try {
            org.flywaydb.core.Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").schemas(schema).defaultSchema(schema).target("17").load().migrate();
            String originalId = UUID.randomUUID().toString();
            String content = "[{\"name\":\"面包\",\"productType\":\"BREAD\",\"quantity\":6,\"attributes\":{\"specification\":\"小份\"}}]";
            jdbc.update("INSERT INTO " + schema + ".cake_order_package(id,name,items) VALUES (?::uuid,?,?::jsonb)", originalId, "旧套餐", content);
            jdbc.update("INSERT INTO " + schema + ".cake_order_package(id,name,items) VALUES (?::uuid,?,?::jsonb)", UUID.randomUUID().toString(), " 旧套餐 ", content);
            var upgrade = org.flywaydb.core.Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").schemas(schema).defaultSchema(schema).load();
            assertThrows(org.flywaydb.core.api.FlywayException.class, upgrade::migrate);
            assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".cake_order_package", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=? AND table_name='cake_order_package' AND column_name='version'", Integer.class, schema));
            jdbc.update("UPDATE " + schema + ".cake_order_package SET name='旧套餐二' WHERE name=' 旧套餐 '");
            upgrade.migrate();
            assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".cake_order_package WHERE version=0 AND updated_at=created_at AND deleted_at IS NULL", Integer.class));
            assertEquals(true, jdbc.queryForObject("SELECT items=?::jsonb FROM " + schema + ".cake_order_package WHERE id=?::uuid", Boolean.class, content, originalId));
        } finally { jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); }
    }
    private void assertCode(String code, HttpResponse<String> response) throws Exception {
        assertEquals(409, response.statusCode(), response.body()); assertEquals(code, json.readTree(response.body()).path("code").asText());
    }
    private static String encode(String value) { return URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8); }
    private Map<String, Object> bundle(String name, Number quantity) { return Map.of("name", name, "items", List.of(Map.of("name", "蛋糕", "productType", "CAKE", "quantity", quantity, "attributes", Map.of()))); }
    private Map<String, Object> revised(String name, int quantity, long version) { var value = new LinkedHashMap<>(bundle(name, quantity)); value.put("expectedVersion", version); return value; }
    private Client employee(String number, List<String> roles, String systemRole) throws Exception {
        var provisioned = manager.data("POST", "/api/admin/employees", Map.of("employeeNumber", number, "nickname", number, "jobRoles", roles, "systemRole", systemRole));
        String temporary = provisioned.path("temporaryPassword").asText(); var employee = new Client();
        employee.login(number, temporary); employee.changePassword(temporary); employee.login(number, PASSWORD); return employee;
    }
    final class Client {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
        String token, id;
        PackageStream stream() throws Exception {
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/orders/stream"))
                    .header("Authorization", "Bearer " + token).header("Accept", "text/event-stream").GET().build();
            return new PackageStream(client.send(request, HttpResponse.BodyHandlers.ofInputStream()));
        }
        void login(String number, String password) throws Exception { token = data("POST", "/api/auth/login", Map.of("employeeNumber", number, "password", password)).path("accessToken").asText(); id = data("GET", "/api/me", null).path("accountId").asText(); }
        void changePassword(String password) throws Exception { data("POST", "/api/me/password", Map.of("currentPassword", password, "newPassword", PASSWORD)); }
        JsonNode data(String method, String path, Object body) throws Exception {
            var response = raw(method, path, body); assertTrue(response.statusCode() >= 200 && response.statusCode() < 300, method + " " + path + " " + response.statusCode() + " " + response.body());
            return json.readTree(response.body()).path("data");
        }
        HttpResponse<String> raw(String method, String path, Object body) throws Exception { return raw(method, path, body, UUID.randomUUID().toString()); }
        HttpResponse<String> raw(String method, String path, Object body, String key) throws Exception {
            boolean auth = path.startsWith("/api/auth/"); if (auth && !method.equals("GET")) raw("GET", "/api/auth/csrf", null);
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json").timeout(java.time.Duration.ofSeconds(15));
            if (method.equals("POST") && path.equals("/api/order-packages")) request.header("Idempotency-Key", key);
            if (!auth && token != null) request.header("Authorization", "Bearer " + token);
            if (auth && !method.equals("GET")) cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("XSRF-TOKEN")).findFirst().ifPresent(c -> request.header("X-XSRF-TOKEN", c.getValue()));
            request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        }
    }
    record StreamEvent(String name, JsonNode data) { }
    final class PackageStream implements AutoCloseable {
        private final InputStream body;
        private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
        private final BlockingQueue<StreamEvent> events = new LinkedBlockingQueue<>();
        PackageStream(HttpResponse<InputStream> response) throws Exception {
            assertEquals(200, response.statusCode()); body = response.body();
            executor.submit(() -> {
                try (var reader = new BufferedReader(new InputStreamReader(body, java.nio.charset.StandardCharsets.UTF_8))) {
                    String name = null; var data = new StringBuilder(); String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (name != null) events.add(new StreamEvent(name, json.readTree(data.toString())));
                            name = null; data.setLength(0);
                        } else if (line.startsWith("event:")) name = line.substring(6).strip();
                        else if (line.startsWith("data:")) data.append(line.substring(5).strip());
                    }
                } catch (IOException ignored) { }
            });
            var ready = events.poll(5, TimeUnit.SECONDS); assertNotNull(ready); assertEquals("ready", ready.name());
        }
        void changed(String id, long version, boolean deleted) throws Exception {
            var event = events.poll(5, TimeUnit.SECONDS); assertNotNull(event, "missing package notification"); assertEquals("package.changed", event.name());
            assertEquals(id, event.data().path("packageId").asText()); assertEquals(version, event.data().path("version").asLong()); assertEquals(deleted, event.data().path("deleted").asBoolean());
            var fields = new HashSet<String>(); event.data().fieldNames().forEachRemaining(fields::add); assertEquals(Set.of("packageId", "version", "deleted"), fields);
        }
        void none() throws Exception { assertNull(events.poll(150, TimeUnit.MILLISECONDS), "unexpected package notification"); }
        @Override public void close() throws Exception { body.close(); executor.shutdownNow(); assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS)); }
    }
}

package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.identity.domain.port.IdentityPorts.Sessions;
import org.xaspire.WuhouCake.identity.domain.repository.Accounts;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("integration")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class IdentityIT {
    private static final String SCHEMA = "identity_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:identity-it:" + UUID.randomUUID();
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
    @MockitoSpyBean Accounts accounts;
    @MockitoSpyBean Sessions sessions;
    @MockitoSpyBean Clock clock;
    @BeforeEach void clean() {
        reset(accounts, sessions, clock);
        jdbc.execute("TRUNCATE audit_operation, identity_account_role, identity_account CASCADE");
        var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys);
    }
    @AfterAll void removeTestData() {
        reset(accounts, sessions, clock);
        var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys);
        jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE");
    }
    @Test void accountLifecycleAndAuthorizationAreEnforced() throws Exception {
        Browser admin = administrator();
        var created = provision(admin, "0002", "STAFF");
        String id = created.at("/data/account/accountId").asText();
        String temporary = created.at("/data/temporaryPassword").asText();
        assertEquals(20, temporary.length()); assertEquals("0002", created.at("/data/account/employeeNumber").asText());
        Browser staff = new Browser(); staff.login("0002", temporary);
        assertEquals(200, staff.request("GET", "/api/me", null).status);
        assertEquals(403, staff.request("GET", "/api/admin/employees", null).status);
        assertEquals(403, staff.request("PATCH", "/api/me/nickname", Map.of("nickname", "前台")).status);
        String originalToken = staff.token;
        staff.changePassword(temporary, PASSWORD);
        assertEquals(401, staff.request("GET", "/api/me", null).status);
        staff.login("0002", PASSWORD);
        assertEquals(403, staff.request("GET", "/api/admin/employees", null).status);
        var renamed = staff.request("PATCH", "/api/me/nickname", Map.of("nickname", "  师父🍰  "));
        assertEquals(200, renamed.status); assertEquals("师父🍰", renamed.body.at("/data/nickname").asText());
        assertEquals(400, staff.request("PATCH", "/api/me/nickname", Map.of("nickname", "伪装", "systemRole", "SUPER_ADMIN")).status);
        var resetResponse = admin.request("POST", "/api/admin/employees/" + id + "/reset-password", null);
        assertEquals(200, resetResponse.status);
        assertEquals(401, staff.request("GET", "/api/me", null).status);
        Browser other = new Browser(); other.login("0002", resetResponse.body.at("/data/temporaryPassword").asText());
        assertEquals(200, admin.request("POST", "/api/admin/employees/" + id + "/archive", null).status);
        assertEquals(401, other.request("GET", "/api/me", null).status);
        assertEquals(401, other.request("POST", "/api/auth/refresh", null).status);
        assertEquals(200, admin.request("POST", "/api/admin/employees/" + id + "/archive", null).status);
        assertEquals(409, admin.request("POST", "/api/admin/employees", create("0002", "STAFF")).status);
        assertEquals("ARCHIVED", jdbc.queryForObject("SELECT status FROM identity_account WHERE employee_number='0002'", String.class));
        assertTrue(redis.keys(NAMESPACE + ":session:*").size() >= 2);
        staff.token = originalToken; assertEquals(401, staff.request("GET", "/api/me", null).status);
        assertEquals(200, admin.request("GET", "/api/admin/audit-logs?size=100", null).status);
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action='identity.account_archived'", Long.class) == 1);
        assertTrue(jdbc.queryForObject("SELECT password_hash FROM identity_account WHERE employee_number='0002'", String.class).startsWith("{argon2id}"));
        var logs = admin.request("GET", "/api/admin/audit-logs?size=100", null).body.toString();
        assertFalse(logs.contains(temporary)); assertFalse(logs.contains(staff.token)); assertFalse(logs.contains("passwordHash"));
    }
    @Test void csrfCookiesLogoutAndMultiDeviceSessionsWork() throws Exception {
        Browser admin = administrator();
        Browser second = new Browser(); second.login("0001", PASSWORD);
        Browser anonymous = new Browser();
        assertEquals(403, anonymous.raw("POST", "/api/auth/login", Map.of("employeeNumber", "0001", "password", PASSWORD), false).status);
        admin.token = null; assertEquals(401, admin.request("GET", "/api/me", null).status);
        assertEquals(200, admin.request("POST", "/api/auth/refresh", null).status);
        var refresh = admin.request("POST", "/api/auth/refresh", null); admin.token = refresh.body.at("/data/accessToken").asText();
        String refreshCookie = admin.cookie("wuhoucake_refresh");
        assertFalse(refresh.body.toString().contains(refreshCookie));
        assertTrue(refresh.headers.firstValue("Cache-Control").orElse("").contains("no-store"));
        assertEquals(200, admin.request("POST", "/api/auth/logout", null).status);
        assertEquals(401, admin.request("GET", "/api/me", null).status);
        assertEquals(200, admin.request("POST", "/api/auth/logout", null).status);
        assertEquals(200, second.request("GET", "/api/me", null).status);
        var login = second.request("POST", "/api/auth/login", Map.of("employeeNumber", "0001", "password", PASSWORD));
        String cookie = login.headers.allValues("Set-Cookie").stream().filter(value -> value.startsWith("wuhoucake_refresh=")).findFirst().orElseThrow();
        assertTrue(cookie.contains("HttpOnly")); assertTrue(cookie.contains("SameSite=Lax"));
        long lifetime = HttpCookie.parse(cookie).getFirst().getMaxAge();
        assertTrue(lifetime > 604790 && lifetime <= 604800);
        assertFalse(login.body.toString().contains("refreshCredential"));
    }
    @Test void refreshIsConcurrentAndDoesNotExtendAbsoluteExpiry() throws Exception {
        Browser admin = administrator();
        String credential = admin.cookie("wuhoucake_refresh");
        long ttl = redis.getExpire(NAMESPACE + ":session:" + credential.substring(0, 36));
        admin.csrf();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> admin.raw("POST", "/api/auth/refresh", null, true));
            var second = executor.submit(() -> admin.raw("POST", "/api/auth/refresh", null, true));
            assertEquals(200, first.get().status); assertEquals(200, second.get().status);
        }
        assertEquals(credential, admin.cookie("wuhoucake_refresh"));
        assertTrue(redis.getExpire(NAMESPACE + ":session:" + credential.substring(0, 36)) <= ttl);
        Instant current = clock.instant(); doReturn(current.plusSeconds(16 * 60)).when(clock).instant();
        assertEquals(401, admin.request("GET", "/api/me", null).status);
        var refreshed = admin.request("POST", "/api/auth/refresh", null); assertEquals(200, refreshed.status);
        admin.token = refreshed.body.at("/data/accessToken").asText(); assertEquals(200, admin.request("GET", "/api/me", null).status);
        doReturn(current.plusSeconds(7 * 86400L + 1)).when(clock).instant();
        assertEquals(401, admin.request("POST", "/api/auth/refresh", null).status);
    }
    @Test void loginThrottlingAndErrorsDoNotRevealAccountState() throws Exception {
        administrator(); Browser client = new Browser();
        var unknown = client.request("POST", "/api/auth/login", Map.of("employeeNumber", "MISSING", "password", "wrong"));
        for (int i = 0; i < 5; i++) {
            var wrong = client.request("POST", "/api/auth/login", Map.of("employeeNumber", "0001", "password", "wrong"));
            assertEquals(401, wrong.status); assertEquals(unknown.body, wrong.body);
        }
        assertEquals(429, client.request("POST", "/api/auth/login", Map.of("employeeNumber", "0001", "password", PASSWORD)).status);
        assertTrue(redis.getExpire(NAMESPACE + ":attempts:0001") > 0);
    }
    @Test void logoutSucceedsWhenAuditAccountMetadataIsUnavailable() throws Exception {
        Browser admin = administrator();
        String credential = admin.cookie("wuhoucake_refresh");
        long failures = identity.auditFailureCount();
        doThrow(new DataAccessResourceFailureException("unavailable")).when(accounts).find(any());
        assertEquals(200, admin.request("POST", "/api/auth/logout", null).status);
        assertFalse(redis.hasKey(NAMESPACE + ":session:" + credential.substring(0, 36)));
        assertEquals(failures + 1, identity.auditFailureCount());
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action='identity.logout' AND actor_id IS NOT NULL", Long.class));
        reset(accounts);
        assertEquals(401, admin.request("GET", "/api/me", null).status);
    }
    @Test void refreshCannotIssueAZeroSecondAccessToken() throws Exception {
        Browser admin = administrator();
        String credential = admin.cookie("wuhoucake_refresh");
        Instant expires = Instant.parse((String) redis.opsForHash().get(NAMESPACE + ":session:" + credential.substring(0, 36), "expires"));
        doReturn(expires.minusNanos(100_000_000L)).when(clock).instant();
        assertEquals(401, admin.request("POST", "/api/auth/refresh", null).status);
    }
    @Test void concurrentAdministratorArchivalPreservesOneAdministrator() throws Exception {
        Browser first = administrator();
        var created = provision(first, "0002", "SUPER_ADMIN");
        Browser second = new Browser(); second.login("0002", created.at("/data/temporaryPassword").asText());
        second.changePassword(created.at("/data/temporaryPassword").asText(), PASSWORD); second.login("0002", PASSWORD);
        String firstId = first.request("GET", "/api/me", null).body.at("/data/accountId").asText();
        String secondId = created.at("/data/account/accountId").asText();
        assertEquals(403, first.request("POST", "/api/admin/employees/" + firstId + "/archive", null).status);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> first.request("POST", "/api/admin/employees/" + secondId + "/archive", null));
            var b = executor.submit(() -> second.request("POST", "/api/admin/employees/" + firstId + "/archive", null));
            assertEquals(1, List.of(a.get(), b.get()).stream().filter(result -> result.status == 200).count());
        }
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM identity_account WHERE system_role='SUPER_ADMIN' AND status='ACTIVE'", Long.class));
    }
    @Test void concurrentDuplicateCreationHasOneWinner() throws Exception {
        Browser admin = administrator();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> admin.request("POST", "/api/admin/employees", create("0002", "STAFF")));
            var b = executor.submit(() -> admin.request("POST", "/api/admin/employees", create("0002", "STAFF")));
            assertEquals(Set.of(201, 409), Set.of(a.get().status, b.get().status));
        }
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM identity_account WHERE employee_number='0002'", Long.class));
    }
    @Test void auditFailureDoesNotRollBackAccountChange() throws Exception {
        Browser admin = administrator(); long before = identity.auditFailureCount();
        jdbc.execute("ALTER TABLE audit_operation RENAME TO unavailable_audit_operation");
        try {
            assertEquals(200, admin.request("PATCH", "/api/me/nickname", Map.of("nickname", "已提交")).status);
            assertEquals("已提交", jdbc.queryForObject("SELECT nickname FROM identity_account WHERE employee_number='0001'", String.class));
            assertEquals(before + 1, identity.auditFailureCount());
        } finally { jdbc.execute("ALTER TABLE unavailable_audit_operation RENAME TO audit_operation"); }
    }
    @Test void unavailableDatabaseOrRedisDoesNotGrantAccess() throws Exception {
        Browser admin = administrator();
        doThrow(new RedisConnectionFailureException("unavailable")).when(sessions).find(any());
        assertEquals(503, admin.request("GET", "/api/me", null).status);
        reset(sessions); doThrow(new DataAccessResourceFailureException("unavailable")).when(accounts).find(any());
        assertEquals(503, admin.request("GET", "/api/me", null).status);
    }
    @Test void initializationAndRecoveryDoNotOverwriteOrRestoreAccounts() throws Exception {
        Browser admin = administrator();
        assertThrows(RuntimeException.class, () -> identity.initializeAdministrator("OTHER", "other", INITIAL));
        var recovery = identity.recoverAdministrator("0001");
        assertEquals(401, admin.request("GET", "/api/me", null).status);
        admin.login("0001", recovery.temporaryPassword());
        assertEquals(403, admin.request("GET", "/api/admin/employees", null).status);
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM identity_account", Long.class));
    }
    @Test void unknownResourcesAndUnsupportedMethodsHaveStandardErrors() throws Exception {
        Browser admin = administrator();
        assertEquals(404, admin.request("GET", "/api/admin/missing", null).status);
        assertEquals(405, admin.request("DELETE", "/api/admin/employees", null).status);
        assertEquals(404, admin.request("POST", "/api/admin/employees/" + UUID.randomUUID() + "/archive", null).status);
    }
    private Browser administrator() throws Exception {
        identity.initializeAdministrator("0001", "店长", INITIAL);
        Browser browser = new Browser(); browser.login("0001", INITIAL);
        assertEquals(400, browser.request("POST", "/api/me/password", Map.of("currentPassword", INITIAL, "newPassword", INITIAL)).status);
        browser.changePassword(INITIAL, PASSWORD); browser.login("0001", PASSWORD); return browser;
    }
    private JsonNode provision(Browser admin, String number, String role) throws Exception {
        var response = admin.request("POST", "/api/admin/employees", create(number, role)); assertEquals(201, response.status, response.body.path("code").asText()); return response.body;
    }
    private Map<String, Object> create(String number, String role) { return Map.of("employeeNumber", number, "nickname", "员工", "jobRoles", List.of("FRONT_DESK", "PASTRY_CHEF"), "systemRole", role); }
    record Result(int status, JsonNode body, HttpHeaders headers) { }
    final class Browser {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
        String token;
        String cookie(String name) { return cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals(name)).map(HttpCookie::getValue).findFirst().orElse(null); }
        void csrf() throws Exception { raw("GET", "/api/auth/csrf", null, false); }
        void login(String number, String password) throws Exception {
            var result = request("POST", "/api/auth/login", Map.of("employeeNumber", number, "password", password));
            assertEquals(200, result.status, result.body.path("code").asText()); token = result.body.at("/data/accessToken").asText();
        }
        void changePassword(String old, String password) throws Exception {
            assertEquals(200, request("POST", "/api/me/password", Map.of("currentPassword", old, "newPassword", password)).status);
        }
        Result request(String method, String path, Object body) throws Exception {
            if (path.startsWith("/api/auth/") && !method.equals("GET")) csrf();
            return raw(method, path, body, true);
        }
        Result raw(String method, String path, Object body, boolean useCsrf) throws Exception {
            var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json");
            if (token != null && !path.startsWith("/api/auth/")) builder.header("Authorization", "Bearer " + token);
            if (useCsrf && path.startsWith("/api/auth/") && cookie("XSRF-TOKEN") != null) builder.header("X-XSRF-TOKEN", cookie("XSRF-TOKEN"));
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(response.statusCode(), response.body().isBlank() ? json.nullNode() : json.readTree(response.body()), response.headers());
        }
    }
}

package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import java.time.Instant;
import java.io.ByteArrayInputStream;
import javax.sql.DataSource;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.order.domain.port.CustomerSubmissions;
import org.xaspire.WuhouCake.audit.domain.repository.Operations;
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
    @MockitoSpyBean Operations auditOperations;
    @Autowired DataSource dataSource;
    @Autowired PlatformTransactionManager transactions;
    @BeforeEach void clean() {
        reset(store, auditOperations); jdbc.execute("TRUNCATE customer_order_entry,customer_order_submission,customer_submission_activity,cake_order,identity_account,audit_operation CASCADE");
        clearRedis();
    }
    @AfterAll void cleanup() { reset(store, auditOperations); clearRedis(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE"); }
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
    @Test void sameRequestIsIdempotentButNewRequestsNeedFullDuplicateAcknowledgement() throws Exception {
        var staff = admin(); String token = entry(staff); var input = content("13800000000", "2026-11-02T18:00:00+08:00"); var key = UUID.randomUUID();
        String first = submit(token, input, key).at("/data/submissionId").asText();
        assertEquals(first, submit(token, input, key).at("/data/submissionId").asText());
        assertEquals(409, new Client().request("POST", submitPath(token), content("13800000001", "2026-11-02T18:00:00+08:00"), key.toString()).status);
        String second = submit(token, input, UUID.randomUUID()).at("/data/submissionId").asText();
        submit(token, content("13800000000", "2026-11-03T18:00:00+08:00"), UUID.randomUUID());
        assertEquals(3, count("customer_order_submission"));
        assertEquals(second, staff.data("GET", "/api/customer-submissions/" + first, null).at("/duplicates/0/id").asText());
        staff.data("PATCH", "/api/customer-submissions/" + first, Map.of("expectedVersion", 0, "review", review(input, staff.id, 12300)));
        assertEquals(409, staff.request("POST", "/api/customer-submissions/" + first + "/confirm", Map.of("expectedVersion", 1)).status);
        assertEquals(409, staff.request("POST", "/api/customer-submissions/" + first + "/confirm", Map.of("expectedVersion", 1, "acknowledgedNewerSubmissionId", second)).status);
        var checked = staff.data("GET", "/api/customer-submissions/" + first, null);
        assertEquals(200, staff.request("POST", "/api/customer-submissions/" + first + "/confirm", Map.of("expectedVersion", 1, "duplicateCheckToken", checked.path("duplicateCheckToken").asText())).status);
        staff.data("DELETE", "/api/customer-submissions/" + second, Map.of("expectedVersion", 0));
        assertEquals("DELETED", staff.data("GET", "/api/customer-submissions/" + second, null).at("/submission/status").asText());
        assertEquals(3, count("customer_order_submission")); assertEquals(1, staff.data("GET", "/api/customer-submissions?mine=false", null).path("total").asInt());
    }
    @Test void duplicatesIncludeAllAgesOwnersAndManualOrdersAndConfirmedSubmissionsAppearOnlyAsOrders() throws Exception {
        var staff = admin(); var other = employee(staff, "0002", "FRONT_DESK");
        var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        String manual = manualOrder(staff, "138 (0000)-0000", "2026-11-02");
        String first = submit(entry(staff), input, UUID.randomUUID()).at("/data/submissionId").asText();
        String second = submit(entry(other), input, UUID.randomUUID()).at("/data/submissionId").asText();
        String third = submit(entry(staff), input, UUID.randomUUID()).at("/data/submissionId").asText();
        staff.data("PATCH", "/api/customer-submissions/" + first, Map.of("expectedVersion", 0, "review", review(input, staff.id, 12300)));
        staff.data("PATCH", "/api/customer-submissions/" + third, Map.of("expectedVersion", 0, "review", review(input, staff.id, 12300)));
        var before = staff.data("GET", "/api/customer-submissions/" + first, null);
        assertEquals(Set.of(manual, second, third), duplicateIds(before));
        var manualRecord = duplicate(before, manual);
        assertEquals("店长", manualRecord.path("handledBy").asText()); assertEquals(2, manualRecord.at("/items/0/quantity").asInt());
        assertEquals(9900, manualRecord.path("totalAmountCents").asLong());
        assertEquals(409, staff.request("POST", "/api/customer-submissions/" + third + "/confirm", Map.of("expectedVersion", 1)).status);
        var newest = staff.data("GET", "/api/customer-submissions/" + third, null);
        String confirmedOrder = staff.data("POST", "/api/customer-submissions/" + third + "/confirm", Map.of("expectedVersion", 1,
                "duplicateCheckToken", newest.path("duplicateCheckToken").asText())).at("/submission/orderId").asText();
        assertEquals(409, confirmWithToken(staff, first, before).status);
        var current = staff.data("GET", "/api/customer-submissions/" + first, null);
        assertEquals(Set.of(manual, second, confirmedOrder), duplicateIds(current));
        assertEquals("ORDER", duplicate(current, confirmedOrder).path("kind").asText());
        var confirmed = staff.data("POST", "/api/customer-submissions/" + first + "/confirm", Map.of("expectedVersion", 1,
                "duplicateCheckToken", current.path("duplicateCheckToken").asText()));
        var log = confirmed.at("/activities/0");
        assertEquals(staff.id, log.path("actorId").asText());
        assertEquals("CONFIRMED_INDEPENDENT_ORDER", log.at("/details/duplicateReview/decision").asText());
        assertEquals(3, log.at("/details/duplicateReview/records").size());
    }
    @Test void duplicateMatchingUsesReviewedAndCurrentContactsAndShanghaiDatesWithoutCountryGuessing() throws Exception {
        var staff = admin(); String token = entry(staff);
        var original = content("13800000000", "2026-11-02T00:30:00+08:00");
        String first = submit(token, original, UUID.randomUUID()).at("/data/submissionId").asText();
        String peer = submit(token, content("13900000000", "2026-11-03T18:00:00+08:00"), UUID.randomUUID()).at("/data/submissionId").asText();
        String removed = submit(token, original, UUID.randomUUID()).at("/data/submissionId").asText();
        staff.data("DELETE", "/api/customer-submissions/" + removed, Map.of("expectedVersion", 0));
        String manual = manualOrder(staff, "138-0000-0000", "2026-11-02");
        manualOrder(staff, "+8613800000000", "2026-11-02");
        var initial = staff.data("GET", "/api/customer-submissions/" + first, null);
        assertEquals(Set.of(manual), duplicateIds(initial));
        assertEquals("2026-11-02", duplicate(initial, manual).path("requestedReceiveDate").asText());
        var saved = staff.data("PATCH", "/api/customer-submissions/" + peer, Map.of("expectedVersion", 0, "review", review(original, staff.id, 8000)));
        assertEquals("13900000000", saved.at("/submission/original/phone").asText());
        var changed = staff.data("GET", "/api/customer-submissions/" + first, null);
        assertEquals(Set.of(manual, peer), duplicateIds(changed));
        assertNotEquals(initial.path("duplicateCheckToken"), changed.path("duplicateCheckToken"));
        var revised = content("13800000000", "2026-11-03T00:30:00+08:00");
        staff.data("PATCH", "/api/customer-submissions/" + first, Map.of("expectedVersion", 0, "review", review(revised, staff.id, 12300)));
        assertTrue(duplicateIds(staff.data("GET", "/api/customer-submissions/" + first, null)).isEmpty());
        staff.data("PATCH", "/api/orders/" + manual + "/information", Map.of("expectedVersion", 0, "changes", Map.of("requestedReceiveAt", "2026-11-03T00:30:00+08:00")));
        assertEquals(Set.of(manual), duplicateIds(staff.data("GET", "/api/customer-submissions/" + first, null)));
    }
    @Test void changedCandidatesInvalidateAcknowledgementAndCancelledOrdersAreReferenceOnly() throws Exception {
        var staff = admin(); var input = content("13800000000", "2026-11-02T18:00:00+08:00");
        String id = submit(entry(staff), input, UUID.randomUUID()).at("/data/submissionId").asText();
        staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review(input, staff.id, 12300)));
        var empty = staff.data("GET", "/api/customer-submissions/" + id, null);
        String manual = manualOrder(staff, "13800000000", "2026-11-02");
        assertEquals(409, confirmWithToken(staff, id, empty).status);
        var before = staff.data("GET", "/api/customer-submissions/" + id, null);
        staff.data("PATCH", "/api/orders/" + manual + "/information", Map.of("expectedVersion", 0, "changes", Map.of("totalAmountCents", 12000)));
        assertEquals(409, confirmWithToken(staff, id, before).status);
        var modified = staff.data("GET", "/api/customer-submissions/" + id, null);
        jdbc.update("UPDATE cake_order SET status='COMPLETED',version=version+1 WHERE id=?::uuid", manual);
        assertEquals(409, confirmWithToken(staff, id, modified).status);
        var completed = staff.data("GET", "/api/customer-submissions/" + id, null);
        assertTrue(duplicate(completed, manual).path("requiresAcknowledgement").asBoolean());
        assertEquals(409, staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).status);
        jdbc.update("UPDATE cake_order SET status='CANCELLED',version=version+1 WHERE id=?::uuid", manual);
        assertEquals(409, confirmWithToken(staff, id, completed).status);
        var cancelled = staff.data("GET", "/api/customer-submissions/" + id, null);
        assertEquals("CANCELLED", duplicate(cancelled, manual).path("status").asText());
        assertFalse(duplicate(cancelled, manual).path("requiresAcknowledgement").asBoolean());
        assertEquals(200, staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).status);
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
    @Test void acceptedReceiveTimeUsesReviewAndRemainsTheOnlyCurrentTimeAfterCorrections() throws Exception {
        var staff = admin(); var original = content("13800000000", "2026-11-02T18:00:00+08:00");
        String id = submit(entry(staff), original, UUID.randomUUID()).at("/data/submissionId").asText();
        var reviewed = new LinkedHashMap<>(original); reviewed.put("requestedReceiveAt", "2026-11-02T19:00:00+08:00");
        staff.data("PATCH", "/api/customer-submissions/" + id, Map.of("expectedVersion", 0, "review", review(reviewed, staff.id, 12300)));
        String order = staff.data("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", 1)).at("/submission/orderId").asText();
        assertEquals("2026-11-02T11:00:00Z", staff.data("GET", "/api/orders/" + order, null).at("/fulfillment/requestedReceiveAt").asText());
        assertEquals("2026-11-02T10:00:00Z", staff.data("GET", "/api/orders/" + order + "/customer-origin", null).path("requestedReceiveAt").asText());
        var export = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/orders/" + order + "/exports/xlsx"))
                .header("Authorization", "Bearer " + staff.token).POST(HttpRequest.BodyPublishers.noBody()).build();
        var download = staff.http.send(export, HttpResponse.BodyHandlers.ofByteArray()); assertEquals(200, download.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(download.body()))) {
            var text = new StringBuilder(); var formatter = new DataFormatter();
            for (var sheet : book) for (var row : sheet) for (var cell : row) text.append(formatter.formatCellValue(cell)).append('\n');
            assertTrue(text.toString().contains("2026-11-02 19:00"), text.toString());
        }
        assertEquals(400, staff.request("PATCH", "/api/orders/" + order + "/information", Map.of("expectedVersion", 0, "changes", Map.of("requestedReceiveDate", "2026-11-03"))).status);
        var updated = staff.data("PATCH", "/api/orders/" + order + "/information", Map.of("expectedVersion", 0, "changes", Map.of("requestedReceiveAt", "2026-11-03T00:30:00+08:00")));
        assertEquals("2026-11-03", updated.at("/fulfillment/requestedReceiveDate").asText());
        assertEquals("2026-11-02T16:30:00Z", updated.at("/fulfillment/requestedReceiveAt").asText());
        assertEquals("2026-11-02T08:00:00Z", updated.at("/fulfillment/plannedHandoffAt").asText());
        assertEquals(0, staff.data("GET", "/api/orders/calendar?from=2026-11-02&to=2026-11-03", null).size());
        assertEquals(order, staff.data("GET", "/api/orders/calendar?from=2026-11-03&to=2026-11-04", null).get(0).path("orderId").asText());
        var log = staff.data("GET", "/api/orders/" + order + "/activities?type=ORDER_INFORMATION_CHANGED", null).at("/items/0");
        assertEquals("2026-11-02T11:00:00Z", log.at("/details/before/requestedReceiveAt").asText());
        assertEquals("2026-11-02T16:30:00Z", log.at("/details/after/requestedReceiveAt").asText());
    }
    @Test void qrResetsPreserveStateAndAuditRealActorWithoutTokensAndRollbackOnAuditFailure() throws Exception {
        var admin = admin(); var front = employee(admin, "0002", "FRONT_DESK"); String old = entry(front);
        assertEquals(1, entryAuditCount()); entry(front); assertEquals(1, entryAuditCount());
        front.data("POST", "/api/customer-submissions/entry", Map.of("action", "DISABLE"));
        var reset = admin.data("POST", "/api/customer-submissions/entry?ownerId=" + front.id, Map.of("action", "RESET"));
        assertFalse(reset.path("enabled").asBoolean()); String token = reset.path("url").asText().split("/fill/")[1]; assertNotEquals(old, token);
        assertEquals(404, new Client().request("GET", "/api/public/order-entries/" + old, null).status);
        assertEquals(404, new Client().request("GET", "/api/public/order-entries/" + token, null).status);
        var log = jdbc.queryForMap("SELECT actor_id::text,actor_nickname,request_id,details::text FROM audit_operation WHERE action='order.entry_reset'");
        assertEquals(admin.id, log.get("actor_id")); assertNotNull(log.get("request_id"));
        var details = json.readTree((String) log.get("details")); assertEquals(front.id, details.path("ownerId").asText());
        assertEquals("false", details.path("before.enabled").asText()); assertEquals("false", details.path("after.enabled").asText());
        assertEquals("true", details.path("tokenRotated").asText()); assertFalse(log.get("details").toString().contains(old)); assertFalse(log.get("details").toString().contains(token));
        front.data("POST", "/api/customer-submissions/entry", Map.of("action", "ENABLE"));
        long audits = entryAuditCount(); front.data("POST", "/api/customer-submissions/entry", Map.of("action", "ENABLE")); assertEquals(audits, entryAuditCount());
        var enabledReset = front.data("POST", "/api/customer-submissions/entry", Map.of("action", "RESET")); assertTrue(enabledReset.path("enabled").asBoolean());
        String before = enabledReset.path("url").asText(); long beforeCount = entryAuditCount();
        doThrow(new DataAccessResourceFailureException("audit offline")).when(auditOperations).append(argThat(op -> op.action().equals("order.entry_reset")));
        assertEquals(503, front.request("POST", "/api/customer-submissions/entry", Map.of("action", "RESET")).status); reset(auditOperations);
        var after = front.data("GET", "/api/customer-submissions/entry", null); assertEquals(before, after.path("url").asText()); assertTrue(after.path("enabled").asBoolean());
        assertEquals(beforeCount, entryAuditCount());
    }
    @Test void anonymousGetDoesNotWaitForAnExclusiveOwnerLock() throws Exception {
        var staff = admin(); String token = entry(staff); var held = new CountDownLatch(1); var release = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var holder = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                jdbc.queryForObject("SELECT id::text FROM identity_account WHERE id=?::uuid FOR UPDATE", String.class, staff.id); held.countDown(); await(release);
            }));
            try {
                assertTrue(held.await(5, TimeUnit.SECONDS));
                var read = pool.submit(() -> new Client().request("GET", "/api/public/order-entries/" + token, null));
                assertEquals(200, read.get(5, TimeUnit.SECONDS).status);
            } finally { release.countDown(); }
            holder.get(5, TimeUnit.SECONDS);
        }
    }
    @Test void twoDifferentSubmissionsHoldConcurrentSharedOwnerLocks() throws Exception {
        var staff = admin(); String token = entry(staff); var entered = new CountDownLatch(2); var release = new CountDownLatch(1);
        doAnswer(invocation -> { entered.countDown(); await(release); return invocation.callRealMethod(); }).when(store).submit(any(), any(), anyString(), any(), any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> new Client().request("POST", submitPath(token), content("13800000001", "2026-11-02T18:00:00+08:00"), UUID.randomUUID().toString()));
            var second = pool.submit(() -> new Client().request("POST", submitPath(token), content("13800000002", "2026-11-02T18:00:00+08:00"), UUID.randomUUID().toString()));
            try { assertTrue(entered.await(5, TimeUnit.SECONDS), "Both requests must hold the owner's shared lock before either commits"); }
            finally { release.countDown(); }
            assertEquals(201, first.get(10, TimeUnit.SECONDS).status); assertEquals(201, second.get(10, TimeUnit.SECONDS).status);
        }
        assertEquals(2, count("customer_order_submission"));
    }
    @Test void ownerSharedLockBlocksArchivalUntilTheSubmissionCommits() throws Exception {
        var admin = admin(); var front = employee(admin, "0002", "FRONT_DESK"); String token = entry(front);
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        doAnswer(invocation -> { entered.countDown(); await(release); return invocation.callRealMethod(); }).when(store).submit(any(), any(), anyString(), any(), any());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var post = pool.submit(() -> new Client().request("POST", submitPath(token), content("13800000001", "2026-11-02T18:00:00+08:00"), UUID.randomUUID().toString()));
            Future<Result> archive;
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                try (var connection = dataSource.getConnection()) {
                    connection.setAutoCommit(false);
                    try (var statement = connection.prepareStatement("SELECT id FROM identity_account WHERE id=?::uuid FOR UPDATE NOWAIT")) {
                        statement.setString(1, front.id);
                        var blocked = assertThrows(java.sql.SQLException.class, statement::execute); assertEquals("55P03", blocked.getSQLState());
                    } finally { connection.rollback(); }
                    try (var statement = connection.prepareStatement("SELECT id FROM customer_order_entry WHERE token=? FOR UPDATE NOWAIT")) {
                        statement.setString(1, token);
                        var blocked = assertThrows(java.sql.SQLException.class, statement::execute); assertEquals("55P03", blocked.getSQLState());
                    } finally { connection.rollback(); }
                }
                archive = pool.submit(() -> admin.request("POST", "/api/admin/employees/" + front.id + "/archive", Map.of()));
            } finally { release.countDown(); }
            assertEquals(201, post.get(10, TimeUnit.SECONDS).status); assertEquals(200, archive.get(10, TimeUnit.SECONDS).status);
        }
        assertEquals(404, new Client().request("GET", "/api/public/order-entries/" + token, null).status);
        assertEquals(404, new Client().request("POST", submitPath(token), content("13800000002", "2026-11-02T18:00:00+08:00"), UUID.randomUUID().toString()).status);
    }
    @Test void sharedOwnerValidationRequiresTheCallersTransaction() throws Exception {
        var staff = admin();
        assertThrows(org.springframework.transaction.IllegalTransactionStateException.class, () -> identity.lockCustomerEntryOwner(UUID.fromString(staff.id)));
    }
    @Test void receiveTimeMigrationBackfillsOnlyMatchingAcceptedDatesAndLeavesLegacyTimesUnknown() throws Exception {
        String migrationSchema = "receive_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = dataSource.getConnection()) {
            var single = new SingleConnectionDataSource(connection, true);
            Flyway.configure().dataSource(single).schemas(migrationSchema).defaultSchema(migrationSchema).locations("classpath:db/migration").target("12").load().migrate();
            connection.setSchema(migrationSchema); var old = new JdbcTemplate(single);
            UUID owner = UUID.randomUUID(), entry = UUID.randomUUID();
            old.update("INSERT INTO customer_order_entry(id,owner_id,owner_name,token,enabled) VALUES(?,?,?,'migration-token',true)", entry, owner, "合成客服");
            for (int i = 0; i < 3; i++) {
                UUID order = UUID.randomUUID();
                String date = i == 1 ? "2026-11-03" : "2026-11-02";
                old.update("INSERT INTO cake_order(id,order_no,status,customer_phone,fulfillment_type,requested_receive_date,planned_handoff_at,created_by,created_at,confirmed_at,updated_at)"
                        + " VALUES(?,?,'WAITING_PRODUCTION','13800000000','PICKUP',?::date,'2026-11-02T08:00:00Z',?,now(),now(),now())", order, "OLD-" + i, date, owner);
                if (i < 2) {
                    UUID submission = UUID.randomUUID(); var original = content("13800000000", "2026-11-02T18:00:00+08:00");
                    var accepted = new LinkedHashMap<>(original); accepted.put("requestedReceiveAt", "2026-11-02T19:00:00+08:00");
                    old.update("INSERT INTO customer_order_submission(id,entry_id,owner_id,owner_name,request_id,fingerprint,original,reviewed,original_phone,requested_date,status,order_id,created_at,updated_at)"
                            + " VALUES(?,?,?,'合成客服',?,'fingerprint',?::jsonb,?::jsonb,'13800000000','2026-11-02','CONFIRMED',?,now(),now())",
                            submission, entry, owner, UUID.randomUUID(), json.writeValueAsString(original), json.writeValueAsString(review(accepted, owner.toString(), 10000)), order);
                    old.update("UPDATE cake_order SET source='CUSTOMER_SUBMITTED',source_submission_id=? WHERE id=?", submission, order);
                }
            }
            Flyway.configure().dataSource(single).schemas(migrationSchema).defaultSchema(migrationSchema).locations("classpath:db/migration").load().migrate();
            connection.setSchema(migrationSchema);
            assertEquals(Instant.parse("2026-11-02T11:00:00Z"), old.queryForObject("SELECT requested_receive_at FROM cake_order WHERE order_no='OLD-0'", java.sql.Timestamp.class).toInstant());
            assertNull(old.queryForObject("SELECT requested_receive_at FROM cake_order WHERE order_no='OLD-1'", java.sql.Timestamp.class));
            assertNull(old.queryForObject("SELECT requested_receive_at FROM cake_order WHERE order_no='OLD-2'", java.sql.Timestamp.class));
            assertEquals("2026-11-03", old.queryForObject("SELECT requested_receive_date::text FROM cake_order WHERE order_no='OLD-1'", String.class));
        } finally { jdbc.execute("DROP SCHEMA IF EXISTS " + migrationSchema + " CASCADE"); }
    }
    private Set<String> duplicateIds(JsonNode detail) {
        var ids = new HashSet<String>(); detail.path("duplicates").forEach(record -> ids.add(record.path("id").asText())); return ids;
    }
    private JsonNode duplicate(JsonNode detail, String id) {
        for (var record : detail.path("duplicates")) if (id.equals(record.path("id").asText())) return record;
        throw new AssertionError("Missing duplicate " + id + ": " + detail);
    }
    private Result confirmWithToken(Client staff, String id, JsonNode detail) throws Exception {
        return staff.request("POST", "/api/customer-submissions/" + id + "/confirm", Map.of("expectedVersion", detail.at("/submission/version").asLong(),
                "duplicateCheckToken", detail.path("duplicateCheckToken").asText()));
    }
    private String manualOrder(Client staff, String phone, String date) throws Exception {
        return staff.data("POST", "/api/orders", Map.of("customer", Map.of("phone", phone),
                "fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", date, "plannedHandoffAt", date + "T16:00:00+08:00"),
                "items", List.of(Map.of("name", "手工蛋糕", "productType", "CAKE", "quantity", 2, "attributes", Map.of("size", "8"))),
                "totalAmountCents", 9900)).path("orderId").asText();
    }
    private long entryAuditCount() { return jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action LIKE 'order.entry_%'", Long.class); }
    private static void await(CountDownLatch latch) {
        try { if (!latch.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("Transaction barrier timed out"); }
        catch (InterruptedException failure) { Thread.currentThread().interrupt(); throw new IllegalStateException(failure); }
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

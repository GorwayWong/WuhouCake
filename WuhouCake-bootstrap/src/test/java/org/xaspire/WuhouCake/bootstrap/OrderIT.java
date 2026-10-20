package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.domain.repository.OrderActivities;
import org.xaspire.WuhouCake.order.domain.repository.Orders;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderQueryMapper;

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
    @Autowired OrderService orderService;
    @Autowired PlatformTransactionManager transactions;
    @MockitoSpyBean OrderActivities activities;
    @MockitoSpyBean Orders orders;
    @MockitoSpyBean Clock clock;
    @MockitoSpyBean OrderQueryMapper queryMapper;
    @BeforeEach void clean() {
        reset(activities, orders, clock, queryMapper);
        jdbc.execute("TRUNCATE cake_order_activity, cake_order_item, cake_order, audit_operation, identity_account_role, identity_account CASCADE");
        clearSessions();
    }
    @AfterAll void removeTestData() {
        reset(activities, orders, clock, queryMapper); clearSessions();
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
        changes.put("memberPriceCents", null); changes.put("attributes", Map.of("size", "10", "flavors", List.of("草莓")));
        var revised = staff.request("PATCH", "/api/orders/" + orderId, patch(first, 0, changes));
        assertEquals(200, revised.status, revised.body.toString()); assertEquals(1, revised.body.at("/data/version").asLong());
        var after = staff.request("GET", "/api/orders/" + orderId, null).body.path("data");
        assertEquals(item(before, second), item(after, second));
        var changed = item(after, first);
        assertEquals("生日蛋糕", changed.path("name").asText()); assertEquals(2, changed.path("quantity").asInt());
        assertEquals("10", changed.at("/attributes/size").asText()); assertEquals("生日快乐", changed.at("/attributes/greeting").asText());
        assertTrue(changed.path("memberPriceCents").isNull()); assertEquals("NOT_STARTED", changed.path("productionStatus").asText());
        assertEquals(start.plusSeconds(1), Instant.parse(changed.path("updatedAt").asText()));
        assertEquals(start.plusSeconds(1), Instant.parse(after.path("updatedAt").asText()));
        assertEquals("10", jdbc.queryForObject("SELECT attributes->>'size' FROM cake_order_item WHERE id=?::uuid", String.class, first));
        assertEquals(2, jdbc.queryForObject("SELECT quantity FROM cake_order_item WHERE id=?::uuid", Integer.class, first));

        var stale = staff.request("PATCH", "/api/orders/" + orderId, patch(first, 0, Map.of("quantity", 99)));
        assertEquals(409, stale.status); assertEquals("CONCURRENT_MODIFICATION", stale.body.path("code").asText());
        assertEquals(after, staff.request("GET", "/api/orders/" + orderId, null).body.path("data"));
        var history = staff.request("GET", "/api/orders/" + orderId + "/activities?itemId=" + first + "&type=ITEM_CHANGED", null);
        assertEquals(200, history.status); assertEquals(1, history.body.at("/data/total").asLong());
        var log = history.body.at("/data/items/0");
        assertEquals("蛋糕", log.at("/details/before/name").asText()); assertEquals("生日蛋糕", log.at("/details/after/name").asText());
        assertEquals("8", log.at("/details/before/attributes/size").asText()); assertEquals("10", log.at("/details/after/attributes/size").asText());
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
        assertEquals(before.at("/items/0/quantity").asInt(), jdbc.queryForObject("SELECT quantity FROM cake_order_item WHERE id=?::uuid", Integer.class, first));
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
        assertEquals(401, anonymous.request("GET", "/api/orders/calendar?from=2026-09-28&to=2026-11-09", null).status);
        assertEquals(401, anonymous.request("GET", "/api/orders/workbench?date=2026-09-30", null).status);
        assertEquals(401, anonymous.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("quantity", 2))).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "备注")).status);
        assertEquals(401, anonymous.request("GET", "/api/orders/" + id + "/activities", null).status);
        assertEquals(401, anonymous.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/production-actions", action(0, "START_PRODUCTION")).status);
        assertEquals(401, anonymous.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("phone", "13900000000"))).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 0, "item", Map.of("name", "C", "quantity", 1))).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/items/" + itemId + "/remove", Map.of("expectedVersion", 0)).status);
        assertEquals(404, staff.request("GET", "/api/orders/" + UUID.randomUUID(), null).status);
        assertEquals(404, staff.request("PATCH", "/api/orders/" + UUID.randomUUID() + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        assertEquals(404, staff.request("POST", "/api/orders/" + UUID.randomUUID() + "/production-actions", action(0, "START_PRODUCTION")).status);
        assertEquals(404, staff.request("PATCH", "/api/orders/" + id, patch(foreign, 0, Map.of("quantity", 2))).status);
        assertEquals(404, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", foreign, "content", "串单")).status);
        assertEquals(404, staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + foreign, null).status);
        assertEquals(404, staff.request("POST", "/api/orders/" + id + "/items/" + foreign + "/remove", Map.of("expectedVersion", 0)).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 0, "item", Map.of("name", "C", "quantity", 1.5))).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 0, "item", Map.of("name", "C", "quantity", 1, "productionStatus", "COMPLETED"))).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/items/" + itemId + "/remove", Map.of("expectedVersion", 0.5)).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("status", "COMPLETED"))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("productionStatus", "READY"))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of())).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, Map.of("itemId", itemId, "changes", Map.of("quantity", 2))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0.5, Map.of("quantity", 2))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("quantity", 1.5))).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", " ")).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("paymentStatus", "PAID")).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0.5, "START_PRODUCTION")).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", 0, "action", "START_PRODUCTION", "status", "WAITING_DELIVERY")).status);
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

    @Test void wholeOrderProductionPaymentAndReopeningHaveCompleteAuditedHistory() throws Exception {
        var staff = staff(); var start = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        doReturn(start).when(clock).instant();
        var original = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = original.path("orderId").asText(), first = idForName(original, "蛋糕"), second = idForName(original, "纸杯");
        doReturn(start.plusSeconds(1)).when(clock).instant();
        var paid = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID"));
        assertEquals(200, paid.status, paid.body.toString()); assertEquals(1, paid.body.at("/data/version").asLong());
        assertEquals(original.path("items"), paid.body.at("/data/items"));
        assertEquals(start.plusSeconds(1), Instant.parse(paid.body.at("/data/updatedAt").asText()));
        doReturn(start.plusSeconds(2)).when(clock).instant();
        var noop = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "PAID"));
        assertEquals(200, noop.status); assertEquals(paid.body.path("data"), noop.body.path("data"));
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        var started = production(staff, id, 1, "START_PRODUCTION");
        assertEquals("PROCESSING", started.path("status").asText()); assertEquals(2, started.path("version").asLong());
        for (var item : started.path("items")) {
            assertEquals("IN_PROGRESS", item.path("productionStatus").asText());
            assertEquals(start.plusSeconds(2), Instant.parse(item.path("updatedAt").asText()));
        }
        doReturn(start.plusSeconds(3)).when(clock).instant();
        var layer = production(staff, id, 2, "COMPLETE_LAYER");
        assertEquals("LAYER_DONE", layer.path("currentStageCode").asText()); assertEquals(started.path("items"), layer.path("items"));
        assertEquals(start.plusSeconds(3), Instant.parse(layer.path("updatedAt").asText()));
        doReturn(start.plusSeconds(4)).when(clock).instant();
        var frosted = production(staff, id, 3, "COMPLETE_FROSTING");
        assertEquals("FROSTING_DONE", frosted.path("currentStageCode").asText()); assertEquals(started.path("items"), frosted.path("items"));
        doReturn(start.plusSeconds(5)).when(clock).instant();
        var completed = production(staff, id, 4, "COMPLETE_PRODUCTION");
        assertEquals("WAITING_DELIVERY", completed.path("status").asText()); assertEquals(5, completed.path("version").asLong());
        for (var item : completed.path("items")) {
            assertEquals("COMPLETED", item.path("productionStatus").asText()); assertTrue(item.path("currentStageCode").isNull());
            assertEquals(start.plusSeconds(5), Instant.parse(item.path("updatedAt").asText()));
        }
        assertEquals(completed, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        assertEquals("FROSTING_DONE", jdbc.queryForObject("SELECT current_stage_code FROM cake_order WHERE id=?::uuid", String.class, id));
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id, patch(first, 5, Map.of("quantity", 2))).status);
        assertEquals(completed, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        doReturn(start.plusSeconds(6)).when(clock).instant();
        var reopened = production(staff, id, 5, "REOPEN_PRODUCTION");
        assertEquals("PROCESSING", reopened.path("status").asText()); assertTrue(reopened.path("currentStageCode").isNull());
        assertEquals("IN_PROGRESS", item(reopened, first).path("productionStatus").asText());
        doReturn(start.plusSeconds(7)).when(clock).instant();
        var revised = staff.request("PATCH", "/api/orders/" + id, patch(first, 6, Map.of("quantity", 2)));
        assertEquals(200, revised.status); assertEquals(item(reopened, second), item(revised.body.path("data"), second));
        doReturn(start.plusSeconds(8)).when(clock).instant();
        var confirmed = production(staff, id, 7, "COMPLETE_PRODUCTION");
        assertEquals("WAITING_DELIVERY", confirmed.path("status").asText()); assertEquals(8, confirmed.path("version").asLong());
        var payments = staff.request("GET", "/api/orders/" + id + "/activities?type=PAYMENT_STATUS_CHANGED", null);
        assertEquals(200, payments.status); assertEquals(1, payments.body.at("/data/total").asLong());
        var paymentLog = payments.body.at("/data/items/0");
        assertEquals("UNPAID", paymentLog.at("/details/before/paymentStatus").asText());
        assertEquals("PAID", paymentLog.at("/details/after/paymentStatus").asText());
        var productions = staff.request("GET", "/api/orders/" + id + "/activities?type=ORDER_PRODUCTION_CHANGED", null);
        assertEquals(200, productions.status); assertEquals(6, productions.body.at("/data/total").asLong());
        for (var log : productions.body.at("/data/items")) {
            assertTrue(log.path("itemId").isNull()); assertEquals(staff.accountId, log.path("actorId").asText());
            assertEquals("前台员工", log.path("actorNameSnapshot").asText());
            if (log.at("/details/action").asText().equals("COMPLETE_LAYER")) {
                assertTrue(log.at("/details/before/currentStageCode").isNull());
                assertEquals("LAYER_DONE", log.at("/details/after/currentStageCode").asText());
                assertEquals(0, log.at("/details/itemChanges").size());
            } else if (log.at("/details/action").asText().equals("REOPEN_PRODUCTION")) {
                assertEquals("WAITING_DELIVERY", log.at("/details/before/status").asText());
                assertEquals("PROCESSING", log.at("/details/after/status").asText());
                assertTrue(log.at("/details/after/currentStageCode").isNull()); assertEquals(2, log.at("/details/itemChanges").size());
            }
        }
        assertEquals(staff.accountId, paymentLog.path("actorId").asText());
        assertEquals(start.plusSeconds(1), Instant.parse(paymentLog.path("createdAt").asText()));
        assertEquals(9, staff.request("GET", "/api/orders/" + id + "/activities", null).body.at("/data/total").asLong());
    }
    @Test void optionalStagesInvalidActionsAndPaymentCorrectionsPreserveSavedData() throws Exception {
        var staff = staff();
        for (var type : List.of("DELIVERY", "PICKUP")) {
            var request = new LinkedHashMap<String, Object>(create());
            request.put("fulfillment", Map.of("type", type, "address", "示例地址", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"));
            var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
            for (var action : List.of("COMPLETE_LAYER", "COMPLETE_FROSTING", "COMPLETE_PRODUCTION", "REOPEN_PRODUCTION"))
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, action)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, "CANCEL")).status);
            assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "REFUNDED")).status);
            assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            var started = production(staff, id, 0, "START_PRODUCTION");
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(1, "START_PRODUCTION")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(1, "COMPLETE_FROSTING")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, "COMPLETE_PRODUCTION")).status);
            assertEquals(started, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            var completed = production(staff, id, 1, "COMPLETE_PRODUCTION");
            assertEquals(type.equals("DELIVERY") ? "WAITING_DELIVERY" : "WAITING_PICKUP", completed.path("status").asText());
            assertTrue(completed.path("currentStageCode").isNull());
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(2, "COMPLETE_PRODUCTION")).status);
            assertEquals(completed, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 2, "paymentStatus", "PAID")).status);
            var corrected = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 3, "paymentStatus", "UNPAID"));
            assertEquals(200, corrected.status); assertEquals(4, corrected.body.at("/data/version").asLong());
            assertEquals(completed.path("items"), corrected.body.at("/data/items"));
        }
    }
    @Test void concurrentPaymentAndProductionWithSameVersionHaveOneWinner() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")); });
            var b = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, "START_PRODUCTION")); });
            start.countDown(); var responses = List.of(a.get(), b.get());
            assertEquals(Set.of(200, 409), Set.of(responses.get(0).status, responses.get(1).status));
            var winner = responses.stream().filter(response -> response.status == 200).findFirst().orElseThrow();
            assertEquals(winner.body.path("data"), staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        }
        assertEquals(1L, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type IN ('PAYMENT_STATUS_CHANGED', 'ORDER_PRODUCTION_CHANGED')", Long.class));
    }
    @Test void paymentNoopRejectsConcurrentUpdateAfterLoadingTheOrder() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        var loaded = new CountDownLatch(1); var proceed = new CountDownLatch(1);
        doAnswer(invocation -> {
            loaded.countDown(); if (!proceed.await(10, TimeUnit.SECONDS)) throw new AssertionError("concurrent update did not finish");
            return invocation.callRealMethod();
        }).when(orders).verifyVersion(UUID.fromString(id), 0);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var noop = executor.submit(() -> staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "UNPAID")));
            try {
                assertTrue(loaded.await(10, TimeUnit.SECONDS));
                var changed = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID"));
                assertEquals(200, changed.status); proceed.countDown();
                var rejected = noop.get(10, TimeUnit.SECONDS);
                assertEquals(409, rejected.status); assertEquals("CONCURRENT_MODIFICATION", rejected.body.path("code").asText());
                assertEquals(changed.body.path("data"), staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='PAYMENT_STATUS_CHANGED'", Long.class));
            } finally { proceed.countDown(); }
        }
    }
    @Test void activityFailureRollsBackPaymentOrderStagesAndSynchronizedItems() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        try (var stream = staff.stream()) {
            doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("PAYMENT_STATUS_CHANGED")));
            assertEquals(503, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
            stream.noChange();
            reset(activities); assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            for (var action : List.of("START_PRODUCTION", "COMPLETE_LAYER", "COMPLETE_PRODUCTION", "REOPEN_PRODUCTION")) {
                var before = staff.request("GET", "/api/orders/" + id, null).body.path("data"); long version = before.path("version").asLong();
                long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
                doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("ORDER_PRODUCTION_CHANGED")));
                assertEquals(503, staff.request("POST", "/api/orders/" + id + "/production-actions", action(version, action)).status);
                stream.noChange();
                reset(activities); assertEquals(before, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals(version, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
                assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
                production(staff, id, version, action);
                stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", version + 1);
            }
            assertEquals(0L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='PAYMENT_STATUS_CHANGED'", Long.class));
        }
    }
    @Test void authenticatedStaffReceiveAllChangesAndRefetchProductionAndNotes() throws Exception {
        var staff = staff(); var peer = new Client(); peer.login("0001", PASSWORD);
        assertEquals(401, new Client().request("GET", "/api/orders/stream", null).status);
        try (var a = staff.stream(); var b = peer.stream()) {
            var created = staff.request("POST", "/api/orders", create()); assertEquals(201, created.status);
            var original = created.body.path("data"); String id = original.path("orderId").asText(), itemId = idForName(original, "蛋糕");
            for (var stream : List.of(a, b)) stream.changed(id, null, "CREATED", 0);
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of("quantity", 2))).status);
            for (var stream : List.of(a, b)) stream.changed(id, itemId, "ITEM_CHANGED", 1);
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "PAID")).status);
            for (var stream : List.of(a, b)) stream.changed(id, null, "PAYMENT_STATUS_CHANGED", 2);
            production(staff, id, 2, "START_PRODUCTION");
            for (var stream : List.of(a, b)) stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 3);
            production(staff, id, 3, "COMPLETE_LAYER");
            for (var stream : List.of(a, b)) stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 4);
            var latest = peer.request("GET", "/api/orders/" + id, null).body.path("data");
            assertEquals("LAYER_DONE", latest.path("currentStageCode").asText()); assertEquals(4, latest.path("version").asLong());
            for (var item : latest.path("items")) assertTrue(item.path("currentStageCode").isNull());
            assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", itemId, "content", "客户要求少糖")).status);
            for (var stream : List.of(a, b)) stream.changed(id, itemId, "NOTE", 4);
            latest = peer.request("GET", "/api/orders/" + id, null).body.path("data");
            assertEquals(4, latest.path("version").asLong()); assertEquals(List.of("客户要求少糖"), contents(item(latest, itemId).path("recentNotes")));
            var notes = peer.request("GET", "/api/orders/" + id + "/activities?itemId=" + itemId + "&type=NOTE", null);
            assertEquals("客户要求少糖", notes.body.at("/data/items/0/content").asText());
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 4, Map.of("quantity", 2))).status);
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 4, "paymentStatus", "PAID")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(3, "COMPLETE_FROSTING")).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", itemId, "content", " ")).status);
            a.noChange(); b.noChange(); a.close();
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 4, "paymentStatus", "UNPAID")).status);
            b.changed(id, null, "PAYMENT_STATUS_CHANGED", 5);
            assertEquals("UNPAID", peer.request("GET", "/api/orders/" + id, null).body.at("/data/paymentStatus").asText());
        }
    }
    @Test void outerTransactionRollbackSuppressesAnAlreadyPublishedNoteEvent() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        try (var stream = staff.stream()) {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                orderService.note(UUID.fromString(id), new OrderCommands.Note(null, "应回滚备注"), new OrderCommands.Operator(UUID.fromString(staff.accountId), "前台员工"));
                status.setRollbackOnly();
            });
            stream.noChange();
            assertEquals(0, staff.request("GET", "/api/orders/" + id + "/activities?type=NOTE", null).body.at("/data/total").asLong());
            assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        }
    }
    private static Map<String, Object> action(Number version, String action) { return Map.of("expectedVersion", version, "action", action); }
    @Test void deliveryAndPickupCloseOrdersWithAuditedRealtimeHandoff() throws Exception {
        var staff = staff(); var peer = new Client(); peer.login("0001", PASSWORD);
        for (var type : List.of("DELIVERY", "PICKUP")) {
            var request = new LinkedHashMap<String, Object>(create());
            request.put("fulfillment", Map.of("type", type, "address", "示例地址", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"));
            var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(0, "START_DELIVERY")).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(0, "SHIP")).status);
            production(staff, id, 0, "START_PRODUCTION"); production(staff, id, 1, "COMPLETE_LAYER");
            var ready = production(staff, id, 2, "COMPLETE_PRODUCTION");
            assertEquals(type.equals("DELIVERY") ? "WAITING_DELIVERY" : "WAITING_PICKUP", ready.path("status").asText());
            try (var stream = peer.stream()) {
                var wrongActions = type.equals("DELIVERY") ? List.of("CONFIRM_PICKUP", "COMPLETE_DELIVERY") : List.of("START_DELIVERY", "COMPLETE_DELIVERY");
                for (var wrong : wrongActions)
                    assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(3, wrong)).status);
                stream.noChange(); assertEquals(ready, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
                JsonNode completed;
                if (type.equals("DELIVERY")) {
                    var delivering = fulfillment(staff, id, 3, "START_DELIVERY"); stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", 4);
                    assertEquals("DELIVERING", delivering.path("status").asText()); assertEquals(ready.path("items"), delivering.path("items"));
                    assertEquals(delivering, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
                    completed = fulfillment(staff, id, 4, "COMPLETE_DELIVERY");
                } else completed = fulfillment(staff, id, 3, "CONFIRM_PICKUP");
                long version = completed.path("version").asLong(); stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", version);
                assertEquals("COMPLETED", completed.path("status").asText()); assertEquals("UNPAID", completed.path("paymentStatus").asText());
                assertEquals("LAYER_DONE", completed.path("currentStageCode").asText()); assertEquals(ready.path("items"), completed.path("items"));
                assertEquals(completed, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals("COMPLETED", jdbc.queryForObject("SELECT status FROM cake_order WHERE id=?::uuid", String.class, id));
                assertEquals(version, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
                var logs = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_FULFILLMENT_CHANGED", null);
                assertEquals(type.equals("DELIVERY") ? 2 : 1, logs.body.at("/data/total").asLong()); var log = logs.body.at("/data/items/0");
                assertEquals(type.equals("DELIVERY") ? "COMPLETE_DELIVERY" : "CONFIRM_PICKUP", log.at("/details/action").asText());
                assertEquals(type.equals("DELIVERY") ? "DELIVERING" : "WAITING_PICKUP", log.at("/details/before/status").asText());
                assertEquals("COMPLETED", log.at("/details/after/status").asText()); assertTrue(log.path("itemId").isNull());
                assertEquals(staff.accountId, log.path("actorId").asText()); assertEquals("前台员工", log.path("actorNameSnapshot").asText());
                assertEquals(completed.path("updatedAt"), log.path("createdAt"));
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(version, type.equals("DELIVERY") ? "COMPLETE_DELIVERY" : "CONFIRM_PICKUP")).status);
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", version, "reason", "重复取消")).status);
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(version, "REOPEN_PRODUCTION")).status);
                assertEquals(409, staff.request("PATCH", "/api/orders/" + id, patch(idForName(completed, "蛋糕"), version, Map.of("quantity", 2))).status);
                stream.noChange();
                assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "交付后备注")).status);
                stream.changed(id, null, "NOTE", version);
                assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", version, "paymentStatus", "PAID")).status);
                stream.changed(id, null, "PAYMENT_STATUS_CHANGED", version + 1);
                var after = peer.request("GET", "/api/orders/" + id, null).body.path("data");
                assertEquals("COMPLETED", after.path("status").asText()); assertEquals("PAID", after.path("paymentStatus").asText());
            }
        }
    }
    @Test void deliveryCancellationPreservesPaymentProductionNotesAndReason() throws Exception {
        var staff = staff(); var peer = new Client(); peer.login("0001", PASSWORD);
        var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText(), itemId = idForName(original, "蛋糕");
        assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        production(staff, id, 1, "START_PRODUCTION"); production(staff, id, 2, "COMPLETE_LAYER"); production(staff, id, 3, "COMPLETE_PRODUCTION");
        fulfillment(staff, id, 4, "START_DELIVERY");
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", itemId, "content", "原有备注")).status);
        var before = peer.request("GET", "/api/orders/" + id, null).body.path("data");
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        try (var stream = peer.stream()) {
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 5, "reason", " ")).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 5)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 5.5, "reason", "取消")).status);
            var stale = staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 4, "reason", "取消"));
            assertEquals(409, stale.status); assertEquals("CONCURRENT_MODIFICATION", stale.body.path("code").asText());
            stream.noChange(); assertEquals(before, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            var result = staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 5, "reason", " 配送异常，客户确认取消 "));
            assertEquals(200, result.status, result.body.toString()); stream.changed(id, null, "ORDER_CANCELLED", 6);
            var cancelled = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(result.body.path("data"), cancelled);
            assertEquals("CANCELLED", cancelled.path("status").asText()); assertEquals("PAID", cancelled.path("paymentStatus").asText());
            assertEquals("LAYER_DONE", cancelled.path("currentStageCode").asText()); assertEquals(before.path("items"), cancelled.path("items"));
            assertEquals(6, cancelled.path("version").asLong()); assertEquals(count + 1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            var logs = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_CANCELLED", null);
            assertEquals(1, logs.body.at("/data/total").asLong()); var log = logs.body.at("/data/items/0");
            assertEquals("配送异常，客户确认取消", log.path("content").asText()); assertEquals("DELIVERING", log.at("/details/before/status").asText());
            assertEquals("CANCELLED", log.at("/details/after/status").asText()); assertEquals(staff.accountId, log.path("actorId").asText());
            assertEquals("前台员工", log.path("actorNameSnapshot").asText()); assertEquals(cancelled.path("updatedAt"), log.path("createdAt"));
            assertEquals(409, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 6, Map.of("quantity", 2))).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(6, "REOPEN_PRODUCTION")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(6, "COMPLETE_DELIVERY")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 6, "reason", "重复取消")).status);
            stream.noChange();
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 6, "paymentStatus", "UNPAID")).status);
            stream.changed(id, null, "PAYMENT_STATUS_CHANGED", 7);
            assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", itemId, "content", "人工退款处理备注")).status);
            stream.changed(id, itemId, "NOTE", 7);
            var after = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals("CANCELLED", after.path("status").asText());
            assertEquals("UNPAID", after.path("paymentStatus").asText()); assertEquals(List.of("人工退款处理备注", "原有备注"), contents(item(after, itemId).path("recentNotes")));
        }
    }
    @Test void sameVersionFulfillmentAndCancellationHaveOneCommitLogAndNotification() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "START_PRODUCTION"); var ready = production(staff, id, 1, "COMPLETE_PRODUCTION");
        try (var stream = staff.stream(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(2, "START_DELIVERY")); });
            var b = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 2, "reason", "取消")); });
            start.countDown(); var responses = List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertEquals(Set.of(200, 409), Set.of(responses.get(0).status, responses.get(1).status));
            var winner = responses.stream().filter(response -> response.status == 200).findFirst().orElseThrow();
            var loser = responses.stream().filter(response -> response.status == 409).findFirst().orElseThrow(); assertEquals("CONCURRENT_MODIFICATION", loser.body.path("code").asText());
            var latest = staff.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(winner.body.path("data"), latest);
            assertEquals(3, latest.path("version").asLong()); assertEquals(ready.path("items"), latest.path("items"));
            stream.changed(id, null, latest.path("status").asText().equals("CANCELLED") ? "ORDER_CANCELLED" : "ORDER_FULFILLMENT_CHANGED", 3); stream.noChange();
            assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type IN ('ORDER_FULFILLMENT_CHANGED', 'ORDER_CANCELLED')", Long.class, id));
        }
    }
    @Test void activityFailureAndOuterRollbackRestoreStatusHistoryAndSuppressSse() throws Exception {
        var staff = staff(); var request = new LinkedHashMap<String, Object>(create());
        request.put("fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"));
        var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "START_PRODUCTION"); var ready = production(staff, id, 1, "COMPLETE_PRODUCTION");
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        try (var stream = staff.stream()) {
            for (boolean fulfillment : List.of(true, false)) {
                String type = fulfillment ? "ORDER_FULFILLMENT_CHANGED" : "ORDER_CANCELLED";
                doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals(type)));
                var failed = staff.request("POST", "/api/orders/" + id + (fulfillment ? "/fulfillment-actions" : "/cancel"),
                        fulfillment ? action(2, "CONFIRM_PICKUP") : Map.of("expectedVersion", 2, "reason", "取消"));
                assertEquals(503, failed.status); reset(activities); stream.noChange();
                assertEquals(ready, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
                new TransactionTemplate(transactions).executeWithoutResult(status -> {
                    var actor = new OrderCommands.Operator(UUID.fromString(staff.accountId), "前台员工");
                    if (fulfillment) orderService.fulfillmentAction(UUID.fromString(id), new OrderCommands.FulfillmentAction(2, "CONFIRM_PICKUP"), actor);
                    else orderService.cancel(UUID.fromString(id), new OrderCommands.Cancel(2, "取消"), actor);
                    status.setRollbackOnly();
                });
                stream.noChange(); assertEquals(ready, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            }
        }
    }
    private JsonNode fulfillment(Client staff, String id, Number version, String action) throws Exception {
        var result = staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(version, action));
        assertEquals(200, result.status, result.body.toString()); return result.body.path("data");
    }
    @Test void removalKeepsOriginalItemAndHistoryAndRequiresReopening() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = original.path("orderId").asText(), first = idForName(original, "蛋糕"), second = idForName(original, "纸杯");
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", second, "content", "原商品备注")).status);
        production(staff, id, 0, "START_PRODUCTION"); var ready = production(staff, id, 1, "COMPLETE_PRODUCTION");
        assertEquals(409, staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 2)).status);
        var reopened = production(staff, id, 2, "REOPEN_PRODUCTION");
        try (var stream = staff.stream()) {
            var removed = staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 3));
            assertEquals(200, removed.status, removed.body.toString()); stream.changed(id, second, "ITEM_REMOVED", 4);
            var latest = removed.body.path("data"); assertEquals(1, latest.path("items").size()); assertEquals(item(reopened, first), item(latest, first));
            assertTrue(jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, second));
            assertEquals("纸杯", jdbc.queryForObject("SELECT name FROM cake_order_item WHERE id=?::uuid", String.class, second));
            var history = staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + second, null);
            assertEquals(200, history.status); assertEquals(2, history.body.at("/data/total").asLong());
            assertEquals("原商品备注", staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + second + "&type=NOTE", null).body.at("/data/items/0/content").asText());
            var log = history.body.at("/data/items/0"); assertEquals("ITEM_REMOVED", log.path("type").asText());
            assertEquals("纸杯", log.at("/details/before/name").asText()); assertFalse(log.at("/details/before/isRemoved").asBoolean());
            assertTrue(log.at("/details/after/isRemoved").asBoolean());
            assertEquals(latest, staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 4)).body.path("data"));
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 3)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/items/" + first + "/remove", Map.of("expectedVersion", 4)).status);
            assertEquals(404, staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + UUID.randomUUID(), null).status);
            assertEquals(404, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", second, "content", "不可修改已移除商品")).status);
            stream.noChange(); assertEquals(latest, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        }
    }
    @Test void removalRollbackLeavesItemsVersionHistoryAndSseUnchanged() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = original.path("orderId").asText(), second = idForName(original, "纸杯");
        try (var stream = staff.stream()) {
            doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("ITEM_REMOVED")));
            assertEquals(503, staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 0)).status);
            reset(activities); stream.noChange(); assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                orderService.removeItem(UUID.fromString(id), UUID.fromString(second), new OrderCommands.RemoveItem(0),
                        new OrderCommands.Operator(UUID.fromString(staff.accountId), "前台员工")); status.setRollbackOnly();
            });
            stream.noChange(); assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertFalse(jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, second));
            assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            assertEquals(2L, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE order_id=?::uuid", Long.class, id));
        }
    }
    @Test void informationAdditionRemovalWorkflowNotifiesPeersAndKeepsOriginalHistory() throws Exception {
        var staff = staff(); var peer = new Client(); peer.login("0001", PASSWORD);
        var request = new LinkedHashMap<String, Object>(create()); request.put("totalAmountCents", 25000);
        var original = staff.request("POST", "/api/orders", request).body.path("data");
        String id = original.path("orderId").asText(), first = idForName(original, "蛋糕"), second = idForName(original, "纸杯");
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", second, "content", "B 原有备注")).status);
        production(staff, id, 0, "START_PRODUCTION"); production(staff, id, 1, "COMPLETE_LAYER");
        var frosted = production(staff, id, 2, "COMPLETE_FROSTING");
        try (var stream = peer.stream()) {
            var changes = new LinkedHashMap<String, Object>();
            changes.put("customerName", "更正客户"); changes.put("phone", "13900000000"); changes.put("memberPhone", "13700000000");
            changes.put("buyerName", "下单人"); changes.put("address", "新配送地址"); changes.put("requestedReceiveDate", "2026-10-17");
            changes.put("requestedReceiveAt", "2026-10-17T19:00:00+08:00");
            changes.put("plannedHandoffAt", "2026-10-17T12:00:00+08:00"); changes.put("plannedFinishAt", "2026-10-17T11:00:00+08:00");
            changes.put("totalAmountCents", 28000);
            var corrected = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 3, "changes", changes));
            assertEquals(200, corrected.status, corrected.body.toString()); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 4);
            var correctedData = corrected.body.path("data"); assertEquals("FROSTING_DONE", correctedData.path("currentStageCode").asText());
            assertEquals(frosted.path("items"), correctedData.path("items")); assertEquals(correctedData, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            var log = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).body.at("/data/items/0");
            assertEquals("13800000000", log.at("/details/before/phone").asText()); assertEquals("13900000000", log.at("/details/after/phone").asText());
            assertEquals(25000, log.at("/details/before/totalAmountCents").asLong()); assertEquals(28000, log.at("/details/after/totalAmountCents").asLong());
            assertEquals(staff.accountId, log.path("actorId").asText()); assertEquals(correctedData.path("updatedAt"), log.path("createdAt"));
            var added = staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 4,
                    "item", Map.of("name", "商品 C", "productType", "OTHER", "quantity", 1, "unitPriceCents", 500, "attributes", Map.of("flavor", "香草"))));
            assertEquals(201, added.status, added.body.toString()); var addedData = added.body.path("data"); String third = idForName(addedData, "商品 C");
            assertNotEquals(first, third); assertNotEquals(second, third); stream.changed(id, third, "ITEM_ADDED", 5);
            assertEquals(3, addedData.path("items").size()); assertEquals("PROCESSING", addedData.path("status").asText()); assertTrue(addedData.path("currentStageCode").isNull());
            assertEquals("IN_PROGRESS", item(addedData, third).path("productionStatus").asText()); assertTrue(item(addedData, third).path("currentStageCode").isNull());
            assertEquals(item(correctedData, first), item(addedData, first)); assertEquals(item(correctedData, second), item(addedData, second));
            assertEquals(28000, addedData.path("totalAmountCents").asLong()); assertEquals(addedData, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            var addLog = peer.request("GET", "/api/orders/" + id + "/activities?itemId=" + third + "&type=ITEM_ADDED", null).body.at("/data/items/0");
            assertEquals("FROSTING_DONE", addLog.at("/details/before/currentStageCode").asText()); assertTrue(addLog.at("/details/after/currentStageCode").isNull());
            assertEquals("商品 C", addLog.at("/details/after/item/name").asText());
            var removed = staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 5));
            assertEquals(200, removed.status, removed.body.toString()); stream.changed(id, second, "ITEM_REMOVED", 6);
            var latest = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(removed.body.path("data"), latest);
            assertEquals(2, latest.path("items").size()); assertEquals(item(addedData, first), item(latest, first)); assertEquals(item(addedData, third), item(latest, third));
            assertEquals(28000, latest.path("totalAmountCents").asLong()); assertTrue(latest.path("currentStageCode").isNull());
            assertEquals("B 原有备注", peer.request("GET", "/api/orders/" + id + "/activities?itemId=" + second + "&type=NOTE", null).body.at("/data/items/0/content").asText());
            assertEquals("纸杯", peer.request("GET", "/api/orders/" + id + "/activities?itemId=" + second + "&type=ITEM_REMOVED", null).body.at("/data/items/0/details/before/name").asText());
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(6, "COMPLETE_FROSTING")).status);
            assertEquals(409, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 5, "changes", Map.of("phone", "13900000000"))).status);
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 6, "changes", changes)).status);
            stream.noChange(); var layer = production(staff, id, 6, "COMPLETE_LAYER"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 7);
            assertEquals("LAYER_DONE", layer.path("currentStageCode").asText());
            var complete = production(staff, id, 7, "COMPLETE_PRODUCTION"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 8);
            assertEquals("WAITING_DELIVERY", complete.path("status").asText());
            assertTrue(jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, second));
            assertEquals("IN_PROGRESS", jdbc.queryForObject("SELECT production_status FROM cake_order_item WHERE id=?::uuid", String.class, second));
            assertEquals(complete, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
        }
    }
    @Test void informationAndAdditionFailuresAndOuterRollbacksRestoreDatabaseAndSuppressSse() throws Exception {
        var staff = staff(); var request = new LinkedHashMap<String, Object>(create()); request.put("totalAmountCents", 25000);
        var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "START_PRODUCTION"); var before = production(staff, id, 1, "COMPLETE_LAYER");
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        try (var stream = staff.stream()) {
            for (boolean information : List.of(true, false)) {
                String type = information ? "ORDER_INFORMATION_CHANGED" : "ITEM_ADDED";
                doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals(type)));
                var failed = staff.request(information ? "PATCH" : "POST", "/api/orders/" + id + (information ? "/information" : "/items"),
                        Map.of("expectedVersion", 2, information ? "changes" : "item", information
                                ? Map.of("phone", "13900000000", "totalAmountCents", 28000) : Map.of("name", "C", "quantity", 1)));
                assertEquals(503, failed.status); reset(activities); stream.noChange();
                assertEquals(before, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                new TransactionTemplate(transactions).executeWithoutResult(status -> {
                    var actor = new OrderCommands.Operator(UUID.fromString(staff.accountId), "前台员工");
                    if (information) orderService.reviseInformation(UUID.fromString(id), new OrderCommands.Information(2, Map.of("phone", "13900000000", "totalAmountCents", 28000)), actor);
                    else orderService.addItem(UUID.fromString(id), new OrderCommands.AddItem(2, new OrderCommands.Item("C", null, 1, null, null, Map.of())), actor);
                    status.setRollbackOnly();
                });
                stream.noChange(); assertEquals(before, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals(2L, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
                assertEquals("LAYER_DONE", jdbc.queryForObject("SELECT current_stage_code FROM cake_order WHERE id=?::uuid", String.class, id));
                assertEquals(25000L, jdbc.queryForObject("SELECT total_amount_cents FROM cake_order WHERE id=?::uuid", Long.class, id));
                assertEquals(2L, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE order_id=?::uuid", Long.class, id));
                assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            }
        }
    }
    @Test void sameVersionInformationAndAdditionHaveOneCommitAndNotification() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        var prepared = new CountDownLatch(2);
        doAnswer(invocation -> {
            prepared.countDown(); if (!prepared.await(10, TimeUnit.SECONDS)) throw new AssertionError("both mutations must reach persistence");
            return invocation.callRealMethod();
        }).when(orders).reviseInformation(any(), eq(0L));
        doAnswer(invocation -> {
            prepared.countDown(); if (!prepared.await(10, TimeUnit.SECONDS)) throw new AssertionError("both mutations must reach persistence");
            return invocation.callRealMethod();
        }).when(orders).addItem(any(), eq(0L), any());
        try (var stream = staff.stream(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.request("PATCH", "/api/orders/" + id + "/information",
                    Map.of("expectedVersion", 0, "changes", Map.of("phone", "13900000000"))); });
            var b = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/items",
                    Map.of("expectedVersion", 0, "item", Map.of("name", "C", "quantity", 1))); });
            start.countDown(); var results = List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(r -> r.status == 409).count());
            var winner = results.stream().filter(r -> r.status == 200 || r.status == 201).findFirst().orElseThrow();
            var latest = staff.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(winner.body.path("data"), latest); assertEquals(1, latest.path("version").asLong());
            boolean addition = winner.status == 201;
            assertEquals(addition ? 3 : 2, latest.path("items").size());
            assertEquals(addition ? "13800000000" : "13900000000", latest.at("/customer/phone").asText());
            stream.changed(id, addition ? idForName(latest, "C") : null, addition ? "ITEM_ADDED" : "ORDER_INFORMATION_CHANGED", 1); stream.noChange();
            assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type IN ('ITEM_ADDED','ORDER_INFORMATION_CHANGED')", Long.class, id));
            assertEquals(addition ? 3L : 2L, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE order_id=?::uuid", Long.class, id));
        }
    }
    @Test void concurrentRemovalsWithSameLoadedVersionKeepOneActiveItemAndOneNotification() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = original.path("orderId").asText(), first = idForName(original, "蛋糕"), second = idForName(original, "纸杯");
        var prepared = new CountDownLatch(2);
        doAnswer(invocation -> {
            prepared.countDown(); if (!prepared.await(10, TimeUnit.SECONDS)) throw new AssertionError("both removals must reach persistence");
            return invocation.callRealMethod();
        }).when(orders).removeItem(any(), eq(0L), any());
        try (var stream = staff.stream(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> staff.request("POST", "/api/orders/" + id + "/items/" + first + "/remove", Map.of("expectedVersion", 0)));
            var b = executor.submit(() -> staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 0)));
            var results = List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertEquals(Set.of(200, 409), Set.of(results.get(0).status, results.get(1).status));
            var winner = results.stream().filter(r -> r.status == 200).findFirst().orElseThrow();
            var latest = staff.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(winner.body.path("data"), latest);
            assertEquals(1, latest.path("version").asLong()); assertEquals(1, latest.path("items").size());
            String retained = latest.at("/items/0/itemId").asText(), removed = retained.equals(first) ? second : first;
            assertEquals(item(original, retained), item(latest, retained)); stream.changed(id, removed, "ITEM_REMOVED", 1); stream.noChange();
            assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE order_id=?::uuid AND is_removed", Long.class, id));
            assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type='ITEM_REMOVED'", Long.class, id));
            assertEquals(1, staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + removed, null).body.at("/data/total").asLong());
        }
    }
    @Test void informationNoopRejectsVersionAdvancedByAdditionAfterLoading() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        var loaded = new CountDownLatch(1); var proceed = new CountDownLatch(1);
        doAnswer(invocation -> {
            loaded.countDown(); if (!proceed.await(10, TimeUnit.SECONDS)) throw new AssertionError("addition did not finish"); return invocation.callRealMethod();
        }).when(orders).verifyVersion(UUID.fromString(id), 0);
        try (var stream = staff.stream(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var noop = executor.submit(() -> staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("phone", "13800000000"))));
            try {
                assertTrue(loaded.await(10, TimeUnit.SECONDS));
                var added = staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 0, "item", Map.of("name", "C", "quantity", 1)));
                assertEquals(201, added.status); proceed.countDown(); var rejected = noop.get(10, TimeUnit.SECONDS);
                assertEquals(409, rejected.status); assertEquals("CONCURRENT_MODIFICATION", rejected.body.path("code").asText());
                stream.changed(id, idForName(added.body.path("data"), "C"), "ITEM_ADDED", 1); stream.noChange();
                assertEquals(added.body.path("data"), staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            } finally { proceed.countDown(); }
        }
    }
    @Test void fulfillmentTypeCorrectionsPersistAuditAndNotifyAcrossHandoffAndTerminalStates() throws Exception {
        var staff = staff(); var peer = new Client(); peer.login("0001", PASSWORD);
        var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "START_PRODUCTION"); production(staff, id, 1, "COMPLETE_LAYER");
        var ready = production(staff, id, 2, "COMPLETE_PRODUCTION");
        try (var stream = peer.stream()) {
            var pickup = new LinkedHashMap<String, Object>(); pickup.put("fulfillmentType", "PICKUP"); pickup.put("address", null);
            doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("ORDER_INFORMATION_CHANGED")));
            assertEquals(503, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 3, "changes", pickup)).status);
            reset(activities); stream.noChange(); assertEquals(ready, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            var corrected = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 3, "changes", pickup));
            assertEquals(200, corrected.status, corrected.body.toString()); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 4);
            var waitingPickup = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(corrected.body.path("data"), waitingPickup);
            assertEquals("WAITING_PICKUP", waitingPickup.path("status").asText()); assertTrue(waitingPickup.at("/fulfillment/address").isNull());
            assertEquals("LAYER_DONE", waitingPickup.path("currentStageCode").asText()); assertEquals(ready.path("items"), waitingPickup.path("items"));
            assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 4, "changes", Map.of("fulfillmentType", "DELIVERY"))).status);
            var delivery = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 4,
                    "changes", Map.of("fulfillmentType", "DELIVERY", "address", "更正地址")));
            assertEquals(200, delivery.status); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 5);
            var delivering = fulfillment(staff, id, 5, "START_DELIVERY"); stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", 6);
            var handoff = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 6, "changes", Map.of("fulfillmentType", "PICKUP")));
            assertEquals(200, handoff.status, handoff.body.toString()); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 7);
            assertEquals("WAITING_PICKUP", handoff.body.at("/data/status").asText()); assertEquals(delivering.path("items"), handoff.body.at("/data/items"));
            var log = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).body.at("/data/items/0");
            assertEquals("DELIVERING", log.at("/details/before/status").asText()); assertEquals("WAITING_PICKUP", log.at("/details/after/status").asText());
            assertEquals("DELIVERY", log.at("/details/before/fulfillmentType").asText()); assertEquals("PICKUP", log.at("/details/after/fulfillmentType").asText());
            assertEquals(staff.accountId, log.path("actorId").asText()); assertEquals("前台员工", log.path("actorNameSnapshot").asText());
            var completed = fulfillment(staff, id, 7, "CONFIRM_PICKUP"); stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", 8);
            var terminal = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 8,
                    "changes", Map.of("fulfillmentType", "DELIVERY", "phone", "13900000000", "totalAmountCents", 20000)));
            assertEquals(200, terminal.status); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 9);
            assertEquals("COMPLETED", terminal.body.at("/data/status").asText()); assertEquals(completed.path("items"), terminal.body.at("/data/items"));
            assertEquals(terminal.body.path("data"), peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals("DELIVERY", jdbc.queryForObject("SELECT fulfillment_type FROM cake_order WHERE id=?::uuid", String.class, id));
            var noop = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 9, "changes", Map.of("fulfillmentType", "DELIVERY")));
            assertEquals(200, noop.status); assertEquals(terminal.body.path("data"), noop.body.path("data")); stream.noChange();
        }
        var another = staff.request("POST", "/api/orders", create()).body.path("data"); String cancelledId = another.path("orderId").asText();
        production(staff, cancelledId, 0, "START_PRODUCTION"); production(staff, cancelledId, 1, "COMPLETE_PRODUCTION");
        fulfillment(staff, cancelledId, 2, "START_DELIVERY");
        var cancelled = staff.request("POST", "/api/orders/" + cancelledId + "/cancel", Map.of("expectedVersion", 3, "reason", "人工取消")).body.path("data");
        try (var stream = peer.stream()) {
            var corrected = staff.request("PATCH", "/api/orders/" + cancelledId + "/information", Map.of("expectedVersion", 4,
                    "changes", Map.of("fulfillmentType", "PICKUP", "phone", "13900000000")));
            assertEquals(200, corrected.status); stream.changed(cancelledId, null, "ORDER_INFORMATION_CHANGED", 5);
            assertEquals("CANCELLED", corrected.body.at("/data/status").asText()); assertEquals(cancelled.path("items"), corrected.body.at("/data/items"));
            assertEquals(corrected.body.path("data"), peer.request("GET", "/api/orders/" + cancelledId, null).body.path("data"));
        }
    }
    @Test void calendarSharesWeekAndMonthDataWithStableOrderBoundariesAndDateMoves() throws Exception {
        var staff = staff();
        createOn(staff, "2026-09-27", "18:00", "DELIVERY");
        var first = createOn(staff, "2026-09-28", "18:00", "DELIVERY");
        var late = createOn(staff, "2026-09-30", "18:00", "DELIVERY");
        var early = createOn(staff, "2026-09-30", "10:00", "DELIVERY");
        var tied = createOn(staff, "2026-09-30", "10:00", "PICKUP");
        var october = createOn(staff, "2026-10-01", "10:00", "DELIVERY");
        var last = createOn(staff, "2026-11-08", "10:00", "DELIVERY");
        createOn(staff, "2026-11-09", "10:00", "DELIVERY");
        var week = query(staff, "/api/orders/calendar?from=2026-09-28&to=2026-10-05");
        var month = query(staff, "/api/orders/calendar?from=2026-09-28&to=2026-11-09");
        assertEquals(List.of(first.path("orderId").asText(), early.path("orderId").asText(), tied.path("orderId").asText(),
                late.path("orderId").asText(), october.path("orderId").asText()), orderIds(week));
        assertEquals(6, month.size()); assertEquals(last.path("orderId"), month.get(5).path("orderId"));
        for (int i = 0; i < week.size(); i++) assertEquals(week.get(i), month.get(i));
        assertEquals(2, week.get(0).path("items").size());
        assertEquals(Set.of("orderId", "orderNo", "calendarDate", "status", "currentStageCode", "paymentStatus", "fulfillmentType", "plannedHandoffAt", "items"),
                json.convertValue(week.get(0), Map.class).keySet());
        assertEquals(Set.of("itemId", "name", "quantity"), json.convertValue(week.get(0).at("/items/0"), Map.class).keySet());
        assertTrue(query(staff, "/api/orders/calendar?from=2026-12-01&to=2026-12-02").isEmpty());

        String id = early.path("orderId").asText();
        var handoff = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0,
                "changes", Map.of("plannedHandoffAt", "2026-10-02T12:00:00+08:00")));
        assertEquals(200, handoff.status);
        assertTrue(orderIds(query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01")).contains(id));
        assertFalse(orderIds(query(staff, "/api/orders/calendar?from=2026-10-02&to=2026-10-03")).contains(id));
        var moved = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1,
                "changes", Map.of("requestedReceiveDate", "2026-10-02", "requestedReceiveAt", "2026-10-02T18:00:00+08:00")));
        assertEquals(200, moved.status);
        assertFalse(orderIds(query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01")).contains(id));
        assertEquals(List.of(id), orderIds(query(staff, "/api/orders/calendar?from=2026-10-02&to=2026-10-03")));
        assertFalse(orderIds(query(staff, "/api/orders/workbench?date=2026-09-30").path("pendingOrders")).contains(id));
        assertEquals(List.of(id), orderIds(query(staff, "/api/orders/workbench?date=2026-10-02").path("pendingOrders")));

        for (var path : List.of("calendar", "calendar?from=2026-09-28", "calendar?to=2026-11-09",
                "calendar?from=2026-09-28&to=2026-09-28", "calendar?from=2026-09-29&to=2026-09-28",
                "calendar?from=2026-09-28&to=2026-11-10", "calendar?from=2026-02-30&to=2026-03-02",
                "workbench", "workbench?date=invalid", "workbench?date=2026-02-30")) {
            var invalid = staff.request("GET", "/api/orders/" + path, null);
            assertEquals(400, invalid.status, path + ": " + invalid.body);
            assertEquals("VALIDATION_FAILED", invalid.body.path("code").asText());
        }
    }

    @Test void workbenchReturnsIndependentItemNotesAndQueriesHaveNoSideEffects() throws Exception {
        var staff = staff();
        var firstOrder = createOn(staff, "2026-09-30", "10:00", "DELIVERY");
        var otherOrder = createOn(staff, "2026-09-30", "11:00", "PICKUP");
        String id = firstOrder.path("orderId").asText(), otherId = otherOrder.path("orderId").asText();
        String a = idForName(firstOrder, "蛋糕"), b = idForName(firstOrder, "纸杯"), c = idForName(otherOrder, "蛋糕");
        var noteTime = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        for (int i = 1; i <= 4; i++) {
            doReturn(noteTime.plusSeconds(i == 4 ? -1 : 0)).when(clock).instant();
            for (var target : List.of(Map.entry(id, a), Map.entry(id, b), Map.entry(otherId, c))) {
                var note = staff.request("POST", "/api/orders/" + target.getKey() + "/notes",
                        Map.of("itemId", target.getValue(), "content", target.getValue() + ":" + i));
                assertEquals(201, note.status);
            }
        }
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "订单级备注")).status);
        var before = staff.request("GET", "/api/orders/" + id, null).body.path("data");
        long activityCount = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        try (var stream = staff.stream()) {
            clearInvocations(queryMapper, orders, activities);
            var workbench = query(staff, "/api/orders/workbench?date=2026-09-30");
            verify(queryMapper).metrics(any(), any(), any()); verify(queryMapper).pending(any());
            verify(queryMapper).items(any()); verify(queryMapper).recentNotes(any(), any());
            verifyNoMoreInteractions(queryMapper); verifyNoInteractions(orders, activities);
            assertEquals("2026-09-30", workbench.path("date").asText());
            var pending = workbench.path("pendingOrders"); assertEquals(2, pending.size());
            var order = pending.get(0);
            assertEquals("13800000000", order.at("/customer/phone").asText()); assertEquals("示例地址", order.path("address").asText());
            assertEquals("2026-09-30T02:00:00Z", order.path("plannedHandoffAt").asText());
            assertEquals("UNPAID", order.path("paymentStatus").asText());
            for (var entry : List.of(Map.entry(order, a), Map.entry(order, b), Map.entry(pending.get(1), c))) {
                var notes = item(entry.getKey(), entry.getValue()).path("recentNotes");
                assertEquals(List.of(entry.getValue() + ":3", entry.getValue() + ":2", entry.getValue() + ":1"), contents(notes));
                long previous = Long.MAX_VALUE;
                for (var note : notes) {
                    assertEquals(entry.getValue(), note.path("itemId").asText());
                    assertEquals(staff.accountId, note.path("actorId").asText());
                    assertEquals("前台员工", note.path("actorNameSnapshot").asText());
                    assertEquals(noteTime, Instant.parse(note.path("createdAt").asText()));
                    assertTrue(note.path("id").asLong() < previous); previous = note.path("id").asLong();
                }
            }
            var cake = item(order, a);
            assertEquals("CAKE", cake.path("productType").asText()); assertEquals(10000, cake.path("unitPriceCents").asLong());
            assertEquals(8000, cake.path("memberPriceCents").asLong()); assertEquals(item(firstOrder, a).path("attributes"), cake.path("attributes"));
            clearInvocations(queryMapper);
            query(staff, "/api/orders/calendar?from=2026-09-28&to=2026-11-09");
            verify(queryMapper).calendar(any(), any()); verify(queryMapper).calendarItems(any());
            verifyNoMoreInteractions(queryMapper); verifyNoInteractions(orders, activities);
            stream.noChange();
        }
        assertEquals(before, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        assertEquals(activityCount, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        assertEquals(200, staff.request("POST", "/api/orders/" + id + "/items/" + b + "/remove", Map.of("expectedVersion", 0)).status);
        var remaining = query(staff, "/api/orders/workbench?date=2026-09-30").at("/pendingOrders/0/items");
        assertEquals(1, remaining.size()); assertEquals(a, remaining.get(0).path("itemId").asText());
        assertEquals(1, query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01").at("/0/items").size());
        assertEquals(true, jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, b));
    }

    @Test void workbenchMetricsCountOrdersAcrossStatesAndShanghaiCreationBoundaries() throws Exception {
        var staff = staff();
        var empty = query(staff, "/api/orders/workbench?date=2026-09-30");
        assertEquals(0, empty.at("/metrics/totalOrders").asLong()); assertTrue(empty.path("pendingOrders").isEmpty());
        var waiting = createOn(staff, "2026-09-30", "09:00", "DELIVERY");
        var processing = createOn(staff, "2026-09-30", "10:00", "DELIVERY");
        var ready = createOn(staff, "2026-09-30", "11:00", "DELIVERY");
        var delivering = createOn(staff, "2026-09-30", "12:00", "DELIVERY");
        var completed = createOn(staff, "2026-09-30", "13:00", "DELIVERY");
        var cancelled = createOn(staff, "2026-09-30", "14:00", "DELIVERY");
        createOn(staff, "2026-09-30", "15:00", "PICKUP");
        var other = createOn(staff, "2026-10-01", "10:00", "DELIVERY");
        String processingId = processing.path("orderId").asText(), readyId = ready.path("orderId").asText();
        String deliveringId = delivering.path("orderId").asText(), completedId = completed.path("orderId").asText();
        production(staff, processingId, 0, "START_PRODUCTION"); production(staff, processingId, 1, "COMPLETE_LAYER");
        assertEquals(200, staff.request("PATCH", "/api/orders/" + processingId + "/payment-status",
                Map.of("expectedVersion", 2, "paymentStatus", "PAID")).status);
        for (var id : List.of(readyId, deliveringId, completedId)) {
            production(staff, id, 0, "START_PRODUCTION"); production(staff, id, 1, "COMPLETE_PRODUCTION");
        }
        fulfillment(staff, deliveringId, 2, "START_DELIVERY");
        fulfillment(staff, completedId, 2, "START_DELIVERY"); fulfillment(staff, completedId, 3, "COMPLETE_DELIVERY");
        assertEquals(200, staff.request("POST", "/api/orders/" + cancelled.path("orderId").asText() + "/cancel",
                Map.of("expectedVersion", 0, "reason", "客户取消")).status);
        jdbc.update("UPDATE cake_order SET created_at='2026-09-29T15:59:59.999999Z'::timestamptz");
        jdbc.update("UPDATE cake_order SET created_at='2026-09-29T16:00:00Z'::timestamptz WHERE id=?::uuid", processingId);
        jdbc.update("UPDATE cake_order SET created_at='2026-09-30T15:59:59.999999Z'::timestamptz WHERE id=?::uuid", other.path("orderId").asText());
        jdbc.update("UPDATE cake_order SET created_at='2026-09-30T16:00:00Z'::timestamptz WHERE id=?::uuid", deliveringId);
        var workbench = query(staff, "/api/orders/workbench?date=2026-09-30");
        assertEquals(8, workbench.at("/metrics/totalOrders").asLong());
        assertEquals(2, workbench.at("/metrics/createdOnDate").asLong());
        assertEquals(4, workbench.at("/metrics/deliveryDueOnDate").asLong());
        var pending = workbench.path("pendingOrders"); assertEquals(7, pending.size());
        assertEquals(waiting.path("orderId"), pending.get(0).path("orderId"));
        assertEquals("PROCESSING", pending.get(1).path("status").asText());
        assertEquals("PAID", pending.get(1).path("paymentStatus").asText());
        assertEquals("LAYER_DONE", pending.get(1).path("currentStageCode").asText());
        assertEquals("WAITING_DELIVERY", pending.get(2).path("status").asText());
        assertEquals("DELIVERING", pending.get(3).path("status").asText());
        for (var order : pending) for (var item : order.path("items")) assertTrue(item.path("recentNotes").isEmpty());
        var calendar = query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01"); assertEquals(7, calendar.size());
        assertEquals("COMPLETED", calendar.get(4).path("status").asText()); assertEquals("CANCELLED", calendar.get(5).path("status").asText());
        for (int i = 0; i < 4; i++) {
            assertEquals(pending.get(i).path("orderId"), calendar.get(i).path("orderId"));
            assertEquals(pending.get(i).path("status"), calendar.get(i).path("status"));
            assertEquals(pending.get(i).path("paymentStatus"), calendar.get(i).path("paymentStatus"));
            assertEquals(pending.get(i).path("currentStageCode"), calendar.get(i).path("currentStageCode"));
        }
        var noDueOrders = query(staff, "/api/orders/workbench?date=2026-12-01");
        assertEquals(8, noDueOrders.at("/metrics/totalOrders").asLong());
        assertEquals(0, noDueOrders.at("/metrics/createdOnDate").asLong());
        assertEquals(0, noDueOrders.at("/metrics/deliveryDueOnDate").asLong()); assertTrue(noDueOrders.path("pendingOrders").isEmpty());
    }

    private JsonNode createOn(Client staff, String date, String time, String type) throws Exception {
        var command = new LinkedHashMap<>(create());
        command.put("fulfillment", Map.of("type", type, "address", "示例地址", "requestedReceiveDate", date,
                "plannedHandoffAt", date + "T" + time + ":00+08:00"));
        var response = staff.request("POST", "/api/orders", command);
        assertEquals(201, response.status, response.body.toString()); return response.body.path("data");
    }
    private JsonNode query(Client staff, String path) throws Exception {
        var response = staff.request("GET", path, null);
        assertEquals(200, response.status, response.body.toString()); return response.body.path("data");
    }
    private static List<String> orderIds(JsonNode orders) {
        var result = new ArrayList<String>(); orders.forEach(order -> result.add(order.path("orderId").asText())); return result;
    }

    private JsonNode production(Client staff, String id, Number version, String action) throws Exception {
        var result = staff.request("POST", "/api/orders/" + id + "/production-actions", action(version, action));
        assertEquals(200, result.status, result.body.toString()); return result.body.path("data");
    }

    @Test void recognitionIsPartialAuthenticatedAndHasNoOrderSideEffects() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = original.path("orderId").asText();
        String text = "【蛋糕预定单】 收货时间：2026.9.30 尺寸：8寸 口味（默认原味夹芒果）：芒果，脆啵啵，奥利奥 电话：13800000012 地址：合成地址 价格（客服填）： 会员手机号：13800000012 【订购需知】：满58免运费，4寸-6寸配5人份，夹层可以换草莓";
        try (var stream = staff.stream()) {
            clearInvocations(orders, activities);
            assertEquals(401, new Client().request("POST", "/api/orders/recognition/parse", Map.of("text", text)).status);
            var result = staff.request("POST", "/api/orders/recognition/parse", Map.of("text", text));
            assertEquals(200, result.status, result.body.toString());
            assertEquals("2026-09-30", result.body.at("/data/fields/requestedReceiveDate/value").asText());
            assertTrue(result.body.at("/data/fields/plannedHandoffAt/value").isNull());
            assertEquals("芒果、脆啵啵、奥利奥", result.body.at("/data/items/0/fields/filling/value").asText());
            assertTrue(result.body.at("/data/items/0/fields/name/value").isNull());
            assertTrue(result.body.at("/data/items/0/fields/quantity/value").isNull());
            assertEquals(400, staff.request("POST", "/api/orders/recognition/parse", Map.of("text", "字".repeat(12001))).status);
            assertEquals(400, staff.request("POST", "/api/orders/recognition/parse", Map.of("text", " ")).status);
            var assisted = staff.request("POST", "/api/orders/recognition/assist", Map.of("text", "【蛋糕预定单】\n奶油用动物的", "allowExternalProcessing", true));
            assertEquals(200, assisted.status); assertEquals("DISABLED", assisted.body.at("/data/status").asText());
            verifyNoInteractions(orders, activities);
            assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_image", Integer.class));
            stream.noChange();
        }
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
                        "attributes", Map.of("size", "8", "flavors", List.of("芒果"), "greeting", "生日快乐")),
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
    record Message(String name, JsonNode data) { }
    final class Stream implements AutoCloseable {
        private final InputStream body;
        private final ExecutorService reader = Executors.newVirtualThreadPerTaskExecutor();
        private final BlockingQueue<Message> messages = new LinkedBlockingQueue<>();
        private final Future<?> reading;
        Stream(HttpResponse<InputStream> response) throws Exception {
            assertEquals(200, response.statusCode());
            assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("text/event-stream"));
            body = response.body();
            reading = reader.submit(() -> {
                try (var lines = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8))) {
                    String name = null; var data = new StringBuilder(); String line;
                    while ((line = lines.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (name != null) messages.add(new Message(name, json.readTree(data.toString())));
                            name = null; data.setLength(0);
                        } else if (line.startsWith("event:")) name = line.substring(6).strip();
                        else if (line.startsWith("data:")) data.append(line.substring(5).strip()).append('\n');
                    }
                    return null;
                }
            });
            var ready = messages.poll(5, TimeUnit.SECONDS); assertNotNull(ready, "missing ready"); assertEquals("ready", ready.name);
        }
        void changed(String orderId, String itemId, String type, long version) throws Exception {
            var message = messages.poll(5, TimeUnit.SECONDS); assertNotNull(message, "missing order.changed"); assertEquals("order.changed", message.name);
            var data = message.data;
            assertEquals(Set.of("orderId", "itemId", "changeType", "version", "orderNo"), json.convertValue(data, Map.class).keySet());
            assertFalse(data.path("orderNo").asText().isBlank());
            assertEquals(orderId, data.path("orderId").asText());
            if (itemId == null) assertTrue(data.path("itemId").isNull()); else assertEquals(itemId, data.path("itemId").asText());
            assertEquals(type, data.path("changeType").asText()); assertEquals(version, data.path("version").asLong());
        }
        void noChange() throws Exception { assertNull(messages.poll(250, TimeUnit.MILLISECONDS)); assertFalse(reading.isDone(), "stream unexpectedly ended"); }
        @Override public void close() throws IOException { body.close(); reading.cancel(true); reader.shutdownNow(); }
    }
    final class Client {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
        private String token;
        private String accountId;
        Stream stream() throws Exception {
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/orders/stream"))
                    .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + token).header("Accept", "text/event-stream").GET().build();
            return new Stream(client.send(request, HttpResponse.BodyHandlers.ofInputStream()));
        }
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

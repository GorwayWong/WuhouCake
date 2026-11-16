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
import org.xaspire.WuhouCake.identity.api.facade.EmployeeAccess;
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
    @Autowired org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderManagementMapper managementMapper;
    @MockitoSpyBean OrderActivities activities;
    @MockitoSpyBean Orders orders;
    @MockitoSpyBean Clock clock;
    @MockitoSpyBean OrderQueryMapper queryMapper;
    @MockitoSpyBean org.xaspire.WuhouCake.identity.application.service.EmployeeAccessPolicy employeeAccess;
    @BeforeEach void clean() {
        reset(activities, orders, clock, queryMapper, employeeAccess);
        jdbc.execute("TRUNCATE cake_order_activity, cake_order_item, cake_order, audit_operation, identity_account_role, identity_account CASCADE");
        clearSessions();
    }
    @AfterAll void removeTestData() {
        reset(activities, orders, clock, queryMapper, employeeAccess); clearSessions();
        jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE");
    }
    private void clearSessions() {
        var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys);
    }

    @Test void sixNodeMigrationPreservesOldOrdersAndActivity() throws Exception {
        String schema = "workflow_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = java.util.Objects.requireNonNull(jdbc.getDataSource()).getConnection()) {
            var source = new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection, true);
            var flyway = org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration");
            flyway.target("24").load().migrate();
            connection.setSchema(schema);
            var legacy = new JdbcTemplate(source);
            String[][] cases = {
                    {"WAITING_PRODUCTION", null, "DELIVERY", "CAKE_BASE"},
                    {"PROCESSING", null, "PICKUP", "CAKE_BASE"},
                    {"PROCESSING", "LAYER_DONE", "DELIVERY", "FROSTING"},
                    {"PROCESSING", "FROSTING_DONE", "DELIVERY", "DECORATING"},
                    {"PROCESSING", "OTHER_DONE", "PICKUP", "DECORATING"},
                    {"WAITING_PICKUP", "OTHER_DONE", "PICKUP", "WAITING_DELIVERY"},
                    {"DELIVERING", "OTHER_DONE", "DELIVERY", "WAITING_DELIVERY"},
                    {"WAITING_DELIVERY", "OTHER_DONE", "DELIVERY", "WAITING_DELIVERY"},
                    {"COMPLETED", null, "PICKUP", "COMPLETED"},
                    {"CANCELLED", "LAYER_DONE", "DELIVERY", "CANCELLED"}
            };
            var actor = UUID.randomUUID();
            for (int index = 0; index < cases.length; index++) {
                var state = cases[index];
                var order = UUID.randomUUID();
                legacy.update("""
                        INSERT INTO cake_order(id,order_no,status,current_stage_code,customer_phone,fulfillment_type,
                            delivery_address,requested_receive_date,created_by,created_at,confirmed_at,updated_at,version,payment_status,paid_at)
                        VALUES (?,?,?,?,'13800000000',?,'测试地址',DATE '2026-10-17',?,now(),now(),now(),7,'PAID','2026-10-17T08:00:00Z')
                        """, order, "OLD-" + index, state[0], state[1], state[2], actor);
                legacy.update("""
                        INSERT INTO cake_order_item(id,order_id,name,product_type,quantity,production_status,created_at,updated_at)
                        VALUES (?,?,'蛋糕','CAKE',1,'COMPLETED',now(),now())
                        """, UUID.randomUUID(), order);
                legacy.update("""
                        INSERT INTO cake_order_activity(order_id,type,content,details,actor_id,actor_name_snapshot,created_at)
                        VALUES (?,'ORDER_PRODUCTION_CHANGED','历史活动',jsonb_build_object('after',jsonb_build_object('status',?::text)),?,'测试员工',now())
                        """, order, state[0], actor);
            }
            flyway.target("25").load().migrate();
            connection.setSchema(schema);
            var rows = legacy.queryForList("""
                    SELECT o.status,o.current_stage_code,o.fulfillment_type,o.version,o.payment_status,o.paid_at,
                           i.production_status,a.details#>>'{after,status}' AS historic_status
                    FROM cake_order o JOIN cake_order_item i ON i.order_id=o.id JOIN cake_order_activity a ON a.order_id=o.id
                    ORDER BY o.order_no
                    """);
            assertEquals(cases.length, rows.size());
            for (int index = 0; index < cases.length; index++) {
                var row = rows.get(index);
                assertEquals(cases[index][3], row.get("status"));
                assertNull(row.get("current_stage_code"));
                assertEquals(cases[index][2], row.get("fulfillment_type"));
                assertEquals(7L, row.get("version"));
                assertEquals("PAID", row.get("payment_status"));
                assertEquals(Instant.parse("2026-10-17T08:00:00Z"), ((java.sql.Timestamp) row.get("paid_at")).toInstant());
                assertEquals("COMPLETED", row.get("production_status"));
                assertEquals(cases[index][0], row.get("historic_status"));
            }
        } finally {
            jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
    @Test void productionQueryCountsByShanghaiFinishDayAndReturnsOnlyMatchingOrders() throws Exception {
        var staff = staff();
        String[][] fixtures = {
                {"CAKE_BASE", "2026-10-31T15:59:59Z"},
                {"LAYER", "2026-10-31T16:00:00Z"},
                {"FROSTING", "2026-10-31T16:00:00Z"},
                {"DECORATING", null},
                {"WAITING_DELIVERY", "2026-10-31T16:00:00Z"},
                {"COMPLETED", null},
                {"CANCELLED", "2026-10-31T16:00:00Z"},
                {"CAKE_BASE", "2026-11-02T16:00:00Z"}
        };
        var ids = new ArrayList<String>();
        for (var fixture : fixtures) {
            var order = createCakeOn(staff, "2026-12-01", "10:00", "PICKUP");
            String id = order.path("orderId").asText();
            ids.add(id);
            jdbc.update("UPDATE cake_order SET status=?, planned_finish_at=?::timestamptz WHERE id=?::uuid", fixture[0], fixture[1], id);
        }
        jdbc.update("""
                UPDATE cake_order SET deleted_at=now(), deleted_by=created_by, deleted_by_name='测试', deletion_reason='测试'
                WHERE id=?::uuid
                """, ids.getLast());
        String summary = "/api/orders/workbench/production-summary?from=2026-10-31&to=2026-11-03";
        String orders = "/api/orders/workbench/production-orders?";
        assertEquals(401, new Client().request("GET", summary, null).status);
        var data = query(staff, summary);
        assertEquals(3, data.path("total").asLong());
        assertEquals(1, data.path("unscheduled").asLong());
        assertEquals(1, data.at("/days/0/orderCount").asLong());
        assertEquals("2026-11-01", data.at("/days/1/date").asText());
        assertEquals(2, data.at("/days/1/orderCount").asLong());
        assertEquals(0, data.at("/days/2/orderCount").asLong());
        var day = query(staff, orders + "date=2026-11-01&page=9");
        assertEquals(2, day.path("total").asLong());
        assertEquals(1, day.path("page").asInt());
        assertEquals(List.of(ids.get(1), ids.get(2)), orderIds(day.path("orders")));
        assertEquals("2026-12-01", day.at("/orders/0/pickupDate").asText());
        assertFalse(day.at("/orders/0/itemName").asText().isBlank());
        assertEquals(Set.of("orderId", "orderNo", "itemName", "status", "plannedFinishAt", "pickupAt", "pickupDate"),
                json.convertValue(day.at("/orders/0"), Map.class).keySet());
        var unscheduled = query(staff, orders + "unscheduled=true&stage=DECORATING");
        assertEquals(List.of(ids.get(3)), orderIds(unscheduled.path("orders")));
        assertEquals(0, query(staff, summary + "&stage=LAYER").path("unscheduled").asLong());
        assertEquals(1, query(staff, summary + "&stage=LAYER").path("total").asLong());
        for (var suffix : List.of("unscheduled=true&date=2026-11-01", "stage=LAYER", "date=2026-11-01&stage=CANCELLED", "date=2026-11-01&page=0"))
            assertEquals(400, staff.request("GET", orders + suffix, null).status);

        var moved = staff.request("PATCH", "/api/orders/" + ids.get(1) + "/information", Map.of("expectedVersion", 0,
                "changes", Map.of("plannedFinishAt", "2026-11-02T09:00:00+08:00")));
        assertEquals(200, moved.status, moved.body.toString());
        assertEquals(1, query(staff, summary).at("/days/2/orderCount").asLong());
        assertEquals(200, staff.request("POST", "/api/orders/" + ids.get(2) + "/cancel",
                Map.of("expectedVersion", 0, "reason", "测试取消")).status);
        assertEquals(0, query(staff, orders + "date=2026-11-01").path("total").asLong());
        jdbc.update("UPDATE cake_order_item SET production_status='COMPLETED' WHERE order_id=?::uuid", ids.get(3));
        production(staff, ids.get(3), 0, "COMPLETE_DECORATION");
        assertEquals(0, query(staff, summary).path("unscheduled").asLong());
        assertEquals(0, query(staff, orders + "unscheduled=true").path("total").asLong());
    }

    @Test void rejectsLateFinishOnCreateAndTimeEditButKeepsLegacyOrdersUsable() throws Exception {
        var staff = staff();
        var input = new LinkedHashMap<String, Object>(cakeOrder());
        input.put("fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", "2026-11-13",
                "plannedHandoffAt", "2026-11-13T00:30:00+08:00", "plannedFinishAt", "2026-11-12T23:31:00+08:00"));
        var rejected = staff.request("POST", "/api/orders", input);
        assertEquals(400, rejected.status);
        assertEquals("ORDER_FINISH_TOO_LATE", rejected.body.path("code").asText());
        input.put("fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", "2026-11-13",
                "plannedHandoffAt", "2026-11-13T00:30:00+08:00", "plannedFinishAt", "2026-11-12T23:30:00+08:00"));
        var created = staff.request("POST", "/api/orders", input);
        assertEquals(201, created.status, created.body.toString());
        String id = created.body.at("/data/orderId").asText();
        jdbc.update("UPDATE cake_order SET planned_finish_at='2026-11-12T23:31:00+08:00' WHERE id=?::uuid", id);
        String information = "/api/orders/" + id + "/information";
        assertEquals(200, staff.request("PATCH", information,
                Map.of("expectedVersion", 0, "changes", Map.of("phone", "13800000001"))).status);
        var invalidTime = staff.request("PATCH", information,
                Map.of("expectedVersion", 1, "changes", Map.of("plannedFinishAt", "2026-11-12T23:32:00+08:00")));
        assertEquals(400, invalidTime.status);
        assertEquals("ORDER_FINISH_TOO_LATE", invalidTime.body.path("code").asText());
    }

    @Test void productionRemindersFollowFinishTimeAcrossPickupDays() throws Exception {
        var staff = staff();
        var now = Instant.now();
        var storeDate = now.atZone(ZoneId.of("Asia/Shanghai")).toLocalDate();
        var nextPickup = storeDate.plusDays(1).toString();
        String overdue = createCakeOn(staff, nextPickup, "09:00", "PICKUP").path("orderId").asText();
        String today = createCakeOn(staff, nextPickup, "09:00", "PICKUP").path("orderId").asText();
        String ready = createCakeOn(staff, nextPickup, "09:00", "PICKUP").path("orderId").asText();
        String unscheduled = createCakeOn(staff, nextPickup, "09:00", "PICKUP").path("orderId").asText();
        jdbc.update("UPDATE cake_order SET planned_finish_at=?::timestamptz WHERE id=?::uuid", now.minusSeconds(90).toString(), overdue);
        jdbc.update("UPDATE cake_order SET planned_finish_at=?::timestamptz WHERE id=?::uuid",
                storeDate.plusDays(1).atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant().minusMillis(1).toString(), today);
        jdbc.update("UPDATE cake_order SET planned_finish_at=?::timestamptz, status='WAITING_DELIVERY' WHERE id=?::uuid",
                now.minusSeconds(90).toString(), ready);
        jdbc.update("UPDATE cake_order SET planned_finish_at=NULL WHERE id=?::uuid", unscheduled);
        doReturn(now).when(clock).instant();
        String base = "/api/orders/workbench/production-reminder";
        var summary = query(staff, base + "s");
        assertEquals(1, summary.path("today").asLong());
        assertEquals(1, summary.path("overdue").asLong());
        assertEquals(List.of(overdue), orderIds(query(staff, base + "-orders?group=overdue").path("orders")));
        assertEquals(List.of(today), orderIds(query(staff, base + "-orders?group=today").path("orders")));
        jdbc.update("UPDATE cake_order SET planned_finish_at=?::timestamptz WHERE id=?::uuid", now.plusSeconds(30).toString(), today);
        doReturn(now.plusSeconds(31)).when(clock).instant();
        assertEquals(List.of(overdue, today), orderIds(query(staff, base + "-orders?group=overdue").path("orders")));
    }

    @Test void orderingMethodPersistsClearsAndUsesOptimisticConcurrency() throws Exception {
        var staff = staff(); var input = new LinkedHashMap<>(create()); input.put("orderingMethod", "  微信  ");
        var response = staff.request("POST", "/api/orders", input);
        assertEquals(201, response.status, response.body.toString());
        var created = response.body.path("data"); String id = created.path("orderId").asText();
        assertEquals("微信", created.path("orderingMethod").asText());
        assertEquals("微信", jdbc.queryForObject("SELECT ordering_method FROM cake_order WHERE id=?::uuid", String.class, id));
        assertEquals("微信", staff.request("GET", "/api/orders/" + id, null).body.at("/data/orderingMethod").asText());
        var changed = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("orderingMethod", "电话")));
        assertEquals(200, changed.status, changed.body.toString());
        assertEquals("电话", changed.body.at("/data/orderingMethod").asText());
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("orderingMethod", "到店"))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", Map.of("orderingMethod", "长".repeat(81)))).status);
        assertEquals("电话", jdbc.queryForObject("SELECT ordering_method FROM cake_order WHERE id=?::uuid", String.class, id));
        var changes = new LinkedHashMap<String, Object>(); changes.put("orderingMethod", null);
        var cleared = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", changes));
        assertEquals(200, cleared.status, cleared.body.toString()); assertTrue(cleared.body.at("/data/orderingMethod").isNull());
        assertNull(jdbc.queryForObject("SELECT ordering_method FROM cake_order WHERE id=?::uuid", String.class, id));
        assertEquals(2L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type='ORDER_INFORMATION_CHANGED' AND jsonb_exists(details->'after', 'orderingMethod')", Long.class, id));
        input.put("orderingMethod", "长".repeat(81)); assertEquals(400, staff.request("POST", "/api/orders", input).status);
        var legacy = staff.request("POST", "/api/orders", create()); assertEquals(201, legacy.status); assertTrue(legacy.body.at("/data/orderingMethod").isNull());
    }

    @Test void cakeDefaultsPersistAndLegacyReadsDoNotRewriteTheDatabase() throws Exception {
        var staff = staff(); var created = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = created.path("orderId").asText(), cakeId = idForName(created, "蛋糕");
        assertEquals("原味奶油", item(created, cakeId).at("/attributes/flavor").asText());
        assertEquals("原味奶油", jdbc.queryForObject("SELECT attributes->>'flavor' FROM cake_order_item WHERE id=?::uuid", String.class, cakeId));
        jdbc.update("UPDATE cake_order_item SET attributes=attributes - 'flavor' - 'base' - 'filling' WHERE id=?::uuid", cakeId);
        var old = item(staff.request("GET", "/api/orders/" + id, null).body.path("data"), cakeId);
        assertEquals("原味奶油", old.at("/attributes/flavor").asText());
        assertEquals("芒果", old.at("/attributes/filling").asText()); assertEquals("原味", old.at("/attributes/base").asText());
        assertNull(jdbc.queryForObject("SELECT attributes->>'flavor' FROM cake_order_item WHERE id=?::uuid", String.class, cakeId));
        var filter = new org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.Filter(null, null, null, null, null, null, null, false, false, null, null, true);
        var exportedCake = managementMapper.products(filter, 100).stream().filter(product -> "CAKE".equals(product.productType())).findFirst().orElseThrow();
        assertEquals("原味奶油", exportedCake.flavor());
        var saved = staff.request("PATCH", "/api/orders/" + id, patch(cakeId, 0, Map.of("quantity", 2)));
        assertEquals(200, saved.status, saved.body.toString());
        assertEquals("原味奶油", jdbc.queryForObject("SELECT attributes->>'flavor' FROM cake_order_item WHERE id=?::uuid", String.class, cakeId));
        var custom = Map.of("base", "巧克力", "filling", "草莓", "flavor", "巧克力奶油");
        assertEquals(200, staff.request("PATCH", "/api/orders/" + id, patch(cakeId, 1, Map.of("attributes", custom))).status);
        var cleared = new HashMap<String, Object>(); cleared.put("base", null); cleared.put("filling", ""); cleared.put("flavor", " \t");
        var result = staff.request("PATCH", "/api/orders/" + id, patch(cakeId, 2, Map.of("attributes", cleared)));
        assertEquals(200, result.status, result.body.toString());
        assertEquals("原味奶油", jdbc.queryForObject("SELECT attributes->>'flavor' FROM cake_order_item WHERE id=?::uuid", String.class, cakeId));
    }

    @Test void dateOnlyReschedulingClearsPickupMirrorsAndPreservesHistory() throws Exception {
        var staff = staff();
        var order = staff.request("POST", "/api/orders", create()).body.path("data");
        String id = order.path("orderId").asText();
        var full = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("requestedReceiveAt", "2026-10-25T18:30:00+08:00"))).body.path("data");
        assertEquals("2026-10-25T10:30:00Z", full.at("/fulfillment/requestedReceiveAt").asText());
        var changes = new LinkedHashMap<String, Object>(); changes.put("requestedReceiveDate", "2026-10-26"); changes.put("requestedReceiveAt", null);
        var response = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", changes));
        assertEquals(200, response.status, response.body.toString());
        var reloaded = staff.request("GET", "/api/orders/" + id, null).body.path("data");
        assertEquals("2026-10-26", reloaded.at("/fulfillment/requestedReceiveDate").asText());
        assertTrue(reloaded.at("/fulfillment/requestedReceiveAt").isNull());
        assertTrue(reloaded.at("/fulfillment/plannedHandoffAt").isNull());
        assertNull(jdbc.queryForObject("SELECT requested_receive_at FROM cake_order WHERE id=?::uuid", java.sql.Timestamp.class, id));
        var log = staff.request("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).body.at("/data/items/0");
        assertEquals("2026-10-25T10:30:00Z", log.at("/details/before/requestedReceiveAt").asText());
        assertTrue(log.at("/details/after/requestedReceiveAt").isNull());
    }

    @Test void legacyPickupDatesDriveCalendarWorkbenchAndExportsWithoutRewritingStoredTimes() throws Exception {
        var staff = staff(); var created = createOn(staff, "2026-11-05", "18:00", "DELIVERY");
        String id = created.path("orderId").asText();
        jdbc.update("UPDATE cake_order SET planned_handoff_at='2026-11-03T16:30:27.123456Z',planned_finish_at='2026-11-03T15:30:00Z' WHERE id=?::uuid", id);
        var raw = jdbc.queryForMap("SELECT requested_receive_date,requested_receive_at,planned_handoff_at,planned_finish_at FROM cake_order WHERE id=?::uuid", id);
        assertEquals(List.of(id), orderIds(query(staff, "/api/orders/calendar?from=2026-11-04&to=2026-11-05")));
        assertTrue(query(staff, "/api/orders/calendar?from=2026-11-05&to=2026-11-06").isEmpty());
        var workbench = query(staff, "/api/orders/workbench?date=2026-11-04");
        assertEquals(id, workbench.at("/pendingOrders/0/orderId").asText());
        assertEquals("2026-11-04", workbench.at("/pendingOrders/0/calendarDate").asText());
        assertEquals(1, query(staff, "/api/orders/workbench/payment-summary?date=2026-11-04").path("totalOrderCount").asInt());
        assertEquals(List.of(id), queryMapper.exportIds(LocalDate.of(2026, 11, 4), LocalDate.of(2026, 11, 5), null, null, null, 10));
        var detail = query(staff, "/api/orders/" + id);
        assertEquals("2026-11-05", detail.at("/fulfillment/requestedReceiveDate").asText());
        assertEquals(0, detail.path("version").asLong());
        assertEquals(raw, jdbc.queryForMap("SELECT requested_receive_date,requested_receive_at,planned_handoff_at,planned_finish_at FROM cake_order WHERE id=?::uuid", id));
        var unrelated = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("phone", "13900000000")));
        assertEquals(200, unrelated.status, unrelated.body.toString());
        assertEquals(raw, jdbc.queryForMap("SELECT requested_receive_date,requested_receive_at,planned_handoff_at,planned_finish_at FROM cake_order WHERE id=?::uuid", id));
        jdbc.update("UPDATE cake_order SET planned_handoff_at=NULL WHERE id=?::uuid", id);
        var fallback = query(staff, "/api/orders/calendar?from=2026-11-05&to=2026-11-06");
        assertEquals("2026-11-05T10:00:00Z", fallback.get(0).path("plannedHandoffAt").asText());
        jdbc.update("UPDATE cake_order SET requested_receive_at=NULL WHERE id=?::uuid", id);
        var dateOnly = query(staff, "/api/orders/calendar?from=2026-11-05&to=2026-11-06");
        assertEquals(id, dateOnly.get(0).path("orderId").asText()); assertTrue(dateOnly.get(0).path("plannedHandoffAt").isNull());
    }

    @Test void multiItemWorkflowPersistsChangesHistoryAndIndependentRecentNotes() throws Exception {
        var staff = staff();
        var start = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        doReturn(start).when(clock).instant();
        var created = staff.request("POST", "/api/orders", create()); assertEquals(201, created.status, created.body.toString());
        var original = created.body.path("data"); String orderId = original.path("orderId").asText();
        String first = idForName(original, "蛋糕"), second = idForName(original, "纸杯");
        assertNotEquals(first, second); assertEquals("CAKE_BASE", original.path("status").asText());
        assertEquals("UNPAID", original.path("paymentStatus").asText()); assertEquals(0, original.path("version").asLong());
        assertEquals(staff.accountId, original.path("createdBy").asText());
        assertEquals(start, Instant.parse(original.path("updatedAt").asText()));
        assertEquals(start, Instant.parse(original.path("confirmedAt").asText()));
        var before = staff.request("GET", "/api/orders/" + orderId, null).body.path("data");
        assertEquals(item(original, second), item(before, second));
        doReturn(start.plusSeconds(1)).when(clock).instant();
        var changes = new LinkedHashMap<String, Object>();
        changes.put("name", "生日蛋糕"); changes.put("quantity", 2); changes.put("attributes", Map.of("size", "10", "flavors", List.of("草莓")));
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
        assertFalse(log.at("/details/before").hasNonNull("memberPriceCents")); assertFalse(log.at("/details/after").hasNonNull("memberPriceCents"));
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
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/production-actions", action(0, "COMPLETE_BASE")).status);
        assertEquals(401, anonymous.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("phone", "13900000000"))).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 0, "item", Map.of("name", "C", "quantity", 1))).status);
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/items/" + itemId + "/remove", Map.of("expectedVersion", 0)).status);
        assertEquals(404, staff.request("GET", "/api/orders/" + UUID.randomUUID(), null).status);
        assertEquals(404, staff.request("PATCH", "/api/orders/" + UUID.randomUUID() + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        assertEquals(404, staff.request("POST", "/api/orders/" + UUID.randomUUID() + "/production-actions", action(0, "COMPLETE_BASE")).status);
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
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0.5, "COMPLETE_BASE")).status);
        assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", 0, "action", "COMPLETE_BASE", "status", "WAITING_DELIVERY")).status);
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
        var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data");
        String id = original.path("orderId").asText(), first = idForName(original, "蛋糕"), second = idForName(original, "纸杯造型蛋糕");
        doReturn(start.plusSeconds(1)).when(clock).instant();
        var paid = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID"));
        assertEquals(200, paid.status, paid.body.toString()); assertEquals(1, paid.body.at("/data/version").asLong());
        assertEquals(original.path("items"), paid.body.at("/data/items"));
        assertEquals(start.plusSeconds(1), Instant.parse(paid.body.at("/data/updatedAt").asText()));
        doReturn(start.plusSeconds(2)).when(clock).instant();
        var noop = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "PAID"));
        assertEquals(200, noop.status); assertEquals(paid.body.path("data"), noop.body.path("data"));
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        var started = production(staff, id, 1, "COMPLETE_BASE");
        assertEquals("LAYER", started.path("status").asText()); assertEquals(2, started.path("version").asLong());
        for (var item : started.path("items")) {
            assertEquals("IN_PROGRESS", item.path("productionStatus").asText());
            assertEquals(start.plusSeconds(2), Instant.parse(item.path("updatedAt").asText()));
        }
        doReturn(start.plusSeconds(3)).when(clock).instant();
        var layer = production(staff, id, 2, "COMPLETE_LAYER");
        assertEquals("FROSTING", layer.path("status").asText()); assertEquals(started.path("items"), layer.path("items"));
        assertEquals(start.plusSeconds(3), Instant.parse(layer.path("updatedAt").asText()));
        doReturn(start.plusSeconds(4)).when(clock).instant();
        var frosted = production(staff, id, 3, "COMPLETE_FROSTING");
        assertEquals("DECORATING", frosted.path("status").asText()); assertEquals(started.path("items"), frosted.path("items"));
        doReturn(start.plusSeconds(5)).when(clock).instant();
        var completed = finishProduction(staff, id, 4);
        assertEquals("WAITING_DELIVERY", completed.path("status").asText()); assertEquals(7, completed.path("version").asLong());
        for (var item : completed.path("items")) {
            assertEquals("COMPLETED", item.path("productionStatus").asText()); assertTrue(item.path("currentStageCode").isNull());
            assertEquals(start.plusSeconds(5), Instant.parse(item.path("updatedAt").asText()));
        }
        assertEquals(completed, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        assertNull(jdbc.queryForObject("SELECT current_stage_code FROM cake_order WHERE id=?::uuid", String.class, id));
        doReturn(start.plusSeconds(7)).when(clock).instant();
        var revised = staff.request("PATCH", "/api/orders/" + id, patch(first, 7, Map.of("quantity", 2)));
        assertEquals(200, revised.status, revised.body.toString());
        assertEquals("DECORATING", revised.body.at("/data/status").asText());
        assertEquals("IN_PROGRESS", item(revised.body.path("data"), first).path("productionStatus").asText());
        assertEquals(item(completed, second), item(revised.body.path("data"), second));
        doReturn(start.plusSeconds(8)).when(clock).instant();
        var confirmed = finishProduction(staff, id, 8);
        assertEquals("WAITING_DELIVERY", confirmed.path("status").asText()); assertEquals(10, confirmed.path("version").asLong());
    }
    @Test void requiredStagesInvalidActionsAndPaymentCorrectionsPreserveSavedData() throws Exception {
        var staff = staff();
        for (var type : List.of("DELIVERY", "PICKUP")) {
            var request = new LinkedHashMap<String, Object>(cakeOrder());
            request.put("fulfillment", Map.of("type", type, "address", "示例地址", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"));
            var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
            for (var action : List.of("COMPLETE_LAYER", "COMPLETE_FROSTING", "COMPLETE_DECORATION", "REOPEN_PRODUCTION"))
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, action)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, "CANCEL")).status);
            assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "REFUNDED")).status);
            assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            var started = production(staff, id, 0, "COMPLETE_BASE");
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(1, "COMPLETE_BASE")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(1, "COMPLETE_FROSTING")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, "COMPLETE_DECORATION")).status);
            assertEquals(started, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            var completed = finishProduction(staff, id, 1);
            assertEquals("WAITING_DELIVERY", completed.path("status").asText());
            assertTrue(completed.path("currentStageCode").isNull());
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(6, "COMPLETE_DECORATION")).status);
            assertEquals(completed, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 6, "paymentStatus", "PAID")).status);
            var corrected = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 7, "paymentStatus", "UNPAID"));
            assertEquals(200, corrected.status); assertEquals(8, corrected.body.at("/data/version").asLong());
            assertEquals(completed.path("items"), corrected.body.at("/data/items"));
        }
    }
    @Test void concurrentPaymentAndProductionWithSameVersionHaveOneWinner() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", create()).body.path("data"); String id = original.path("orderId").asText();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")); });
            var b = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/production-actions", action(0, "COMPLETE_BASE")); });
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
        var staff = staff(); var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data"); String id = original.path("orderId").asText();
        try (var stream = staff.stream()) {
            doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("PAYMENT_STATUS_CHANGED")));
            assertEquals(503, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
            stream.noChange();
            reset(activities); assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            for (var action : List.of("COMPLETE_BASE", "COMPLETE_LAYER", "COMPLETE_FROSTING", "COMPLETE_DECORATION", "REOPEN_PRODUCTION")) {
                if (action.equals("COMPLETE_DECORATION")) {
                    var current = staff.request("GET", "/api/orders/" + id, null).body.path("data");
                    for (var item : current.path("items")) {
                        String itemId = item.path("itemId").asText();
                        var checked = staff.request("PATCH", "/api/orders/" + id + "/items/" + itemId + "/production-status", Map.of("expectedVersion", current.path("version").asLong(), "completed", true));
                        assertEquals(200, checked.status, checked.body.toString()); current = checked.body.path("data");
                        stream.changed(id, itemId, "ORDER_PRODUCTION_CHANGED", current.path("version").asLong());
                    }
                }
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
            production(staff, id, 2, "COMPLETE_BASE");
            for (var stream : List.of(a, b)) stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 3);
            production(staff, id, 3, "COMPLETE_LAYER");
            for (var stream : List.of(a, b)) stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 4);
            var latest = peer.request("GET", "/api/orders/" + id, null).body.path("data");
            assertEquals("FROSTING", latest.path("status").asText()); assertEquals(4, latest.path("version").asLong());
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
    private JsonNode finishProduction(Client staff, String id, long version) throws Exception {
        var detail = staff.request("GET", "/api/orders/" + id, null).body.path("data");
        assertEquals(version, detail.path("version").asLong());
        if (detail.path("status").asText().equals("CAKE_BASE")) detail = production(staff, id, detail.path("version").asLong(), "COMPLETE_BASE");
        if (detail.path("status").asText().equals("LAYER")) detail = production(staff, id, detail.path("version").asLong(), "COMPLETE_LAYER");
        if (detail.path("status").asText().equals("FROSTING")) detail = production(staff, id, detail.path("version").asLong(), "COMPLETE_FROSTING");
        for (var item : detail.path("items")) {
            var checked = staff.request("PATCH", "/api/orders/" + id + "/items/" + item.path("itemId").asText() + "/production-status",
                    Map.of("expectedVersion", detail.path("version").asLong(), "completed", true));
            assertEquals(200, checked.status, checked.body.toString()); detail = checked.body.path("data");
        }
        return production(staff, id, detail.path("version").asLong(), "COMPLETE_DECORATION");
    }
    private static Map<String, Object> action(Number version, String action) { return Map.of("expectedVersion", version, "action", action); }
    @Test void deliveryAndPickupCloseOrdersWithAuditedRealtimeHandoff() throws Exception {
        var staff = staff(); var peer = new Client(); peer.login("0001", PASSWORD);
        for (var type : List.of("DELIVERY", "PICKUP")) {
            var request = new LinkedHashMap<String, Object>(cakeOrder());
            request.put("fulfillment", Map.of("type", type, "address", "示例地址", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"));
            var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(0, "COMPLETE_DELIVERY")).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(0, "SHIP")).status);
            production(staff, id, 0, "COMPLETE_BASE"); production(staff, id, 1, "COMPLETE_LAYER");
            var ready = finishProduction(staff, id, 2);
            assertEquals("WAITING_DELIVERY", ready.path("status").asText());
            try (var stream = peer.stream()) {
                String wrong = type.equals("DELIVERY") ? "CONFIRM_PICKUP" : "COMPLETE_DELIVERY";
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(ready.path("version").asLong(), wrong)).status);
                assertEquals(400, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(ready.path("version").asLong(), "START_DELIVERY")).status);
                stream.noChange(); assertEquals(ready, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
                var completed = fulfillment(staff, id, ready.path("version").asLong(),
                        type.equals("DELIVERY") ? "COMPLETE_DELIVERY" : "CONFIRM_PICKUP");
                long version = completed.path("version").asLong(); stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", version);
                assertEquals("COMPLETED", completed.path("status").asText()); assertEquals("UNPAID", completed.path("paymentStatus").asText());
                assertTrue(completed.path("currentStageCode").isNull()); assertEquals(ready.path("items"), completed.path("items"));
                assertEquals(completed, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals("COMPLETED", jdbc.queryForObject("SELECT status FROM cake_order WHERE id=?::uuid", String.class, id));
                assertEquals(version, jdbc.queryForObject("SELECT version FROM cake_order WHERE id=?::uuid", Long.class, id));
                var logs = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_FULFILLMENT_CHANGED", null);
                assertEquals(1, logs.body.at("/data/total").asLong()); var log = logs.body.at("/data/items/0");
                assertEquals(type.equals("DELIVERY") ? "COMPLETE_DELIVERY" : "CONFIRM_PICKUP", log.at("/details/action").asText());
                assertEquals("WAITING_DELIVERY", log.at("/details/before/status").asText());
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
        var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data"); String id = original.path("orderId").asText(), itemId = idForName(original, "蛋糕");
        assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        production(staff, id, 1, "COMPLETE_BASE"); production(staff, id, 2, "COMPLETE_LAYER"); finishProduction(staff, id, 3);
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", itemId, "content", "原有备注")).status);
        var before = peer.request("GET", "/api/orders/" + id, null).body.path("data");
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        try (var stream = peer.stream()) {
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 7, "reason", " ")).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 5)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 7.5, "reason", "取消")).status);
            var stale = staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 6, "reason", "取消"));
            assertEquals(409, stale.status); assertEquals("CONCURRENT_MODIFICATION", stale.body.path("code").asText());
            stream.noChange(); assertEquals(before, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            var result = staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 7, "reason", " 配送异常，客户确认取消 "));
            assertEquals(200, result.status, result.body.toString()); stream.changed(id, null, "ORDER_CANCELLED", 8);
            var cancelled = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(result.body.path("data"), cancelled);
            assertEquals("CANCELLED", cancelled.path("status").asText()); assertEquals("PAID", cancelled.path("paymentStatus").asText());
            assertTrue(cancelled.path("currentStageCode").isNull()); assertEquals(before.path("items"), cancelled.path("items"));
            assertEquals(8, cancelled.path("version").asLong()); assertEquals(count + 1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            var logs = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_CANCELLED", null);
            assertEquals(1, logs.body.at("/data/total").asLong()); var log = logs.body.at("/data/items/0");
            assertEquals("配送异常，客户确认取消", log.path("content").asText()); assertEquals("WAITING_DELIVERY", log.at("/details/before/status").asText());
            assertEquals("CANCELLED", log.at("/details/after/status").asText()); assertEquals(staff.accountId, log.path("actorId").asText());
            assertEquals("前台员工", log.path("actorNameSnapshot").asText()); assertEquals(cancelled.path("updatedAt"), log.path("createdAt"));
            assertEquals(409, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 8, Map.of("quantity", 2))).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(8, "REOPEN_PRODUCTION")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(8, "COMPLETE_DELIVERY")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 8, "reason", "重复取消")).status);
            stream.noChange();
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 8, "paymentStatus", "UNPAID")).status);
            stream.changed(id, null, "PAYMENT_STATUS_CHANGED", 9);
            assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", itemId, "content", "人工退款处理备注")).status);
            stream.changed(id, itemId, "NOTE", 9);
            var after = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals("CANCELLED", after.path("status").asText());
            assertEquals("UNPAID", after.path("paymentStatus").asText()); assertEquals(List.of("人工退款处理备注", "原有备注"), contents(item(after, itemId).path("recentNotes")));
        }
    }
    @Test void sameVersionFulfillmentAndCancellationHaveOneCommitLogAndNotification() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "COMPLETE_BASE"); var ready = finishProduction(staff, id, 1);
        try (var stream = staff.stream(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(6, "COMPLETE_DELIVERY")); });
            var b = executor.submit(() -> { start.await(); return staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 6, "reason", "取消")); });
            start.countDown(); var responses = List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS));
            assertEquals(Set.of(200, 409), Set.of(responses.get(0).status, responses.get(1).status));
            var winner = responses.stream().filter(response -> response.status == 200).findFirst().orElseThrow();
            var loser = responses.stream().filter(response -> response.status == 409).findFirst().orElseThrow(); assertEquals("CONCURRENT_MODIFICATION", loser.body.path("code").asText());
            var latest = staff.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(winner.body.path("data"), latest);
            assertEquals(7, latest.path("version").asLong()); assertEquals(ready.path("items"), latest.path("items"));
            stream.changed(id, null, latest.path("status").asText().equals("CANCELLED") ? "ORDER_CANCELLED" : "ORDER_FULFILLMENT_CHANGED", 7); stream.noChange();
            assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type IN ('ORDER_FULFILLMENT_CHANGED', 'ORDER_CANCELLED')", Long.class, id));
        }
    }
    @Test void activityFailureAndOuterRollbackRestoreStatusHistoryAndSuppressSse() throws Exception {
        var staff = staff(); var request = new LinkedHashMap<String, Object>(cakeOrder());
        request.put("fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", "2026-10-16", "plannedHandoffAt", "2026-10-16T10:00:00+08:00"));
        var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "COMPLETE_BASE"); var ready = finishProduction(staff, id, 1);
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        try (var stream = staff.stream()) {
            for (boolean fulfillment : List.of(true, false)) {
                String type = fulfillment ? "ORDER_FULFILLMENT_CHANGED" : "ORDER_CANCELLED";
                doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals(type)));
                var failed = staff.request("POST", "/api/orders/" + id + (fulfillment ? "/fulfillment-actions" : "/cancel"),
                        fulfillment ? action(6, "CONFIRM_PICKUP") : Map.of("expectedVersion", 6, "reason", "取消"));
                assertEquals(503, failed.status); reset(activities); stream.noChange();
                assertEquals(ready, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
                assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
                new TransactionTemplate(transactions).executeWithoutResult(status -> {
                    var actor = new OrderCommands.Operator(UUID.fromString(staff.accountId), "前台员工");
                    if (fulfillment) orderService.fulfillmentAction(UUID.fromString(id), new OrderCommands.FulfillmentAction(6, "CONFIRM_PICKUP"), actor);
                    else orderService.cancel(UUID.fromString(id), new OrderCommands.Cancel(6, "取消"), actor);
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
    @Test void noteRequestReplaysOnceAcrossConcurrentCallsAndRejectsDifferentContent() throws Exception {
        var staff = staff();
        String id = staff.request("POST", "/api/orders", cakeOrder()).body.at("/data/orderId").asText();
        String path = "/api/orders/" + id + "/notes", key = UUID.randomUUID().toString();
        var note = Map.of("content", "复核自提时间");
        try (var executor = Executors.newVirtualThreadPerTaskExecutor(); var stream = staff.stream()) {
            var first = executor.submit(() -> staff.request("POST", path, note, key));
            var second = executor.submit(() -> staff.request("POST", path, note, key));
            var created = first.get(10, TimeUnit.SECONDS);
            var replay = second.get(10, TimeUnit.SECONDS);
            assertEquals(201, created.status, created.body.toString());
            assertEquals(201, replay.status, replay.body.toString());
            assertEquals(created.body.path("data"), replay.body.path("data"));
            stream.changed(id, null, "NOTE", 0);
            assertEquals(409, staff.request("POST", path, Map.of("content", "另一条备注"), key).status);
            assertEquals(1, query(staff, path).path("total").asLong());
            stream.noChange();
        }
        var admin = new Client();
        admin.login("0001", PASSWORD);
        assertEquals(200, admin.request("POST", "/api/orders/" + id + "/delete",
                Map.of("expectedVersion", 0, "reason", "测试删除")).status);
        assertEquals(409, staff.request("POST", path, note, key).status);
    }

    @Test void readyRemovalReopensDecorationAndKeepsOriginalItemAndHistory() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data");
        String id = original.path("orderId").asText(), first = idForName(original, "蛋糕"), second = idForName(original, "纸杯造型蛋糕");
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", second, "content", "原商品备注")).status);
        production(staff, id, 0, "COMPLETE_BASE"); var ready = finishProduction(staff, id, 1);
        try (var stream = staff.stream()) {
            var removed = staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 6));
            assertEquals(200, removed.status, removed.body.toString()); stream.changed(id, second, "ITEM_REMOVED", 7);
            var latest = removed.body.path("data"); assertEquals(1, latest.path("items").size()); assertEquals(item(ready, first), item(latest, first));
            assertEquals("DECORATING", latest.path("status").asText());
            assertTrue(jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, second));
            assertEquals("纸杯造型蛋糕", jdbc.queryForObject("SELECT name FROM cake_order_item WHERE id=?::uuid", String.class, second));
            var history = staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + second, null);
            assertEquals(200, history.status); assertEquals(3, history.body.at("/data/total").asLong());
            assertEquals("原商品备注", staff.request("GET", "/api/orders/" + id + "/activities?itemId=" + second + "&type=NOTE", null).body.at("/data/items/0/content").asText());
            var log = history.body.at("/data/items/0"); assertEquals("ITEM_REMOVED", log.path("type").asText());
            assertEquals("纸杯造型蛋糕", log.at("/details/before/name").asText()); assertFalse(log.at("/details/before/isRemoved").asBoolean());
            assertTrue(log.at("/details/after/isRemoved").asBoolean());
            assertEquals(latest, staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 7)).body.path("data"));
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/items/" + second + "/remove", Map.of("expectedVersion", 6)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/items/" + first + "/remove", Map.of("expectedVersion", 7)).status);
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
        production(staff, id, 0, "COMPLETE_BASE"); production(staff, id, 1, "COMPLETE_LAYER");
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
            var correctedData = corrected.body.path("data"); assertEquals("DECORATING", correctedData.path("status").asText());
            assertEquals(frosted.path("items"), correctedData.path("items")); assertEquals(correctedData, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            var log = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).body.at("/data/items/0");
            assertEquals("13800000000", log.at("/details/before/phone").asText()); assertEquals("13900000000", log.at("/details/after/phone").asText());
            assertEquals(25000, log.at("/details/before/totalAmountCents").asLong()); assertEquals(28000, log.at("/details/after/totalAmountCents").asLong());
            assertEquals(staff.accountId, log.path("actorId").asText()); assertEquals(correctedData.path("updatedAt"), log.path("createdAt"));
            var added = staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 4,
                    "item", Map.of("name", "商品 C", "productType", "OTHER", "quantity", 1, "unitPriceCents", 500, "attributes", Map.of("flavor", "香草"))));
            assertEquals(201, added.status, added.body.toString()); var addedData = added.body.path("data"); String third = idForName(addedData, "商品 C");
            assertNotEquals(first, third); assertNotEquals(second, third); stream.changed(id, third, "ITEM_ADDED", 5);
            assertEquals(3, addedData.path("items").size()); assertEquals("CAKE_BASE", addedData.path("status").asText()); assertTrue(addedData.path("currentStageCode").isNull());
            assertEquals("NOT_STARTED", item(addedData, third).path("productionStatus").asText()); assertTrue(item(addedData, third).path("currentStageCode").isNull());
            for (var product : addedData.path("items")) assertEquals("NOT_STARTED", product.path("productionStatus").asText());
            assertEquals(28000, addedData.path("totalAmountCents").asLong()); assertEquals(addedData, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            var addLog = peer.request("GET", "/api/orders/" + id + "/activities?itemId=" + third + "&type=ITEM_ADDED", null).body.at("/data/items/0");
            assertEquals("DECORATING", addLog.at("/details/before/status").asText()); assertEquals("CAKE_BASE", addLog.at("/details/after/status").asText());
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
            stream.noChange(); var layer = production(staff, id, 6, "COMPLETE_BASE"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 7);
            assertEquals("LAYER", layer.path("status").asText());
            production(staff, id, 7, "COMPLETE_LAYER"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 8);
            production(staff, id, 8, "COMPLETE_FROSTING"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 9);
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/items/" + third + "/production-status", Map.of("expectedVersion", 9, "completed", true)).status);
            stream.changed(id, third, "ORDER_PRODUCTION_CHANGED", 10);
            assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/items/" + first + "/production-status", Map.of("expectedVersion", 10, "completed", true)).status);
            stream.changed(id, first, "ORDER_PRODUCTION_CHANGED", 11);
            var complete = production(staff, id, 11, "COMPLETE_DECORATION"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", 12);
            assertEquals("WAITING_DELIVERY", complete.path("status").asText());
            assertTrue(jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, second));
            assertEquals("NOT_STARTED", jdbc.queryForObject("SELECT production_status FROM cake_order_item WHERE id=?::uuid", String.class, second));
            assertEquals(complete, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
        }
    }
    @Test void informationAndAdditionFailuresAndOuterRollbacksRestoreDatabaseAndSuppressSse() throws Exception {
        var staff = staff(); var request = new LinkedHashMap<String, Object>(create()); request.put("totalAmountCents", 25000);
        var original = staff.request("POST", "/api/orders", request).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "COMPLETE_BASE"); var before = production(staff, id, 1, "COMPLETE_LAYER");
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
                assertEquals("FROSTING", jdbc.queryForObject("SELECT status FROM cake_order WHERE id=?::uuid", String.class, id));
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
        }).when(orders).addItem(any(), eq(0L), any(), anyList());
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
        var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "COMPLETE_BASE"); production(staff, id, 1, "COMPLETE_LAYER");
        var ready = finishProduction(staff, id, 2);
        try (var stream = peer.stream()) {
            var pickup = new LinkedHashMap<String, Object>(); pickup.put("fulfillmentType", "PICKUP"); pickup.put("address", null);
            doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> activity.type().equals("ORDER_INFORMATION_CHANGED")));
            assertEquals(503, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 6, "changes", pickup)).status);
            reset(activities); stream.noChange(); assertEquals(ready, peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            var corrected = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 6, "changes", pickup));
            assertEquals(200, corrected.status, corrected.body.toString()); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 7);
            var waitingPickup = peer.request("GET", "/api/orders/" + id, null).body.path("data"); assertEquals(corrected.body.path("data"), waitingPickup);
            assertEquals("WAITING_DELIVERY", waitingPickup.path("status").asText()); assertTrue(waitingPickup.at("/fulfillment/address").isNull());
            assertTrue(waitingPickup.path("currentStageCode").isNull()); assertEquals(ready.path("items"), waitingPickup.path("items"));
            assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 7, "changes", Map.of("fulfillmentType", "DELIVERY"))).status);
            var delivery = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 7,
                    "changes", Map.of("fulfillmentType", "DELIVERY", "address", "更正地址")));
            assertEquals(200, delivery.status); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 8);
            var handoff = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 8, "changes", Map.of("fulfillmentType", "PICKUP")));
            assertEquals(200, handoff.status, handoff.body.toString()); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 9);
            assertEquals("WAITING_DELIVERY", handoff.body.at("/data/status").asText()); assertEquals(delivery.body.at("/data/items"), handoff.body.at("/data/items"));
            var log = peer.request("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).body.at("/data/items/0");
            assertTrue(log.at("/details/before/status").isMissingNode()); assertTrue(log.at("/details/after/status").isMissingNode());
            assertEquals("DELIVERY", log.at("/details/before/fulfillmentType").asText()); assertEquals("PICKUP", log.at("/details/after/fulfillmentType").asText());
            assertEquals(staff.accountId, log.path("actorId").asText()); assertEquals("前台员工", log.path("actorNameSnapshot").asText());
            var completed = fulfillment(staff, id, 9, "CONFIRM_PICKUP"); stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", 10);
            var terminal = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 10,
                    "changes", Map.of("fulfillmentType", "DELIVERY", "phone", "13900000000", "totalAmountCents", 20000)));
            assertEquals(200, terminal.status); stream.changed(id, null, "ORDER_INFORMATION_CHANGED", 11);
            assertEquals("COMPLETED", terminal.body.at("/data/status").asText()); assertEquals(completed.path("items"), terminal.body.at("/data/items"));
            assertEquals(terminal.body.path("data"), peer.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals("DELIVERY", jdbc.queryForObject("SELECT fulfillment_type FROM cake_order WHERE id=?::uuid", String.class, id));
            var noop = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 11, "changes", Map.of("fulfillmentType", "DELIVERY")));
            assertEquals(200, noop.status); assertEquals(terminal.body.path("data"), noop.body.path("data")); stream.noChange();
        }
        var another = staff.request("POST", "/api/orders", cakeOrder()).body.path("data"); String cancelledId = another.path("orderId").asText();
        production(staff, cancelledId, 0, "COMPLETE_BASE"); finishProduction(staff, cancelledId, 1);
        var cancelled = staff.request("POST", "/api/orders/" + cancelledId + "/cancel", Map.of("expectedVersion", 6, "reason", "人工取消")).body.path("data");
        try (var stream = peer.stream()) {
            var corrected = staff.request("PATCH", "/api/orders/" + cancelledId + "/information", Map.of("expectedVersion", 7,
                    "changes", Map.of("fulfillmentType", "PICKUP", "phone", "13900000000")));
            assertEquals(200, corrected.status); stream.changed(cancelledId, null, "ORDER_INFORMATION_CHANGED", 8);
            assertEquals("CANCELLED", corrected.body.at("/data/status").asText()); assertEquals(cancelled.path("items"), corrected.body.at("/data/items"));
            assertEquals(corrected.body.path("data"), peer.request("GET", "/api/orders/" + cancelledId, null).body.path("data"));
        }
    }
    @Test void calendarReturnsOnlyPhoneSuffixAndKeepsWorkbenchContract() throws Exception {
        var staff = staff();
        var created = createOn(staff, "2026-09-30", "10:00", "PICKUP");
        String id = created.path("orderId").asText();
        assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0,
                "changes", Map.of("phone", "13800000012"))).status);
        var calendar = query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01").get(0);
        assertEquals("0012", calendar.path("customerPhoneLast4").asText());
        assertFalse(calendar.has("customer")); assertFalse(calendar.has("phone"));
        var pending = query(staff, "/api/orders/workbench?date=2026-09-30").path("pendingOrders").get(0);
        assertEquals("13800000012", pending.at("/customer/phone").asText());
        assertFalse(pending.has("customerPhoneLast4"));
        assertEquals(200, staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", 1, "reason", "取消测试")).status);
        var cancelled = query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01").get(0);
        assertEquals("CANCELLED", cancelled.path("status").asText());
        assertEquals("0012", cancelled.path("customerPhoneLast4").asText());
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
        assertEquals(Set.of("orderId", "orderNo", "calendarDate", "status", "currentStageCode", "paymentStatus", "fulfillmentType", "plannedHandoffAt", "customerPhoneLast4", "items"),
                json.convertValue(week.get(0), Map.class).keySet());
        assertEquals(Set.of("itemId", "name", "quantity"), json.convertValue(week.get(0).at("/items/0"), Map.class).keySet());
        assertTrue(query(staff, "/api/orders/calendar?from=2026-12-01&to=2026-12-02").isEmpty());

        String id = early.path("orderId").asText();
        var handoff = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0,
                "changes", Map.of("plannedHandoffAt", "2026-10-02T12:00:00+08:00")));
        assertEquals(200, handoff.status);
        assertFalse(orderIds(query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01")).contains(id));
        assertTrue(orderIds(query(staff, "/api/orders/calendar?from=2026-10-02&to=2026-10-03")).contains(id));
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
        doReturn(noteTime.plusSeconds(1)).when(clock).instant();
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "订单级备注")).status);
        var before = staff.request("GET", "/api/orders/" + id, null).body.path("data");
        long activityCount = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        try (var stream = staff.stream()) {
            clearInvocations(queryMapper, orders, activities);
            var workbench = query(staff, "/api/orders/workbench?date=2026-09-30");
            verify(queryMapper).metrics(any(), any(), any()); verify(queryMapper).pending(any());
            verify(queryMapper).items(any()); verify(queryMapper).recentNotes(any(), any()); verify(queryMapper).latestNotes(any());
            verifyNoMoreInteractions(queryMapper); verifyNoInteractions(orders, activities);
            assertEquals("2026-09-30", workbench.path("date").asText());
            var pending = workbench.path("pendingOrders"); assertEquals(2, pending.size());
            var order = pending.get(0);
            assertEquals("订单级备注", order.at("/latestNote/content").asText());
            assertTrue(order.at("/latestNote/itemId").isNull());
            assertEquals(c + ":3", pending.get(1).at("/latestNote/content").asText());
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
            assertEquals("CAKE", cake.path("productType").asText()); assertTrue(cake.path("unitPriceCents").isNull());
            assertTrue(cake.path("memberPriceCents").isNull()); assertEquals(item(firstOrder, a).path("attributes"), cake.path("attributes"));
            clearInvocations(queryMapper);
            var withoutMetrics = query(staff, "/api/orders/workbench?date=2026-09-30&includeMetrics=false");
            assertFalse(withoutMetrics.hasNonNull("metrics"));
            assertEquals(workbench.path("pendingOrders"), withoutMetrics.path("pendingOrders"));
            verify(queryMapper).pending(any()); verify(queryMapper).items(any()); verify(queryMapper).recentNotes(any(), any()); verify(queryMapper).latestNotes(any());
            verifyNoMoreInteractions(queryMapper); verifyNoInteractions(orders, activities);
            clearInvocations(queryMapper);
            query(staff, "/api/orders/calendar?from=2026-09-28&to=2026-11-09");
            verify(queryMapper).calendar(any(), any()); verify(queryMapper).calendarItems(any());
            verifyNoMoreInteractions(queryMapper); verifyNoInteractions(orders, activities);
            stream.noChange();
        }
        assertEquals(before, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
        assertEquals(activityCount, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        doReturn(noteTime.plusSeconds(2)).when(clock).instant();
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", b, "content", "最新商品备注")).status);
        assertEquals("最新商品备注", query(staff, "/api/orders/workbench?date=2026-09-30").at("/pendingOrders/0/latestNote/content").asText());
        assertEquals(200, staff.request("POST", "/api/orders/" + id + "/items/" + b + "/remove", Map.of("expectedVersion", 0)).status);
        assertEquals("订单级备注", query(staff, "/api/orders/workbench?date=2026-09-30").at("/pendingOrders/0/latestNote/content").asText());
        var remaining = query(staff, "/api/orders/workbench?date=2026-09-30").at("/pendingOrders/0/items");
        assertEquals(1, remaining.size()); assertEquals(a, remaining.get(0).path("itemId").asText());
        assertEquals(1, query(staff, "/api/orders/calendar?from=2026-09-30&to=2026-10-01").at("/0/items").size());
        assertEquals(true, jdbc.queryForObject("SELECT is_removed FROM cake_order_item WHERE id=?::uuid", Boolean.class, b));
    }

    @Test void workbenchMetricsCountOrdersAcrossStatesAndShanghaiCreationBoundaries() throws Exception {
        var staff = staff();
        var empty = query(staff, "/api/orders/workbench?date=2026-09-30");
        assertEquals(0, empty.at("/metrics/totalOrders").asLong()); assertTrue(empty.path("pendingOrders").isEmpty());
        var waiting = createCakeOn(staff, "2026-09-30", "09:00", "DELIVERY");
        var processing = createCakeOn(staff, "2026-09-30", "10:00", "DELIVERY");
        var ready = createCakeOn(staff, "2026-09-30", "11:00", "DELIVERY");
        var delivering = createCakeOn(staff, "2026-09-30", "12:00", "DELIVERY");
        var completed = createCakeOn(staff, "2026-09-30", "13:00", "DELIVERY");
        var cancelled = createCakeOn(staff, "2026-09-30", "14:00", "DELIVERY");
        createCakeOn(staff, "2026-09-30", "15:00", "PICKUP");
        var other = createCakeOn(staff, "2026-10-01", "10:00", "DELIVERY");
        String processingId = processing.path("orderId").asText(), readyId = ready.path("orderId").asText();
        String deliveringId = delivering.path("orderId").asText(), completedId = completed.path("orderId").asText();
        production(staff, processingId, 0, "COMPLETE_BASE"); production(staff, processingId, 1, "COMPLETE_LAYER");
        assertEquals(200, staff.request("PATCH", "/api/orders/" + processingId + "/payment-status",
                Map.of("expectedVersion", 2, "paymentStatus", "PAID")).status);
        for (var id : List.of(readyId, deliveringId, completedId)) {
            production(staff, id, 0, "COMPLETE_BASE"); finishProduction(staff, id, 1);
        }
        fulfillment(staff, completedId, 6, "COMPLETE_DELIVERY");
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
        assertEquals("FROSTING", pending.get(1).path("status").asText());
        assertEquals("PAID", pending.get(1).path("paymentStatus").asText());
        assertTrue(pending.get(1).path("currentStageCode").isNull());
        assertEquals("WAITING_DELIVERY", pending.get(2).path("status").asText());
        assertEquals("WAITING_DELIVERY", pending.get(3).path("status").asText());
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

    @Test void shippingPaymentSummaryCountsOrdersOnceAndIgnoresListFilters() throws Exception {
        var staff = staff(); String path = "/api/orders/workbench/payment-summary?date=2026-10-23";
        assertEquals(0, query(staff, path).path("totalOrderCount").asLong());
        var paid = createCakeOn(staff, "2026-10-23", "09:00", "PICKUP");
        var completed = createCakeOn(staff, "2026-10-23", "10:00", "DELIVERY");
        var zero = createCakeOn(staff, "2026-10-23", "11:00", "PICKUP");
        var missing = createCakeOn(staff, "2026-10-23", "12:00", "DELIVERY");
        var cancelled = createCakeOn(staff, "2026-10-23", "13:00", "DELIVERY");
        createCakeOn(staff, "2026-10-24", "09:00", "DELIVERY");
        String paidId = paid.path("orderId").asText(), completedId = completed.path("orderId").asText(), zeroId = zero.path("orderId").asText();
        String missingId = missing.path("orderId").asText(), cancelledId = cancelled.path("orderId").asText();
        jdbc.update("UPDATE cake_order SET total_amount_cents=12345 WHERE id=?::uuid", paidId);
        jdbc.update("UPDATE cake_order SET total_amount_cents=6789 WHERE id=?::uuid", completedId);
        jdbc.update("UPDATE cake_order SET total_amount_cents=0 WHERE id=?::uuid", zeroId);
        jdbc.update("UPDATE cake_order SET total_amount_cents=NULL WHERE id=?::uuid", missingId);
        assertEquals(200, staff.request("PATCH", "/api/orders/" + paidId + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        production(staff, completedId, 0, "COMPLETE_BASE"); finishProduction(staff, completedId, 1);
        fulfillment(staff, completedId, 6, "COMPLETE_DELIVERY");
        assertEquals(200, staff.request("PATCH", "/api/orders/" + completedId + "/payment-status", Map.of("expectedVersion", 7, "paymentStatus", "PAID")).status);
        production(staff, missingId, 0, "COMPLETE_BASE"); finishProduction(staff, missingId, 1);
        assertEquals(200, staff.request("POST", "/api/orders/" + cancelledId + "/cancel", Map.of("expectedVersion", 0, "reason", "取消")).status);
        long activities = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        var summary = query(staff, path);
        assertEquals(4, summary.path("totalOrderCount").asLong()); assertEquals(1, summary.path("waitingDeliveryOrderCount").asLong());
        assertEquals(2, summary.at("/paid/orderCount").asLong()); assertEquals("19134", summary.at("/paid/amountCents").asText());
        assertEquals(2, summary.at("/unpaid/orderCount").asLong()); assertEquals("0", summary.at("/unpaid/amountCents").asText());
        assertEquals(1, summary.at("/unpaid/missingAmountOrderCount").asLong());
        String listPath = "/api/orders/workbench/payment-orders?date=2026-10-23&kind=";
        var paidList = query(staff, listPath + "SHIPPING_PAID");
        assertEquals(2, paidList.path("total").asInt());
        assertEquals(paidId, paidList.at("/orders/0/orderId").asText());
        assertEquals("12345", paidList.at("/orders/0/amountCents").asText());
        var unpaidList = query(staff, listPath + "SHIPPING_UNPAID");
        assertEquals(2, unpaidList.path("total").asInt());
        assertEquals("0", unpaidList.at("/orders/0/amountCents").asText());
        assertTrue(unpaidList.at("/orders/1/amountCents").isNull());
        jdbc.update("UPDATE cake_order SET paid_at='2026-10-22T16:00:00Z', created_at='2020-01-01T00:00:00Z' WHERE id=?::uuid", paidId);
        jdbc.update("UPDATE cake_order SET paid_at='2026-10-23T16:00:00Z' WHERE id=?::uuid", completedId);
        assertEquals(1, query(staff, listPath + "RECEIPT").path("total").asInt());
        assertEquals(0, query(staff, "/api/orders/workbench/payment-orders?date=2026-10-22&kind=RECEIPT").path("total").asInt());
        jdbc.update("UPDATE cake_order SET payment_status='PAID',paid_at='2026-10-23T01:00:00Z' WHERE id=?::uuid", cancelledId);
        assertEquals(2, query(staff, listPath + "RECEIPT").path("total").asInt());
        assertEquals(2, query(staff, listPath + "SHIPPING_PAID").path("total").asInt());
        assertEquals(400, staff.request("GET", listPath + "INVALID", null).status);
        assertEquals(400, staff.request("GET", listPath + "RECEIPT&page=0", null).status);
        assertEquals(401, new Client().request("GET", listPath + "RECEIPT", null).status);
        assertEquals(0, summary.path("paidWithoutDateOrderCount").asLong());
        for (var filters : List.of("&status=CANCELLED", "&paymentStatus=PAID", "&status=FROSTING&paymentStatus=UNPAID")) assertEquals(summary, query(staff, path + filters));
        assertEquals(activities, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        jdbc.update("UPDATE cake_order SET paid_at=NULL WHERE id=?::uuid", paidId);
        var withoutDate = query(staff, path);
        assertEquals(1, withoutDate.path("paidWithoutDateOrderCount").asLong());
        assertEquals(summary.path("paid"), withoutDate.path("paid"));
        jdbc.update("UPDATE cake_order SET payment_status='PAID', paid_at=NULL WHERE id=?::uuid", cancelledId);
        assertEquals(1, query(staff, path).path("paidWithoutDateOrderCount").asLong());
        assertEquals(0, query(staff, "/api/orders/workbench/payment-summary?date=2026-10-24").path("paidWithoutDateOrderCount").asLong());
        assertEquals(200, staff.request("PATCH", "/api/orders/" + zeroId + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        assertEquals(3, query(staff, path).at("/paid/orderCount").asLong());
        jdbc.update("UPDATE cake_order SET total_amount_cents=? WHERE id=?::uuid", Long.MAX_VALUE, paidId);
        assertEquals("9223372036854782596", query(staff, path).at("/paid/amountCents").asText());
        assertEquals(1, query(staff, "/api/orders/workbench/payment-summary?date=2026-10-24").path("totalOrderCount").asLong());
        assertEquals("0", query(staff, "/api/orders/workbench/payment-summary?date=2026-10-25").at("/paid/amountCents").asText());
    }

    @Test void moneyWritesRespectBrowserSafeLimitWhileAggregatesCanExceedIt() throws Exception {
        long maximum = 9_007_199_254_740_991L;
        var staff = staff();
        var valid = new LinkedHashMap<>(create());
        valid.put("totalAmountCents", maximum);
        valid.put("items", List.of(Map.of("name", "边界饮品", "productType", "DRINK", "quantity", 1, "unitPriceCents", maximum, "memberPriceCents", maximum)));
        var created = staff.request("POST", "/api/orders", valid);
        assertEquals(201, created.status, created.body.toString());
        var detail = created.body.path("data");
        String id = detail.path("orderId").asText(), itemId = detail.at("/items/0/itemId").asText();
        assertEquals(maximum, detail.path("totalAmountCents").asLong());
        assertTrue(detail.at("/items/0/unitPriceCents").isNull());
        assertTrue(detail.at("/items/0/memberPriceCents").isNull());
        var invalid = new LinkedHashMap<>(valid); invalid.put("totalAmountCents", maximum + 1);
        assertEquals(400, staff.request("POST", "/api/orders", invalid).status);
        invalid.put("totalAmountCents", 1.5);
        assertEquals(400, staff.request("POST", "/api/orders", invalid).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/information",
                Map.of("expectedVersion", 0, "changes", Map.of("totalAmountCents", maximum + 1))).status);
        for (var field : List.of("unitPriceCents", "memberPriceCents"))
            assertEquals(400, staff.request("PATCH", "/api/orders/" + id, patch(itemId, 0, Map.of(field, maximum + 1))).status);
        var unchanged = query(staff, "/api/orders/" + id);
        assertEquals(0, unchanged.path("version").asLong());
        assertEquals(maximum, unchanged.path("totalAmountCents").asLong());
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order", Long.class));
        assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        var second = staff.request("POST", "/api/orders", valid);
        assertEquals(201, second.status, second.body.toString());
        var date = detail.at("/fulfillment/requestedReceiveDate").asText();
        var summary = query(staff, "/api/orders/workbench/payment-summary?date=" + date);
        assertEquals("18014398509481982", summary.at("/unpaid/amountCents").asText());
    }

    @Test void paymentPagesIncludeFutureShippingAndClampAfterPaymentCorrections() throws Exception {
        var staff = staff();
        var ids = new ArrayList<String>();
        for (int i = 0; i < 12; i++) ids.add(createOn(staff, "2026-11-01", "09:00", "PICKUP").path("orderId").asText());
        jdbc.update("UPDATE cake_order SET payment_status='PAID', paid_at='2026-10-23T01:00:00Z', total_amount_cents=100, created_at='2020-01-01T00:00:00Z'");
        String path = "/api/orders/workbench/payment-orders?date=2026-10-23&kind=RECEIPT";
        var first = query(staff, path);
        assertEquals(12, first.path("total").asInt());
        assertEquals(10, first.path("orders").size());
        var second = query(staff, path + "&page=2");
        assertEquals(2, second.path("orders").size());
        assertNotEquals(first.at("/orders/9/orderId"), second.at("/orders/0/orderId"));
        assertEquals("1200", query(staff, "/api/orders/workbench/receipt-summary?date=2026-10-23").path("amountCents").asText());
        assertEquals(0, query(staff, "/api/orders/workbench/payment-orders?date=2026-10-23&kind=SHIPPING_PAID").path("total").asInt());
        jdbc.update("UPDATE cake_order SET payment_status='UNPAID', paid_at=NULL");
        var empty = query(staff, path + "&page=2");
        assertEquals(0, empty.path("total").asInt()); assertEquals(1, empty.path("page").asInt());
        jdbc.update("UPDATE cake_order SET payment_status='PAID', paid_at='2026-10-23T15:59:59Z' WHERE id=?::uuid", ids.getFirst());
        assertEquals(1, query(staff, path).path("total").asInt());
        jdbc.update("UPDATE cake_order SET paid_at='2026-10-23T16:00:00Z' WHERE id=?::uuid", ids.getFirst());
        assertEquals(0, query(staff, path).path("total").asInt());
    }

    @Test void cakeBasesGroupsBySizeAndBaseAndExcludesCancelledRemovedAndOtherDates() throws Exception {
        var staff = staff();
        var original = createCakeOn(staff, "2026-10-23", "09:00", "PICKUP").path("orderId").asText();
        var matcha = createCakeOn(staff, "2026-10-23", "10:00", "DELIVERY").path("orderId").asText();
        var small = createCakeOn(staff, "2026-10-23", "11:00", "PICKUP").path("orderId").asText();
        var cancelled = createCakeOn(staff, "2026-10-23", "12:00", "PICKUP").path("orderId").asText();
        var removed = createCakeOn(staff, "2026-10-23", "13:00", "PICKUP").path("orderId").asText();
        createCakeOn(staff, "2026-10-24", "09:00", "PICKUP");
        jdbc.update("UPDATE cake_order_item SET product_type='CUPCAKE' WHERE name='纸杯造型蛋糕'");
        jdbc.update("UPDATE cake_order_item SET quantity=2, attributes='{\"size\":\"8\",\"base\":\"原味\",\"flavor\":\"抹茶奶油\"}'::jsonb WHERE order_id=?::uuid", original);
        jdbc.update("UPDATE cake_order SET status='COMPLETED' WHERE id=?::uuid", original);
        jdbc.update("UPDATE cake_order_item SET quantity=3, attributes='{\"size\":\"8.00\",\"base\":\"抹茶\"}'::jsonb WHERE order_id=?::uuid", matcha);
        jdbc.update("UPDATE cake_order_item SET quantity=4, attributes='{\"size\":\"6.5\"}'::jsonb WHERE order_id=?::uuid", small);
        jdbc.update("UPDATE cake_order SET status='CANCELLED' WHERE id=?::uuid", cancelled);
        jdbc.update("UPDATE cake_order_item SET is_removed=true WHERE order_id=?::uuid", removed);
        var result = query(staff, "/api/orders/workbench/cake-bases?date=2026-10-23");
        assertEquals(3, result.path("items").size());
        assertEquals("6.5", result.at("/items/0/size").asText());
        assertEquals("原味", result.at("/items/0/flavor").asText());
        assertEquals(4, result.at("/items/0/quantity").asInt());
        var flavors = new HashMap<String, Integer>();
        result.path("items").forEach(row -> { if (row.path("size").asText().equals("8")) flavors.put(row.path("flavor").asText(), row.path("quantity").asInt()); });
        assertEquals(Map.of("原味", 2, "抹茶", 3), flavors);
    }

    @Test void defaultProductionJobHidesNonProductionDataButKeepsProductionAndNotes() throws Exception {
        var staff = staff();
        var input = new LinkedHashMap<String, Object>(create());
        input.put("customer", Map.of("customerName", "客户", "phone", "13800000000", "memberPhone", "13800000001", "buyerName", "下单人"));
        input.put("orderingMethod", "微信");
        input.put("items", List.of(
                Map.of("name", "蛋糕", "quantity", 1, "referenceUnitPriceCents", 12000, "attributes", Map.of("size", "8", "requirements", "少糖", "specification", "切成 12 份\n分开包装")),
                Map.of("name", "旧草稿纸杯", "productType", "OTHER", "quantity", 6,
                        "attributes", Map.of("specification", "独立包装\n原商品单价：12.30 元（仅供参考）\n原会员单价：0 元（仅供参考）",
                                "requirements", "少糖\n分装"))));
        var order = createOn(staff, "2026-10-23", "09:00", "DELIVERY", input); String id = order.path("orderId").asText();
        var admin = new Client(); admin.login("0001", PASSWORD);
        var provisioned = admin.request("POST", "/api/admin/employees", Map.of("employeeNumber", "CHEF01", "nickname", "制作师傅", "jobRoles", List.of("PASTRY_CHEF")));
        var chef = new Client(); String temporary = provisioned.body.at("/data/temporaryPassword").asText();
        chef.login("CHEF01", temporary); chef.changePassword(temporary); chef.login("CHEF01", PASSWORD);
        String originalToken = chef.token;
        var staffItems = query(staff, "/api/orders/" + id).path("items");
        for (var item : staffItems) {
            if (item.path("name").asText().equals("旧草稿纸杯")) {
                assertEquals(1230L, item.path("unitPriceCents").asLong());
                assertEquals(0L, item.path("memberPriceCents").asLong());
                assertEquals("独立包装", item.at("/attributes/specification").asText());
                assertEquals("少糖\n分装", item.at("/attributes/requirements").asText());
            } else assertEquals(12000L, item.path("unitPriceCents").asLong());
        }
        var unauthorizedQuote = chef.request("POST", "/api/orders", input);
        assertEquals(403, unauthorizedQuote.status);
        assertEquals(403, chef.request("PATCH", "/api/orders/" + id + "/payment-status",
                Map.of("expectedVersion", 0, "paymentStatus", "PAID")).status);
        assertEquals(403, chef.request("PATCH", "/api/orders/" + id + "/information",
                Map.of("expectedVersion", 0, "changes", Map.of("totalAmountCents", 0))).status);
        assertEquals(403, chef.request("POST", "/api/orders/" + id + "/items",
                Map.of("expectedVersion", 0, "item", Map.of("name", "报价测试", "quantity", 1, "referenceUnitPriceCents", 0))).status);
        var workload = query(chef, "/api/orders/workbench/production-orders?unscheduled=true");
        assertEquals(List.of(id), orderIds(workload.path("orders")));
        assertFalse(workload.at("/orders/0").has("customer"));
        assertFalse(workload.at("/orders/0").has("totalAmountCents"));
        var detail = query(chef, "/api/orders/" + id);
        for (var field : List.of("totalAmountCents", "createdAt", "createdBy", "creditedEmployee", "paymentStatus")) assertTrue(detail.path(field).isNull(), field);
        for (var item : detail.path("items")) {
            assertTrue(item.path("unitPriceCents").isNull());
            assertTrue(item.path("memberPriceCents").isNull());
            assertFalse(item.at("/attributes/specification").asText().contains("仅供参考"));
            if (item.path("name").asText().equals("蛋糕")) {
                assertEquals("8", item.at("/attributes/size").asText());
                assertEquals("少糖", item.at("/attributes/requirements").asText());
                assertEquals("切成 12 份\n分开包装", item.at("/attributes/specification").asText());
            } else assertEquals("少糖\n分装", item.at("/attributes/requirements").asText());
        }
        assertEquals(order.at("/customer/phone").asText(), detail.at("/customer/phone").asText());
        for (var field : List.of("customerName", "memberPhone")) assertTrue(detail.path("customer").path(field).isNull(), field);
        assertTrue(detail.at("/fulfillment/address").isNull()); assertTrue(detail.at("/items/0/createdAt").isNull());
        assertEquals(403, chef.request("GET", "/api/orders/workbench/payment-summary?date=2026-10-23", null).status);
        assertEquals(403, chef.request("GET", "/api/orders/" + id + "/activities", null).status);
        assertEquals(403, chef.request("POST", "/api/orders/" + id + "/exports/xlsx", null).status);
        assertEquals(201, chef.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "夹心请复核")).status);
        var notes = query(chef, "/api/orders/" + id + "/notes?type=CREATED");
        assertEquals(1, notes.path("total").asLong()); assertEquals("NOTE", notes.at("/items/0/type").asText());
        assertTrue(notes.at("/items/0/details").isEmpty());
        assertEquals("下单人", detail.at("/customer/buyerName").asText());
        assertEquals("微信", detail.path("orderingMethod").asText());
        var updated = production(chef, id, 0, "COMPLETE_BASE");
        assertEquals(detail.path("customer"), updated.path("customer"));
        assertEquals(detail.path("orderingMethod"), updated.path("orderingMethod"));
        assertTrue(updated.at("/fulfillment/address").isNull());
        assertEquals(200, chef.request("GET", "/api/orders/" + id + "/images", null).status);
        var profile = query(chef, "/api/me");
        var revised = admin.request("PATCH", "/api/admin/employees/" + profile.path("accountId").asText(), Map.of("expectedVersion", profile.path("version").asLong(), "nickname", "兼岗师傅", "jobRoles", List.of("PASTRY_CHEF", "FRONT_DESK")));
        assertEquals(200, revised.status); assertEquals(originalToken, chef.token);
        assertTrue(query(chef, "/api/orders/" + id).path("customer").isObject());
        assertEquals(200, chef.request("GET", "/api/orders/workbench/payment-summary?date=2026-10-23", null).status);
    }

    private JsonNode createOn(Client staff, String date, String time, String type) throws Exception {
        return createOn(staff, date, time, type, create());
    }
    private JsonNode createCakeOn(Client staff, String date, String time, String type) throws Exception {
        return createOn(staff, date, time, type, cakeOrder());
    }
    private JsonNode createOn(Client staff, String date, String time, String type, Map<String, Object> input) throws Exception {
        var command = new LinkedHashMap<>(input);
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
            assertEquals("no-store", result.headers.firstValue("Cache-Control").orElseThrow());
            assertEquals("2026-09-30", result.body.at("/data/fields/requestedReceiveDate/value").asText());
            assertTrue(result.body.at("/data/fields/plannedHandoffAt/value").isNull());
            assertEquals("芒果、脆啵啵、奥利奥", result.body.at("/data/items/0/fields/filling/value").asText());
            assertTrue(result.body.at("/data/items/0/fields/name/value").isNull());
            assertTrue(result.body.at("/data/items/0/fields/quantity/value").isNull());
            assertEquals(400, staff.request("POST", "/api/orders/recognition/parse", Map.of("text", "字".repeat(12001))).status);
            assertEquals(400, staff.request("POST", "/api/orders/recognition/parse", Map.of("text", " ")).status);
            var assisted = staff.request("POST", "/api/orders/recognition/assist", Map.of("text", "【蛋糕预定单】\n奶油用动物的", "allowExternalProcessing", true));
            assertEquals(200, assisted.status); assertEquals("DISABLED", assisted.body.at("/data/status").asText());
            assertEquals("no-store", assisted.headers.firstValue("Cache-Control").orElseThrow());
            verifyNoInteractions(orders, activities);
            assertEquals(original, staff.request("GET", "/api/orders/" + id, null).body.path("data"));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_image", Integer.class));
            stream.noChange();
        }
    }
    @Test void simpleWorkflowPackagesAndReceiptDatePersist() throws Exception {
        var staff = staff();
        var admin = new Client(); admin.login("0001", PASSWORD);
        var bundle = Map.of("name", "客服茶歇套餐", "originalAmountCents", 10000, "items", List.of(Map.of("itemId", UUID.randomUUID(), "name", "面包", "productType", "OTHER", "quantity", 6, "attributes", Map.of("specification", "小份"))));
        var saved = admin.request("POST", "/api/order-packages", bundle);
        assertEquals(201, saved.status, saved.body.toString());
        String packageId = saved.body.at("/data/id").asText();
        assertEquals("小份", staff.request("GET", "/api/order-packages", null).body.at("/data/items/0/items/0/attributes/specification").asText());
        var input = new LinkedHashMap<String, Object>(create()); input.put("totalAmountCents", 16000);
        var created = staff.request("POST", "/api/orders", input);
        assertEquals(201, created.status, created.body.toString());
        String id = created.body.at("/data/orderId").asText();
        String cupcake = idForName(created.body.path("data"), "纸杯");
        production(admin, id, 0, "COMPLETE_BASE");
        production(admin, id, 1, "COMPLETE_LAYER");
        production(admin, id, 2, "COMPLETE_FROSTING");
        var blocked = admin.request("POST", "/api/orders/" + id + "/production-actions", action(3, "COMPLETE_DECORATION"));
        assertEquals(409, blocked.status); assertEquals("OTHER_ITEMS_INCOMPLETE", blocked.body.path("code").asText());
        var checked = admin.request("PATCH", "/api/orders/" + id + "/items/" + cupcake + "/production-status", Map.of("expectedVersion", 3, "completed", true));
        assertEquals(200, checked.status, checked.body.toString());
        assertEquals("COMPLETED", item(checked.body.path("data"), cupcake).path("productionStatus").asText());
        assertEquals(409, admin.request("POST", "/api/orders/" + id + "/production-actions", action(4, "COMPLETE_DECORATION")).status);
        String cake = idForName(created.body.path("data"), "蛋糕");
        var cakeChecked = admin.request("PATCH", "/api/orders/" + id + "/items/" + cake + "/production-status", Map.of("expectedVersion", 4, "completed", true));
        assertEquals(200, cakeChecked.status, cakeChecked.body.toString());
        assertEquals("COMPLETED", jdbc.queryForObject("SELECT production_status FROM cake_order_item WHERE id=?::uuid", String.class, cake));
        var cakeLog = query(staff, "/api/orders/" + id + "/activities?itemId=" + cake + "&type=ORDER_PRODUCTION_CHANGED").at("/items/0");
        assertEquals("更新商品制作确认", cakeLog.path("content").asText());
        assertEquals("IN_PROGRESS", cakeLog.at("/details/before/productionStatus").asText());
        assertEquals("COMPLETED", cakeLog.at("/details/after/productionStatus").asText());
        assertEquals(409, admin.request("PATCH", "/api/orders/" + id + "/items/" + cake + "/production-status", Map.of("expectedVersion", 4, "completed", false)).status);
        production(admin, id, 5, "COMPLETE_DECORATION");
        assertEquals("WAITING_DELIVERY", staff.request("GET", "/api/orders/" + id, null).body.at("/data/status").asText());
        jdbc.update("UPDATE cake_order SET created_at='2020-01-01T00:00:00Z' WHERE id=?::uuid", id);
        var paid = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 6, "paymentStatus", "PAID"));
        assertEquals(200, paid.status, paid.body.toString()); assertFalse(paid.body.at("/data/paidAt").isNull());
        String date = Instant.parse(paid.body.at("/data/paidAt").asText()).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().toString();
        var receipt = staff.request("GET", "/api/orders/workbench/receipt-summary?date=" + date, null);
        assertEquals(200, receipt.status, receipt.body.toString()); assertEquals("16000", receipt.body.at("/data/amountCents").asText());
        assertEquals(1, receipt.body.at("/data/orderCount").asInt());
        var repeated = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 7, "paymentStatus", "PAID"));
        assertEquals(paid.body.at("/data/paidAt"), repeated.body.at("/data/paidAt"));
        jdbc.update("UPDATE cake_order SET paid_at='2026-10-22T16:00:00Z' WHERE id=?::uuid", id);
        assertEquals(1, query(staff, "/api/orders/workbench/receipt-summary?date=2026-10-23").path("orderCount").asInt());
        assertEquals(0, query(staff, "/api/orders/workbench/receipt-summary?date=2026-10-22").path("orderCount").asInt());
        jdbc.update("UPDATE cake_order SET paid_at='2026-10-23T16:00:00Z' WHERE id=?::uuid", id);
        assertEquals(0, query(staff, "/api/orders/workbench/receipt-summary?date=2026-10-23").path("orderCount").asInt());
        assertEquals(1, query(staff, "/api/orders/workbench/receipt-summary?date=2026-10-24").path("orderCount").asInt());
        var bases = staff.request("GET", "/api/orders/workbench/cake-bases?date=2026-10-16", null);
        assertEquals(200, bases.status, bases.body.toString()); assertEquals(1, bases.body.at("/data/items").size());
        assertEquals("原味", bases.body.at("/data/items/0/flavor").asText()); assertEquals(1, bases.body.at("/data/items/0/quantity").asInt());
        assertEquals(200, admin.request("DELETE", "/api/order-packages/" + packageId + "?expectedVersion=0", null).status);
        assertEquals(0, staff.request("GET", "/api/order-packages", null).body.at("/data/total").asInt());
    }
    @Test void historicalUnpaidBypassesDatesAndOrdersOldestFirst() throws Exception {
        var staff = staff(); var admin = new Client(); admin.login("0001", PASSWORD);
        String recent = staff.request("POST", "/api/orders", create()).body.at("/data/orderId").asText();
        String oldest = staff.request("POST", "/api/orders", create()).body.at("/data/orderId").asText();
        String paid = staff.request("POST", "/api/orders", create()).body.at("/data/orderId").asText();
        jdbc.update("UPDATE cake_order SET created_at='2020-01-01T00:00:00Z' WHERE id=?::uuid", oldest);
        staff.request("PATCH", "/api/orders/" + paid + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID"));
        var report = admin.request("GET", "/api/admin/orders?allUnpaid=true&from=2026-10-23&to=2026-10-24&keyword=nomatch", null);
        assertEquals(200, report.status, report.body.toString());
        assertEquals(2, report.body.at("/data/totals/orderCount").asInt());
        assertEquals(oldest, report.body.at("/data/items/0/orderId").asText());
        assertEquals(recent, report.body.at("/data/items/1/orderId").asText());
    }
    @Test void frontDeskCannotWriteProductionButCanCreatePayAndHandoff() throws Exception {
        var maker = staff(); var admin = new Client(); admin.login("0001", PASSWORD);
        int number = 10;
        for (String role : List.of("FRONT_DESK", "FRONT_DESK_SUPERVISOR", "FRONT_DESK_CLERK")) {
            String employeeNumber = "FD" + number++;
            var provisioned = admin.request("POST", "/api/admin/employees", Map.of("employeeNumber", employeeNumber, "nickname", "纯前厅", "jobRoles", List.of(role)));
            assertEquals(201, provisioned.status);
            String temporary = provisioned.body.at("/data/temporaryPassword").asText();
            var front = new Client(); front.login(employeeNumber, temporary); front.changePassword(temporary); front.login(employeeNumber, PASSWORD);
            assertEquals(200, front.request("GET", "/api/me", null).status);
            var created = front.request("POST", "/api/orders", cakeOrder()); assertEquals(201, created.status);
            String id = created.body.at("/data/orderId").asText();
            assertEquals(200, front.request("GET", "/api/orders/" + id, null).status);
            for (String action : List.of("COMPLETE_BASE", "ROLLBACK_PRODUCTION", "REOPEN_PRODUCTION")) {
                assertEquals(403, front.request("POST", "/api/orders/" + id + "/production-actions", action(0, action)).status);
            }
            assertEquals(403, front.request("PATCH", "/api/orders/" + id + "/items/" + idForName(created.body.path("data"), "蛋糕") + "/production-status", Map.of("expectedVersion", 0, "completed", true)).status);
            assertEquals(created.body.path("data"), query(front, "/api/orders/" + id));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Integer.class, id));
            production(maker, id, 0, "COMPLETE_BASE"); production(maker, id, 1, "COMPLETE_LAYER");
            var ready = finishProduction(maker, id, 2); long version = ready.path("version").asLong();
            assertEquals(200, front.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", version, "paymentStatus", "PAID")).status);
            assertEquals(200, front.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(version + 1, "COMPLETE_DELIVERY")).status);
            var pending = front.request("POST", "/api/orders", cakeOrder()).body.path("data"); String cancelledId = pending.path("orderId").asText();
            var cancelled = front.request("POST", "/api/orders/" + cancelledId + "/cancel", Map.of("expectedVersion", 0, "reason", "客户取消"));
            assertEquals(200, cancelled.status);
            long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, cancelledId);
            assertEquals(403, front.request("POST", "/api/orders/" + cancelledId + "/restart", Map.of("expectedVersion", 1)).status);
            assertEquals(cancelled.body.path("data"), query(front, "/api/orders/" + cancelledId));
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, cancelledId));
        }
    }

    @Test void orderQuotesPaymentMethodsPersistAtomicallyAndDriveReceiptTotals() throws Exception {
        var staff = staff();
        var input = new LinkedHashMap<String, Object>(cakeOrder());
        input.put("originalAmountCents", 15800); input.put("memberAmountCents", 12800); input.put("totalAmountCents", 12800); input.put("paymentMethod", "CASH");
        String key = UUID.randomUUID().toString();
        var created = staff.request("POST", "/api/orders", input, key); assertEquals(201, created.status, created.body.toString());
        var first = created.body.path("data"); String id = first.path("orderId").asText();
        assertEquals(15800, first.path("originalAmountCents").asLong()); assertEquals(12800, first.path("memberAmountCents").asLong());
        assertEquals(12800, first.path("totalAmountCents").asLong()); assertEquals("PAID", first.path("paymentStatus").asText());
        assertEquals("CASH", first.path("paymentMethod").asText()); assertEquals(0, first.path("version").asLong());
        String paidAt = first.path("paidAt").asText(); assertFalse(first.path("paidAt").isNull());
        assertEquals(first, staff.request("POST", "/api/orders", input, key).body.path("data"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
        var stored = jdbc.queryForMap("SELECT original_amount_cents,member_amount_cents,total_amount_cents,payment_method FROM cake_order WHERE id=?::uuid", id);
        assertEquals(15800L, stored.get("original_amount_cents")); assertEquals(12800L, stored.get("member_amount_cents")); assertEquals("CASH", stored.get("payment_method"));
        var method = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID", "paymentMethod", "BANK_TRANSFER"));
        assertEquals(200, method.status); assertEquals(paidAt, method.body.at("/data/paidAt").asText());
        assertEquals("BANK_TRANSFER", query(staff, "/api/orders/" + id).path("paymentMethod").asText());
        var same = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "PAID", "paymentMethod", "BANK_TRANSFER"));
        assertEquals(1, same.body.at("/data/version").asLong());
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "UNPAID", "paymentMethod", "UNPAID")).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "UNPAID", "paymentMethod", "CASH")).status);
        var original = staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", Map.of("originalAmountCents", 18000)));
        assertEquals(200, original.status); assertEquals(12800, original.body.at("/data/totalAmountCents").asLong()); assertEquals(paidAt, original.body.at("/data/paidAt").asText());
        var clearMember = new HashMap<String, Object>(); clearMember.put("memberAmountCents", null);
        String information = "/api/orders/" + id + "/information";
        String payment = "/api/orders/" + id + "/payment-status";
        var locked = staff.request("PATCH", information, Map.of("expectedVersion", 2, "changes", clearMember));
        assertEquals(409, locked.status);
        assertEquals("ORDER_PAID_AMOUNT_LOCKED", locked.body.path("code").asText());
        String date = Instant.parse(paidAt).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().toString();
        assertEquals("12800", query(staff, "/api/orders/workbench/receipt-summary?date=" + date).path("amountCents").asText());
        assertEquals(200, staff.request("PATCH", payment, Map.of("expectedVersion", 2, "paymentStatus", "UNPAID", "paymentMethod", "UNPAID")).status);
        assertTrue(query(staff, "/api/orders/" + id).path("paidAt").isNull());
        assertEquals(0, query(staff, "/api/orders/workbench/receipt-summary?date=" + date).path("orderCount").asInt());
        var quote = staff.request("PATCH", information, Map.of("expectedVersion", 3, "changes", clearMember));
        assertEquals(200, quote.status);
        assertEquals(18000, quote.body.at("/data/totalAmountCents").asLong());
        var zero = staff.request("PATCH", information, Map.of("expectedVersion", 4, "changes", Map.of("memberAmountCents", 0)));
        assertEquals(200, zero.status); assertEquals(0, zero.body.at("/data/totalAmountCents").asLong());
        var recorded = staff.request("PATCH", payment, Map.of("expectedVersion", 5, "paymentStatus", "PAID", "paymentMethod", "CASH"));
        assertEquals(200, recorded.status);
        String newDate = Instant.parse(recorded.body.at("/data/paidAt").asText()).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().toString();
        var receipt = query(staff, "/api/orders/workbench/receipt-summary?date=" + newDate);
        assertEquals(1, receipt.path("orderCount").asInt());
        assertEquals("0", receipt.path("amountCents").asText());
        var bad = new LinkedHashMap<>(input); bad.put("totalAmountCents", 15800);
        assertEquals(400, staff.request("POST", "/api/orders", bad).status);
        bad.put("totalAmountCents", 12800); bad.put("paymentMethod", "OTHER"); assertEquals(400, staff.request("POST", "/api/orders", bad).status);
        doReturn(EmployeeAccess.of(Set.of(EmployeeAccess.Permission.ORDER_CREATE, EmployeeAccess.Permission.ORDER_CUSTOMER_READ, EmployeeAccess.Permission.ORDER_AMOUNT_READ))).when(employeeAccess).access(any());
        assertEquals(403, staff.request("POST", "/api/orders", input).status);
        reset(employeeAccess);
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type='CREATED'", Integer.class, id));
    }

    @Test void itemPositionsPreserveCreationOrderAndAppendAfterRemovedItems() throws Exception {
        var staff = staff();
        String first = "00000000-0000-0000-0000-000000000003";
        String middle = "00000000-0000-0000-0000-000000000002";
        String last = "00000000-0000-0000-0000-000000000001";
        var input = new LinkedHashMap<String, Object>(create());
        input.put("items", List.of(
                Map.of("name", "第一件", "quantity", 1, "itemId", first),
                Map.of("name", "第二件", "quantity", 1, "itemId", middle),
                Map.of("name", "第三件", "quantity", 1, "itemId", last)));
        var created = staff.request("POST", "/api/orders", input);
        assertEquals(201, created.status, created.body.toString());
        var order = created.body.path("data");
        String path = "/api/orders/" + order.path("orderId").asText();
        assertEquals(List.of(first, middle, last), query(staff, path).path("items").valueStream().map(i -> i.path("itemId").asText()).toList());
        assertEquals("第一件", query(staff, "/api/orders/calendar?from=2026-10-16&to=2026-10-17").at("/0/items/0/name").asText());

        assertEquals(200, staff.request("POST", path + "/items/" + middle + "/remove", Map.of("expectedVersion", 0)).status);
        var added = staff.request("POST", path + "/items", Map.of("expectedVersion", 1, "item", Map.of("name", "追加", "quantity", 1)));
        assertEquals(201, added.status, added.body.toString());
        var latest = query(staff, path);
        assertEquals(List.of("第一件", "第三件", "追加"), latest.path("items").valueStream().map(i -> i.path("name").asText()).toList());
        assertEquals(List.of(1, 2, 3, 4), jdbc.queryForList(
                "SELECT position FROM cake_order_item WHERE order_id=?::uuid ORDER BY position", Integer.class, order.path("orderId").asText()));

        String appended = latest.at("/items/2/itemId").asText();
        assertEquals(200, staff.request("POST", path + "/items/" + appended + "/remove", Map.of("expectedVersion", 2)).status);
        var next = staff.request("POST", path + "/items", Map.of("expectedVersion", 3, "item", Map.of("name", "再次追加", "quantity", 1)));
        assertEquals(201, next.status, next.body.toString());
        assertEquals(5, jdbc.queryForObject("SELECT position FROM cake_order_item WHERE id=?::uuid", Integer.class, next.body.at("/data/items/2/itemId").asText()));
    }

    @Test void itemPositionMigrationPreservesLegacyOrderAndData() throws Exception {
        String schema = "position_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = Objects.requireNonNull(jdbc.getDataSource()).getConnection()) {
            var source = new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection, true);
            var flyway = org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration");
            flyway.target("31").load().migrate(); connection.setSchema(schema);
            var legacy = new JdbcTemplate(source);
            var order = UUID.randomUUID();
            legacy.update("""
                    INSERT INTO cake_order(id,order_no,status,customer_phone,fulfillment_type,requested_receive_date,
                        created_by,created_at,confirmed_at,updated_at,total_amount_cents)
                    VALUES (?,'OLD-POSITION','CAKE_BASE','13800000000','PICKUP','2026-11-14',?,now(),now(),now(),777)
                    """, order, UUID.randomUUID());
            legacy.update("""
                    INSERT INTO cake_order_item(id,order_id,name,product_type,quantity,is_removed,created_at,updated_at)
                    VALUES ('00000000-0000-0000-0000-000000000003',?,'最早','OTHER',1,false,'2026-11-01T00:00:00Z',now()),
                           ('00000000-0000-0000-0000-000000000002',?,'同刻后','OTHER',2,true,'2026-11-02T00:00:00Z',now()),
                           ('00000000-0000-0000-0000-000000000001',?,'同刻前','OTHER',3,false,'2026-11-02T00:00:00Z',now())
                    """, order, order, order);
            var beforeOrder = legacy.queryForMap("SELECT * FROM cake_order");
            var beforeItems = legacy.queryForList("SELECT to_jsonb(i)::text AS item FROM cake_order_item i ORDER BY created_at,id");
            flyway.target("32").load().migrate(); connection.setSchema(schema);
            assertEquals(beforeOrder, legacy.queryForMap("SELECT * FROM cake_order"));
            assertEquals(beforeItems, legacy.queryForList("""
                    SELECT (to_jsonb(i)-'position')::text AS item FROM cake_order_item i ORDER BY position NULLS LAST,created_at,id
                    """));
            assertEquals(List.of(1, 2, 3), legacy.queryForList("SELECT position FROM cake_order_item ORDER BY position", Integer.class));
        } finally { jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); }
    }

    @Test void itemPricingMigrationLeavesHistoricalAmountsAndItemsUntouched() throws Exception {
        String schema = "pricing_migration_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = Objects.requireNonNull(jdbc.getDataSource()).getConnection()) {
            var source = new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection, true);
            var flyway = org.flywaydb.core.Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration");
            flyway.target("30").load().migrate(); connection.setSchema(schema);
            var legacy = new JdbcTemplate(source); var id = UUID.randomUUID();
            legacy.update("""
                    INSERT INTO cake_order(id,order_no,status,customer_phone,fulfillment_type,requested_receive_date,
                        created_by,created_at,confirmed_at,updated_at,total_amount_cents,original_amount_cents,member_amount_cents,payment_status)
                    VALUES (?,'OLD-PRICE','CAKE_BASE','13800000000','PICKUP','2026-11-14',?,now(),now(),now(),777,999,777,'UNPAID')
                    """, id, UUID.randomUUID());
            legacy.update("""
                    INSERT INTO cake_order_item(id,order_id,name,product_type,quantity,unit_price_cents,production_status,created_at,updated_at)
                    VALUES (?,?,'历史商品','OTHER',3,111,'NOT_STARTED',now(),now())
                    """, UUID.randomUUID(), id);
            var before = legacy.queryForList("SELECT * FROM cake_order_item");
            flyway.target("31").load().migrate(); connection.setSchema(schema);
            assertEquals("MANUAL", legacy.queryForObject("SELECT pricing_mode FROM cake_order", String.class));
            assertEquals(777L, legacy.queryForObject("SELECT total_amount_cents FROM cake_order", Long.class));
            assertEquals(999L, legacy.queryForObject("SELECT original_amount_cents FROM cake_order", Long.class));
            assertEquals(before, legacy.queryForList("SELECT * FROM cake_order_item"));
        } finally { jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); }
    }

    @Test void itemSumPricingPersistsRecalculatesAndRejectsPaidOrConflictingMutationsAtomically() throws Exception {
        var staff = staff(); var input = new LinkedHashMap<String, Object>(cakeOrder());
        input.put("pricingMode", "ITEM_SUM"); input.put("paymentMethod", "UNPAID");
        var created = staff.request("POST", "/api/orders", input);
        assertEquals(201, created.status, created.body.toString());
        var order = created.body.path("data"); String id = order.path("orderId").asText();
        String cakeId = idForName(order, "蛋糕");
        assertEquals("ITEM_SUM", order.path("pricingMode").asText());
        assertEquals(16000, order.path("originalAmountCents").asLong()); assertEquals(14000, order.path("totalAmountCents").asLong());
        assertEquals(order, query(staff, "/api/orders/" + id));
        assertEquals("ITEM_SUM", jdbc.queryForObject("SELECT pricing_mode FROM cake_order WHERE id=?::uuid", String.class, id));
        var revised = staff.request("PATCH", "/api/orders/" + id, patch(cakeId, 0, Map.of("quantity", 2)));
        assertEquals(200, revised.status, revised.body.toString());
        assertEquals(22000, query(staff, "/api/orders/" + id).path("totalAmountCents").asLong());
        assertEquals("22000", query(staff, "/api/orders/workbench/payment-summary?date=2026-10-16").at("/unpaid/amountCents").asText());
        assertEquals(id, query(staff, "/api/orders/calendar?from=2026-10-16&to=2026-10-17").at("/0/orderId").asText());
        assertEquals("22000", query(staff, "/api/orders/workbench/payment-orders?date=2026-10-16&kind=SHIPPING_UNPAID").at("/orders/0/amountCents").asText());
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id, patch(cakeId, 0, Map.of("quantity", 3))).status);
        assertEquals(400, staff.request("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", Map.of("totalAmountCents", 1))).status);
        var paid = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "PAID", "paymentMethod", "CASH"));
        assertEquals(200, paid.status, paid.body.toString());
        String paidDate = Instant.parse(paid.body.at("/data/paidAt").asText()).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().toString();
        assertEquals("22000", query(staff, "/api/orders/workbench/receipt-summary?date=" + paidDate).path("amountCents").asText());
        var before = query(staff, "/api/orders/" + id);
        long activityCount = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        var rejected = staff.request("PATCH", "/api/orders/" + id, patch(cakeId, 2, Map.of("quantity", 3)));
        assertEquals(409, rejected.status); assertEquals("ORDER_PAID_AMOUNT_LOCKED", rejected.body.path("code").asText());
        assertEquals(before, query(staff, "/api/orders/" + id));
        assertEquals(activityCount, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
        assertEquals(200, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 2, "paymentStatus", "UNPAID", "paymentMethod", "UNPAID")).status);
        var missing = Map.of("name", "待报价点心", "productType", "OTHER", "quantity", 1, "attributes", Map.of("specification", "少糖"));
        var added = staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 3, "item", missing));
        assertEquals(201, added.status, added.body.toString());
        assertTrue(query(staff, "/api/orders/" + id).path("totalAmountCents").isNull());
        assertEquals(409, staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 4, "paymentStatus", "PAID", "paymentMethod", "CASH")).status);
        String missingId = idForName(added.body.path("data"), "待报价点心");
        doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> "ITEM_REMOVED".equals(activity.type())));
        assertEquals(503, staff.request("POST", "/api/orders/" + id + "/items/" + missingId + "/remove", Map.of("expectedVersion", 4)).status);
        reset(activities);
        assertEquals(3, query(staff, "/api/orders/" + id).path("items").size());
        assertTrue(query(staff, "/api/orders/" + id).path("totalAmountCents").isNull());
        var removed = staff.request("POST", "/api/orders/" + id + "/items/" + missingId + "/remove", Map.of("expectedVersion", 4));
        assertEquals(200, removed.status, removed.body.toString());
        assertEquals(22000, query(staff, "/api/orders/" + id).path("totalAmountCents").asLong());
        var legacyInput = new LinkedHashMap<String, Object>(cakeOrder()); legacyInput.put("totalAmountCents", 777);
        var legacy = staff.request("POST", "/api/orders", legacyInput).body.path("data");
        assertEquals("MANUAL", legacy.path("pricingMode").asText()); assertEquals(777, legacy.path("totalAmountCents").asLong());
        String legacyId = legacy.path("orderId").asText();
        assertEquals(200, staff.request("PATCH", "/api/orders/" + legacyId, patch(idForName(legacy, "蛋糕"), 0, Map.of("quantity", 2))).status);
        assertEquals(777, query(staff, "/api/orders/" + legacyId).path("totalAmountCents").asLong());
    }

    private Client staff() throws Exception {
        identity.initializeAdministrator("0001", "店长", INITIAL);
        var admin = new Client(); admin.login("0001", INITIAL); admin.changePassword(INITIAL); admin.login("0001", PASSWORD);
        var provisioned = admin.request("POST", "/api/admin/employees", Map.of("employeeNumber", "0002", "nickname", "前台员工", "jobRoles", List.of("FRONT_DESK", "DECORATOR"), "systemRole", "STAFF"));
        assertEquals(201, provisioned.status, provisioned.body.toString());
        var staff = new Client(); staff.accountId = provisioned.body.at("/data/account/accountId").asText();
        String temporary = provisioned.body.at("/data/temporaryPassword").asText();
        staff.login("0002", temporary);
        assertEquals(403, staff.request("POST", "/api/orders", create()).status);
        staff.changePassword(temporary); staff.login("0002", PASSWORD); return staff;
    }
    @Test void adjacentRollbackPersistsAllNodesAndPreservesPaidDataAndItemChecks() throws Exception {
        var staff = staff();
        for (var type : List.of("DELIVERY", "PICKUP")) {
            var original = createCakeOn(staff, "2026-10-23", "13:00", type); String id = original.path("orderId").asText();
            production(staff, id, 0, "COMPLETE_BASE");
            var ready = finishProduction(staff, id, 1);
            var paid = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", ready.path("version").asLong(), "paymentStatus", "PAID")).body.path("data");
            long version = paid.path("version").asLong();
            var completed = fulfillment(staff, id, version, type.equals("DELIVERY") ? "COMPLETE_DELIVERY" : "CONFIRM_PICKUP");
            version = completed.path("version").asLong();
            try (var stream = staff.stream()) {
                var historical = query(staff, "/api/orders/" + id);
                doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> "ROLLBACK_FULFILLMENT".equals(activity.details().get("action"))));
                assertEquals(503, staff.request("POST", "/api/orders/" + id + "/fulfillment-actions", action(version, "ROLLBACK_FULFILLMENT")).status);
                reset(activities); stream.noChange(); assertEquals(historical, query(staff, "/api/orders/" + id));
                var back = fulfillment(staff, id, version++, "ROLLBACK_FULFILLMENT");
                stream.changed(id, null, "ORDER_FULFILLMENT_CHANGED", version);
                assertEquals("WAITING_DELIVERY", back.path("status").asText());
                back = production(staff, id, version++, "REOPEN_PRODUCTION"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", version);
                assertEquals("DECORATING", back.path("status").asText()); assertEquals(completed.path("items"), back.path("items"));
                var beforeFailure = back;
                doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> "ROLLBACK_PRODUCTION".equals(activity.details().get("action"))));
                assertEquals(503, staff.request("POST", "/api/orders/" + id + "/production-actions", action(version, "ROLLBACK_PRODUCTION")).status);
                reset(activities); stream.noChange(); assertEquals(beforeFailure, query(staff, "/api/orders/" + id));
                for (var stage : List.of("FROSTING", "LAYER")) {
                    back = production(staff, id, version++, "ROLLBACK_PRODUCTION"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", version);
                    assertEquals(stage, back.path("status").asText());
                    assertEquals(completed.path("items"), back.path("items"));
                }
                back = production(staff, id, version++, "ROLLBACK_PRODUCTION"); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", version);
                assertEquals("CAKE_BASE", back.path("status").asText()); assertTrue(back.path("currentStageCode").isNull());
                for (var item : back.path("items")) assertEquals("NOT_STARTED", item.path("productionStatus").asText());
                assertEquals(paid.path("paymentStatus"), back.path("paymentStatus")); assertEquals(paid.path("paidAt"), back.path("paidAt"));
                assertEquals(original.path("customer"), back.path("customer")); assertEquals(original.path("fulfillment"), back.path("fulfillment"));
                assertEquals(original.path("totalAmountCents"), back.path("totalAmountCents"));
                assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(version - 1, "ROLLBACK_PRODUCTION")).status);
                stream.noChange();
                assertEquals(back, query(staff, "/api/orders/" + id));
                assertEquals("CAKE_BASE", jdbc.queryForObject("SELECT status FROM cake_order WHERE id=?::uuid", String.class, id));
            }
        }
    }
    @Test void cancelledRestartRequiresBothPermissionsIsAtomicAndPreservesHistoryAndPayment() throws Exception {
        var staff = staff(); var original = staff.request("POST", "/api/orders", cakeOrder()).body.path("data"); String id = original.path("orderId").asText();
        production(staff, id, 0, "COMPLETE_BASE"); var ready = finishProduction(staff, id, 1);
        long version = ready.path("version").asLong();
        var paid = staff.request("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", version++, "paymentStatus", "PAID")).body.path("data");
        assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "恢复后仍须保留")).status);
        var cancelled = staff.request("POST", "/api/orders/" + id + "/cancel", Map.of("expectedVersion", version++, "reason", "客户取消")).body.path("data");
        final long expected = version;
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id);
        try (var stream = staff.stream()) {
            for (var permission : List.of(EmployeeAccess.Permission.ORDER_CANCEL, EmployeeAccess.Permission.ORDER_PRODUCTION_UPDATE)) {
                doReturn(EmployeeAccess.of(Set.of(permission))).when(employeeAccess).access(any());
                assertEquals(403, staff.request("POST", "/api/orders/" + id + "/restart", Map.of("expectedVersion", expected)).status);
            }
            reset(employeeAccess);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/production-actions", action(expected, "ROLLBACK_PRODUCTION")).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/production-actions", action(expected, "RESTART_CANCELLED")).status);
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/restart", Map.of("expectedVersion", expected - 1)).status);
            assertEquals(400, staff.request("POST", "/api/orders/" + id + "/restart", Map.of("expectedVersion", 0.5)).status);
            doThrow(new DataAccessResourceFailureException("activity unavailable")).when(activities).append(argThat(activity -> "RESTART_CANCELLED".equals(activity.details().get("action"))));
            assertEquals(503, staff.request("POST", "/api/orders/" + id + "/restart", Map.of("expectedVersion", expected)).status);
            reset(activities); stream.noChange(); assertEquals(cancelled, query(staff, "/api/orders/" + id));
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                orderService.restartCancelled(UUID.fromString(id), new OrderCommands.Restart(expected), new OrderCommands.Operator(UUID.fromString(staff.accountId), "前台员工"));
                status.setRollbackOnly();
            });
            stream.noChange(); assertEquals(cancelled, query(staff, "/api/orders/" + id));
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            var restarted = staff.request("POST", "/api/orders/" + id + "/restart", Map.of("expectedVersion", expected));
            assertEquals(200, restarted.status, restarted.body.toString()); stream.changed(id, null, "ORDER_PRODUCTION_CHANGED", expected + 1);
            var data = restarted.body.path("data"); assertEquals("CAKE_BASE", data.path("status").asText()); assertTrue(data.path("currentStageCode").isNull());
            assertEquals(original.path("orderNo"), data.path("orderNo")); assertEquals(original.path("customer"), data.path("customer"));
            assertEquals(original.path("fulfillment"), data.path("fulfillment")); assertEquals(paid.path("paidAt"), data.path("paidAt")); assertEquals("PAID", data.path("paymentStatus").asText());
            for (var item : data.path("items")) assertEquals("NOT_STARTED", item.path("productionStatus").asText());
            assertEquals(count + 1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Long.class, id));
            assertEquals(1, query(staff, "/api/orders/" + id + "/activities?type=NOTE").path("total").asInt());
            assertEquals(1, query(staff, "/api/orders/" + id + "/activities?type=ORDER_CANCELLED").path("total").asInt());
            assertEquals("RESTART_CANCELLED", query(staff, "/api/orders/" + id + "/activities?type=ORDER_PRODUCTION_CHANGED").at("/items/0/details/action").asText());
            assertEquals(409, staff.request("POST", "/api/orders/" + id + "/restart", Map.of("expectedVersion", expected)).status);
            stream.noChange();
        }
    }
    private static Map<String, Object> cakeOrder() {
        var input = new LinkedHashMap<String, Object>(create());
        input.put("items", List.of(
                Map.of("name", "蛋糕", "productType", "CAKE", "quantity", 1, "unitPriceCents", 10000, "memberPriceCents", 8000,
                        "attributes", Map.of("size", "8", "flavors", List.of("芒果"), "greeting", "生日快乐")),
                Map.of("name", "纸杯造型蛋糕", "productType", "CAKE", "quantity", 6, "unitPriceCents", 1000, "attributes", Map.of("flavor", "香草"))));
        return input;
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
    record Result(int status, JsonNode body, HttpHeaders headers) { }
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
        Result request(String method, String path, Object body) throws Exception { return request(method, path, body, null); }
        Result request(String method, String path, Object body, String idempotencyKey) throws Exception {
            boolean auth = path.startsWith("/api/auth/");
            if (auth && !method.equals("GET")) request("GET", "/api/auth/csrf", null);
            var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json");
            if (idempotencyKey != null) builder.header("Idempotency-Key", idempotencyKey);
            if (method.equals("POST") && path.equals("/api/order-packages")) builder.header("Idempotency-Key", UUID.randomUUID().toString());
            if (token != null && !auth) builder.header("Authorization", "Bearer " + token);
            if (auth && !method.equals("GET")) cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                    .findFirst().ifPresent(cookie -> builder.header("X-XSRF-TOKEN", cookie.getValue()));
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            return new Result(response.statusCode(), response.body().isBlank() ? json.nullNode() : json.readTree(response.body()), response.headers());
        }
    }
}

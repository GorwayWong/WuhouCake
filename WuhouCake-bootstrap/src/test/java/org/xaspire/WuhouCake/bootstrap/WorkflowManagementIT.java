package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import java.io.ByteArrayInputStream;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
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
class WorkflowManagementIT {
    private static final String SCHEMA = "workflow_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:workflow-it:" + UUID.randomUUID();
    private static final String INITIAL = "Initial workflow test password!", PASSWORD = "Permanent workflow test password!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        JwtTestKeys.properties(r); r.add("spring.flyway.default-schema", () -> SCHEMA); r.add("spring.flyway.schemas", () -> SCHEMA);
        r.add("spring.datasource.hikari.schema", () -> SCHEMA); r.add("wuhoucake.identity.redis-namespace", () -> NAMESPACE);
    }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired IdentityService identity;
    @MockitoSpyBean org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries management;
    @MockitoSpyBean Operations operations;
    @MockitoSpyBean org.xaspire.WuhouCake.order.domain.repository.OrderActivities orderActivities;
    @MockitoSpyBean org.xaspire.WuhouCake.order.domain.port.OrderCreations creations;
    Browser admin, a, b;
    @BeforeEach void setup() throws Exception {
        reset(operations, orderActivities, management, creations);
        jdbc.execute("TRUNCATE cake_order_activity,cake_order_item,cake_order,audit_operation,identity_account_role,identity_account CASCADE"); clearRedis();
        identity.initializeAdministrator("ADMIN", "店主", INITIAL);
        admin = new Browser(); admin.login("ADMIN", INITIAL); admin.changePassword(INITIAL); admin.login("ADMIN", PASSWORD);
        a = employee("A001", "前台 A"); b = employee("B001", "师傅 B");
    }
    @AfterAll void cleanup() { reset(operations, orderActivities, management, creations); clearRedis(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE"); }
    private void clearRedis() { var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys); }
    @Test void mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        assertEquals(a.id, order.path("createdBy").asText()); assertEquals(b.id, order.at("/creditedEmployee/accountId").asText());
        var cancelled = a.data("POST", "/api/orders", create(b.id));
        a.data("POST", "/api/orders/" + cancelled.path("orderId").asText() + "/cancel", Map.of("expectedVersion", 0, "reason", "合成取消"));
        assertEquals(1, management.totals(new org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.Filter(java.time.LocalDate.of(2026,10,1), java.time.LocalDate.of(2026,11,1), null,null,null,null,null,false,false,null,null)).orderCount());
        var all = admin.data("GET", search(""), null);
        assertEquals(1, all.at("/totals/orderCount").asLong()); assertEquals(9, all.at("/totals/matchingQuantity").asLong()); assertEquals(3, all.at("/totals/cakeQuantity").asLong());
        assertEquals(2, all.path("sizes").size()); assertEquals("8", all.at("/sizes/0/size").asText());
        assertEquals(2, all.at("/sizes/0/cakeQuantity").asInt()); assertEquals(1, all.at("/sizes/0/orderCount").asInt());
        assertEquals("10", all.at("/sizes/1/size").asText()); assertEquals(1, all.at("/sizes/1/cakeQuantity").asInt());
        assertEquals(1, all.path("employees").size()); assertEquals("52000", all.at("/employees/0/totalAmountCents").asText());
        var filtered = admin.data("GET", search("&sizeInches=8.00&creditedEmployeeId=" + b.id), null);
        assertEquals(1, filtered.at("/totals/orderCount").asInt()); assertEquals(2, filtered.at("/totals/matchingQuantity").asInt()); assertEquals(2, filtered.at("/totals/cakeQuantity").asInt());
        assertEquals(id, filtered.at("/items/0/orderId").asText());
        long before = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        var response = admin.raw("GET", search("&sizeInches=8.00&creditedEmployeeId=" + b.id).replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, response.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
            assertEquals(2, book.getSheet("订单明细").getPhysicalNumberOfRows());
            assertEquals(order.path("orderNo").asText(), book.getSheet("订单明细").getRow(1).getCell(0).getStringCellValue());
            assertEquals(2d, book.getSheet("订单明细").getRow(1).getCell(10).getNumericCellValue());
            assertEquals("B001", book.getSheet("订单明细").getRow(1).getCell(6).getStringCellValue());
            assertEquals(5, book.getNumberOfSheets()); assertEquals(2, book.getSheet("尺寸统计").getPhysicalNumberOfRows());
            assertEquals("8", book.getSheet("尺寸统计").getRow(1).getCell(0).getStringCellValue());
            assertEquals(2, book.getSheet("商品明细").getPhysicalNumberOfRows());
            assertEquals("原味", book.getSheet("商品明细").getRow(1).getCell(6).getStringCellValue());
            assertEquals("芒果", book.getSheet("商品明细").getRow(1).getCell(7).getStringCellValue());
            assertEquals("2026-10-31", book.getSheet("统计").getRow(2).getCell(1).getStringCellValue());
        }
        assertEquals(before, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        assertEquals(2, admin.data("GET", search("&includeCancelled=true"), null).at("/totals/orderCount").asInt());
        assertEquals(1, admin.data("GET", search("&status=CANCELLED"), null).at("/totals/orderCount").asInt());
    }
    @Test void abnormalHistoricalSizesRemainReadableAndCannotBreakFiltering() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id)); String item = null;
        for (var product : order.path("items")) if (product.path("name").asText().equals("八寸蛋糕")) item = product.path("itemId").asText();
        assertNotNull(item);
        for (String size : List.of("abc", "{\"tiers\":[8]}", "null", "\"8寸\"", "\"8.0\"", "\"8.001\"", "\"8.000000\"")) {
            String encoded = size.equals("abc") ? "\"abc\"" : size;
            jdbc.update("UPDATE cake_order_item SET attributes=jsonb_build_object('size',?::jsonb) WHERE id=?::uuid", encoded, item);
            var value = admin.data("GET", search("&sizeInches=8"), null);
            assertEquals(size.equals("\"8寸\"") || size.equals("\"8.0\"") || size.equals("\"8.000000\"") ? 2 : 0, value.at("/totals/cakeQuantity").asInt());
            var detail = a.data("GET", "/api/orders/" + order.path("orderId").asText(), null);
            for (var product : detail.path("items")) if (product.path("itemId").asText().equals(item)) assertEquals("原味", product.at("/attributes/base").asText());
        }
        for (String size : List.of("abc", "8寸", "0", "-1", "8.001")) {
            var body = new LinkedHashMap<>(create(b.id)); body.put("items", List.of(Map.of("name", "无效尺寸", "quantity", 1, "attributes", Map.of("size", size))));
            assertEquals(400, a.raw("POST", "/api/orders", body).statusCode());
        }
        assertEquals(1, admin.data("GET", search(""), null).at("/totals/orderCount").asInt());
    }
    @Test void ownershipChangesRecordRealActorAndArchivedEmployeeKeepsHistoricalAttribution() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        b.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("creditedEmployeeId", a.id)));
        var activity = a.data("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).at("/items/0");
        assertEquals(b.id, activity.path("actorId").asText()); assertEquals(b.id, activity.at("/details/before/creditedEmployeeId").asText()); assertEquals(a.id, activity.at("/details/after/creditedEmployeeId").asText());
        var historical = a.data("POST", "/api/orders", create(b.id));
        admin.data("POST", "/api/admin/employees/" + b.id + "/archive", null);
        assertEquals("师傅 B", a.data("GET", "/api/orders/" + historical.path("orderId").asText(), null).at("/creditedEmployee/nickname").asText());
        assertEquals(1, admin.data("GET", search("&creditedEmployeeId=" + b.id), null).at("/totals/orderCount").asInt());
        assertEquals(409, a.raw("POST", "/api/orders", create(b.id)).statusCode());
        assertFalse(a.data("GET", "/api/employees/options", null).toString().contains(b.id));
        assertTrue(a.data("GET", "/api/employees/options?includeArchived=true", null).toString().contains(b.id));
        assertEquals(admin.data("GET", search(""), null), a.data("GET", search(""), null));
        assertEquals(200, a.raw("GET", search("").replace("/api/admin/orders?", "/api/admin/orders/export?"), null).statusCode());
        assertEquals(403, a.raw("PATCH", "/api/admin/employees/" + a.id, Map.of("expectedVersion", 1, "nickname", "越权", "jobRoles", List.of("MANAGER"))).statusCode());
    }
    @Test void employeeChangesHaveBeforeAfterAndRollbackIfTheAuditFails() throws Exception {
        var before = admin.data("GET", "/api/admin/employees?employeeNumber=B001", null).at("/items/0");
        var updated = admin.data("PATCH", "/api/admin/employees/" + b.id, Map.of("expectedVersion", before.path("version").asLong(), "nickname", "师傅新名", "jobRoles", List.of("PASTRY_CHEF", "FRONT_DESK")));
        assertEquals(2, updated.path("jobRoles").size());
        var audit = admin.data("GET", "/api/admin/audit-logs?action=identity.profile_changed", null).at("/items/0");
        assertEquals("师傅 B", audit.path("details").path("before.nickname").asText()); assertEquals("师傅新名", audit.path("details").path("after.nickname").asText());
        assertEquals(409, admin.raw("PATCH", "/api/admin/employees/" + b.id, Map.of("expectedVersion", before.path("version").asLong(), "nickname", "过期覆盖", "jobRoles", List.of("FRONT_DESK"))).statusCode());
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic audit unavailable")).when(operations).append(argThat(op -> op.action().equals("identity.profile_changed")));
        assertEquals(503, admin.raw("PATCH", "/api/admin/employees/" + b.id, Map.of("expectedVersion", updated.path("version").asLong(), "nickname", "应当回滚", "jobRoles", List.of("FRONT_DESK"))).statusCode());
        var after = admin.data("GET", "/api/admin/employees?employeeNumber=B001", null).at("/items/0"); assertEquals(updated, after);
    }
    @Test void malformedConditionsAndPagingAreSafeAndDailyOrdersIncludeTerminalStates() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id));
        a.data("POST", "/api/orders/" + order.path("orderId").asText() + "/cancel", Map.of("expectedVersion", 0, "reason", "合成"));
        assertEquals(1, a.data("GET", "/api/orders/workbench?date=2026-10-17", null).path("pendingOrders").size());
        for (String suffix : List.of("&sizeInches=abc", "&sizeInches=0", "&status=UNKNOWN", "&paymentStatus=no", "&creditedEmployeeId=bad", "&page=0", "&size=0", "&size=101", "&includeCancelled=bad"))
            assertEquals(400, admin.raw("GET", search(suffix), null).statusCode(), suffix);
        assertEquals(400, admin.raw("GET", "/api/admin/orders?from=2026-02-30&to=2026-11-01", null).statusCode());
        assertEquals(400, admin.raw("GET", "/api/admin/orders?from=2026-11-01&to=2026-10-01", null).statusCode());
        var empty = admin.data("GET", search("&keyword=%25"), null); assertEquals(0, empty.at("/totals/orderCount").asInt());
        var paged = admin.data("GET", search("&includeCancelled=true&page=2&size=1"), null); assertEquals(0, paged.path("items").size()); assertEquals(1, paged.at("/totals/orderCount").asInt());
    }
    @Test void managementExportHandlesMoreThanOneHundredOrdersAndLegacyUnassignedOrders() throws Exception {
        a.data("POST", "/api/orders", create(a.id));
        jdbc.update("WITH new_orders AS (INSERT INTO cake_order(id,order_no,version,status,payment_status,customer_phone,fulfillment_type,requested_receive_date,planned_handoff_at,created_by,created_at,confirmed_at,updated_at)"
                + " SELECT gen_random_uuid(),'legacy-'||n,0,'WAITING_PRODUCTION','UNPAID','13900000000','PICKUP',DATE '2026-10-17',now(),?::uuid,now(),now(),now() FROM generate_series(1,105)n RETURNING id)"
                + " INSERT INTO cake_order_item(id,order_id,name,product_type,quantity,attributes,production_status,is_removed,created_at,updated_at) SELECT gen_random_uuid(),id,'旧蛋糕','CAKE',1,'{}'::jsonb,'NOT_STARTED',false,now(),now() FROM new_orders", a.id);
        var data = admin.data("GET", search("&unassigned=true&size=100"), null); assertEquals(105, data.at("/totals/orderCount").asInt()); assertEquals(100, data.path("items").size());
        var result = admin.raw("GET", search("&unassigned=true").replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, result.statusCode()); try (var book = new XSSFWorkbook(new ByteArrayInputStream(result.body()))) { assertEquals(106, book.getSheet("订单明细").getPhysicalNumberOfRows()); }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ORDER_EXPORTED'", Integer.class));
    }
    @Test void employeeGroupsUseStableAccountsAndExposeUnknownAmountsWithoutDuplicatingMixedOrderMoney() throws Exception {
        var first = a.data("POST", "/api/orders", create(b.id));
        a.data("PATCH", "/api/orders/" + first.path("orderId").asText() + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID"));
        var profile = admin.data("GET", "/api/admin/employees?employeeNumber=B001", null).at("/items/0");
        admin.data("PATCH", "/api/admin/employees/" + b.id, Map.of("expectedVersion", profile.path("version").asLong(), "nickname", "新名字", "jobRoles", List.of("FRONT_DESK")));
        var withoutAmount = new LinkedHashMap<>(create(b.id)); withoutAmount.remove("totalAmountCents");
        a.data("POST", "/api/orders", withoutAmount);
        var data = admin.data("GET", search(""), null);
        assertEquals(1, data.path("employees").size()); assertEquals(b.id, data.at("/employees/0/employeeId").asText());
        assertEquals("新名字", data.at("/employees/0/employeeName").asText());
        assertEquals(2, data.at("/employees/0/orderCount").asInt()); assertEquals(18, data.at("/employees/0/matchingQuantity").asInt());
        assertEquals("52000", data.at("/employees/0/totalAmountCents").asText()); assertEquals("52000", data.at("/employees/0/paidAmountCents").asText());
        assertEquals("0", data.at("/employees/0/unpaidAmountCents").asText()); assertEquals(1, data.at("/employees/0/missingAmountOrders").asInt());
        assertEquals(1, data.at("/totals/missingAmountOrders").asInt());
    }
    @Test void createdDateUsesBeijingBoundariesAndKeepsAllReportSheetsOnTheSameFilter() throws Exception {
        var first = a.data("POST", "/api/orders", create(a.id));
        var second = a.data("POST", "/api/orders", create(b.id));
        jdbc.update("UPDATE cake_order SET created_at='2026-09-30T16:00:00Z' WHERE id=?::uuid", first.path("orderId").asText());
        jdbc.update("UPDATE cake_order SET created_at='2026-10-31T16:00:00Z' WHERE id=?::uuid", second.path("orderId").asText());
        var data = admin.data("GET", search("&dateBasis=CREATED"), null);
        assertEquals(1, data.at("/totals/orderCount").asInt()); assertEquals(first.path("orderId").asText(), data.at("/items/0/orderId").asText());
        assertEquals(a.id, data.at("/employees/0/employeeId").asText());
        assertEquals(2, admin.data("GET", search("&dateBasis=RECEIVE"), null).at("/totals/orderCount").asInt());
        assertEquals(400, admin.raw("GET", search("&dateBasis=invalid"), null).statusCode());
        var response = admin.raw("GET", search("&dateBasis=CREATED").replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, response.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
            assertEquals(2, book.getSheet("订单明细").getPhysicalNumberOfRows()); assertEquals(4, book.getSheet("商品明细").getPhysicalNumberOfRows());
            assertEquals("录单日期（北京时间）", book.getSheet("统计").getRow(0).getCell(1).getStringCellValue());
        }
    }
    @Test void concurrentCreationRetriesReuseOneOrderAndRejectDifferentPayloads() throws Exception {
        String key = UUID.randomUUID().toString(); var body = create(b.id);
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> a.raw("POST", "/api/orders", body, key));
            var second = executor.submit(() -> a.raw("POST", "/api/orders", body, key));
            var x = first.get(); var y = second.get(); assertEquals(201, x.statusCode()); assertEquals(201, y.statusCode());
            assertEquals(json.readTree(x.body()).at("/data/orderId"), json.readTree(y.body()).at("/data/orderId"));
        }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='CREATED'", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_creation WHERE order_id IS NOT NULL", Integer.class));
        var changed = new LinkedHashMap<>(body); changed.put("totalAmountCents", 53000);
        var conflict = a.raw("POST", "/api/orders", changed, key); assertEquals(409, conflict.statusCode());
        assertEquals("IDEMPOTENCY_KEY_CONFLICT", json.readTree(conflict.body()).path("code").asText());
        admin.data("POST", "/api/admin/employees/" + b.id + "/archive", null);
        assertEquals(201, a.raw("POST", "/api/orders", body, key).statusCode());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
        assertEquals(400, a.raw("POST", "/api/orders", body, "bad-key").statusCode());
    }
    @Test void failedCreationRollsBackItsReservationAndOtherEmployeesUseSeparateKeys() throws Exception {
        String key = UUID.randomUUID().toString(); var body = create(a.id);
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic activity unavailable")).when(orderActivities).append(any());
        assertEquals(503, a.raw("POST", "/api/orders", body, key).statusCode());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_creation", Integer.class));
        reset(orderActivities);
        assertEquals(201, a.raw("POST", "/api/orders", body, key).statusCode());
        assertEquals(201, b.raw("POST", "/api/orders", body, key).statusCode());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
    }
    @Test void employeeLifecycleAuditHasSafeSnapshotsAndFailuresRollbackTheBusinessChange() throws Exception {
        var created = admin.data("GET", "/api/admin/audit-logs?action=identity.account_created", null).path("items");
        assertEquals(2, created.size());
        var details = created.get(0).path("details");
        assertEquals("false", details.path("before.exists").asText()); assertEquals("ACTIVE", details.path("after.status").asText());
        assertFalse(details.toString().contains("passwordHash")); assertFalse(details.toString().contains(PASSWORD));
        var before = admin.data("GET", "/api/admin/employees?employeeNumber=B001", null).at("/items/0");
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic audit unavailable")).when(operations)
                .append(argThat(op -> Set.of("identity.account_created", "identity.account_archived", "identity.password_reset", "identity.password_set").contains(op.action())));
        assertEquals(503, admin.raw("POST", "/api/admin/employees/" + b.id + "/archive", null).statusCode());
        assertEquals(503, admin.raw("POST", "/api/admin/employees/" + b.id + "/reset-password", null).statusCode());
        assertEquals(503, admin.raw("PATCH", "/api/admin/employees/" + b.id + "/password", Map.of("expectedVersion", before.path("version").asLong(), "newPassword", "Staff008")).statusCode());
        assertEquals(503, admin.raw("POST", "/api/admin/employees", Map.of("employeeNumber", "C001", "nickname", "未提交", "jobRoles", List.of("FRONT_DESK"))).statusCode());
        assertEquals(before, admin.data("GET", "/api/admin/employees?employeeNumber=B001", null).at("/items/0"));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM identity_account WHERE employee_number='C001'", Integer.class));
        assertEquals(b.id, b.data("GET", "/api/me", null).path("accountId").asText());
        reset(operations);
        admin.data("POST", "/api/admin/employees/" + b.id + "/archive", null);
        var archived = admin.data("GET", "/api/admin/audit-logs?action=identity.account_archived", null).at("/items/0/details");
        assertEquals("ACTIVE", archived.path("before.status").asText()); assertEquals("ARCHIVED", archived.path("after.status").asText());
    }
    @Test void exportKeepsOneSnapshotWhileAnotherEmployeeChangesTheMatchingOrder() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        var totalsRead = new java.util.concurrent.CountDownLatch(1); var resumeExport = new java.util.concurrent.CountDownLatch(1);
        doAnswer(invocation -> {
            var result = invocation.callRealMethod(); totalsRead.countDown();
            if (!resumeExport.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("export did not resume");
            return result;
        }).when(management).totals(any());
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var export = executor.submit(() -> admin.raw("GET", search("&sizeInches=8&creditedEmployeeId=" + b.id + "&paymentStatus=UNPAID&fulfillmentType=PICKUP&keyword=" + order.path("orderNo").asText()).replace("/api/admin/orders?", "/api/admin/orders/export?"), null));
            try {
                assertTrue(totalsRead.await(10, java.util.concurrent.TimeUnit.SECONDS));
                String itemId = null; for (var item : order.path("items")) if (item.path("name").asText().equals("八寸蛋糕")) itemId = item.path("itemId").asText();
                assertNotNull(itemId);
                b.data("PATCH", "/api/orders/" + id, Map.of("expectedVersion", 0, "itemId", itemId, "changes", Map.of("quantity", 3)));
                b.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", Map.of("totalAmountCents", 60000)));
            } finally { resumeExport.countDown(); }
            var response = export.get(); assertEquals(200, response.statusCode());
            try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
                assertEquals("520.00", book.getSheet("订单明细").getRow(1).getCell(9).getStringCellValue());
                assertEquals(2d, book.getSheet("订单明细").getRow(1).getCell(10).getNumericCellValue());
                assertEquals(2d, book.getSheet("尺寸统计").getRow(1).getCell(2).getNumericCellValue());
                assertEquals("520.00", book.getSheet("员工业绩").getRow(1).getCell(5).getStringCellValue());
                assertEquals(2d, book.getSheet("商品明细").getRow(1).getCell(3).getNumericCellValue());
            }
        } finally { reset(management); }
        var latest = admin.data("GET", search("&sizeInches=8"), null);
        assertEquals("60000", latest.at("/totals/totalAmountCents").asText()); assertEquals(3, latest.at("/totals/matchingQuantity").asInt());
    }
    @Test void crossAttributedConcurrentCreationsDoNotDeadlock() throws Exception {
        var bothClaimed = new java.util.concurrent.CountDownLatch(2);
        doAnswer(invocation -> {
            var result = invocation.callRealMethod(); bothClaimed.countDown();
            if (!bothClaimed.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("other creation did not claim");
            return result;
        }).when(creations).claim(any(), any(), anyString());
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var x = executor.submit(() -> a.raw("POST", "/api/orders", create(b.id), UUID.randomUUID().toString()));
            var y = executor.submit(() -> b.raw("POST", "/api/orders", create(a.id), UUID.randomUUID().toString()));
            assertEquals(201, x.get().statusCode()); assertEquals(201, y.get().statusCode());
        }
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
    }
    private String search(String suffix) { return "/api/admin/orders?from=2026-10-01&to=2026-11-01" + suffix; }
    private Map<String, Object> create(String employee) {
        return Map.of("customer", Map.of("customerName", "合成客户", "phone", "13900000000"), "creditedEmployeeId", employee,
                "fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", "2026-10-17", "plannedHandoffAt", "2026-10-17T14:00:00+08:00"), "totalAmountCents", 52000,
                "items", List.of(Map.of("name", "八寸蛋糕", "productType", "CAKE", "quantity", 2, "attributes", Map.of("size", "8.00", "base", " ")),
                        Map.of("name", "十寸蛋糕", "productType", "CAKE", "quantity", 1, "attributes", Map.of("size", "10")), Map.of("name", "杯子蛋糕", "productType", "CUPCAKE", "quantity", 6)));
    }
    private Browser employee(String number, String name) throws Exception {
        var result = admin.data("POST", "/api/admin/employees", Map.of("employeeNumber", number, "nickname", name, "jobRoles", List.of("FRONT_DESK")));
        var browser = new Browser(); browser.id = result.at("/account/accountId").asText(); String temporary = result.path("temporaryPassword").asText();
        browser.login(number, temporary); browser.changePassword(temporary); browser.login(number, PASSWORD); return browser;
    }
    final class Browser {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
        String token, id;
        void login(String number, String password) throws Exception { token = data("POST", "/api/auth/login", Map.of("employeeNumber", number, "password", password)).path("accessToken").asText(); id = data("GET", "/api/me", null).path("accountId").asText(); }
        void changePassword(String password) throws Exception { data("POST", "/api/me/password", Map.of("currentPassword", password, "newPassword", PASSWORD)); }
        JsonNode data(String method, String path, Object body) throws Exception {
            var response = raw(method, path, body); assertTrue(response.statusCode() >= 200 && response.statusCode() < 300, method + " " + path + " status=" + response.statusCode() + " " + new String(response.body(), java.nio.charset.StandardCharsets.UTF_8));
            return json.readTree(response.body()).path("data");
        }
        HttpResponse<byte[]> raw(String method, String path, Object body) throws Exception {
            return raw(method, path, body, null);
        }
        HttpResponse<byte[]> raw(String method, String path, Object body, String idempotencyKey) throws Exception {
            boolean auth = path.startsWith("/api/auth/"); if (auth && !method.equals("GET")) raw("GET", "/api/auth/csrf", null);
            var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).header("Content-Type", "application/json");
            if (idempotencyKey != null) request.header("Idempotency-Key", idempotencyKey);
            if (!auth && token != null) request.header("Authorization", "Bearer " + token);
            if (auth && !method.equals("GET")) cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("XSRF-TOKEN")).findFirst().ifPresent(c -> request.header("X-XSRF-TOKEN", c.getValue()));
            request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            return client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        }
    }
}

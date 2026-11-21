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
        jdbc.execute("TRUNCATE cake_order_deletion_audit,cake_order_activity,cake_order_item,cake_order,audit_operation,identity_account_role,identity_account CASCADE"); clearRedis();
        identity.initializeAdministrator("ADMIN", "店主", INITIAL);
        admin = new Browser(); admin.login("ADMIN", INITIAL); admin.changePassword(INITIAL); admin.login("ADMIN", PASSWORD);
        a = employee("A001", "前台 A"); b = employee("B001", "师傅 B");
    }
    @AfterAll void cleanup() { reset(operations, orderActivities, management, creations); clearRedis(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE"); }
    private void clearRedis() { var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys); }
    @Test void managementReceiveFilterAndExportsUseHistoricalPickupDatesWithFallbacks() throws Exception {
        var created = a.data("POST", "/api/orders", create(a.id)); String id = created.path("orderId").asText();
        jdbc.update("UPDATE cake_order SET planned_handoff_at='2026-11-03T16:30:00Z' WHERE id=?::uuid", id);
        var oldRange = admin.data("GET", search(""), null); assertEquals(0, oldRange.at("/totals/orderCount").asInt());
        String range = "/api/admin/orders?from=2026-11-04&to=2026-11-05";
        var current = admin.data("GET", range, null);
        assertEquals(id, current.at("/items/0/orderId").asText()); assertEquals("2026-11-04", current.at("/items/0/receiveDate").asText());
        assertEquals(1, current.at("/totals/orderCount").asInt());
        var download = admin.raw("GET", range.replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, download.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(download.body()))) { assertEquals(2, book.getSheet("订单明细").getPhysicalNumberOfRows()); }
        assertEquals("2026-10-17", a.data("GET", "/api/orders/" + id, null).at("/fulfillment/requestedReceiveDate").asText());
        jdbc.update("UPDATE cake_order SET planned_handoff_at=NULL WHERE id=?::uuid", id);
        assertEquals(1, admin.data("GET", search(""), null).at("/totals/orderCount").asInt());
        jdbc.update("UPDATE cake_order SET requested_receive_at=NULL WHERE id=?::uuid", id);
        assertEquals(1, admin.data("GET", search(""), null).at("/totals/orderCount").asInt());
    }

    @Test void mixedProductsAreCountedByQuantityAndFilteredExportMatchesTheListWithoutLogs() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        assertEquals(a.id, order.path("createdBy").asText());
        assertEquals(a.id, order.at("/creditedEmployee/accountId").asText());
        a.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("creditedEmployeeId", b.id)));
        var cancelled = a.data("POST", "/api/orders", create(a.id));
        a.data("POST", "/api/orders/" + cancelled.path("orderId").asText() + "/cancel", Map.of("expectedVersion", 0, "reason", "合成取消"));
        assertEquals(1, management.totals(new org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.Filter(java.time.LocalDate.of(2026,10,1), java.time.LocalDate.of(2026,11,1), null,null,null,null,null,false,false,null,null)).orderCount());
        var all = admin.data("GET", search(""), null);
        assertEquals(Set.of("CAKE", "OTHER"), json.convertValue(all.at("/items/0/productTypes"), Set.class));
        assertEquals(1, all.at("/totals/orderCount").asLong()); assertEquals(9, all.at("/totals/matchingQuantity").asLong()); assertEquals(3, all.at("/totals/cakeQuantity").asLong());
        assertEquals(2, all.path("sizes").size());
        var counts = new HashMap<String, Integer>();
        all.path("sizes").forEach(group -> {
            assertEquals(1, group.path("orderCount").asInt());
            counts.put(group.path("size").asText(), group.path("cakeQuantity").asInt());
        });
        assertEquals(Map.of("8", 2, "10", 1), counts);
        assertEquals(1, all.path("employees").size()); assertEquals("52000", all.at("/employees/0/totalAmountCents").asText());
        var filtered = admin.data("GET", search("&sizeInches=8&creditedEmployeeId=" + b.id), null);
        assertEquals(1, filtered.at("/totals/orderCount").asInt()); assertEquals(2, filtered.at("/totals/matchingQuantity").asInt()); assertEquals(2, filtered.at("/totals/cakeQuantity").asInt());
        assertEquals(id, filtered.at("/items/0/orderId").asText());
        assertEquals(Set.of("CAKE", "OTHER"), json.convertValue(filtered.at("/items/0/productTypes"), Set.class));
        long before = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        var response = admin.raw("GET", search("&sizeInches=8&creditedEmployeeId=" + b.id).replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
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
    @Test void filteredReportPreservesLongProductSpecificationWithoutDuplicatingQuantity() throws Exception {
        var input = new LinkedHashMap<>(create(a.id));
        String specification = "茶".repeat(319) + "😀\n" + "备注".repeat(16400);
        input.put("items", List.of(Map.of("name", "合成长规格饮品", "productType", "OTHER", "quantity", 3,
                "attributes", Map.of("specification", specification), "referenceUnitPriceCents", 1230),
                Map.of("name", "不匹配商品", "productType", "OTHER", "quantity", 9, "attributes", Map.of())));
        var order = a.data("POST", "/api/orders", input);
        String suffix = "&productName=" + java.net.URLEncoder.encode("长规格饮品", java.nio.charset.StandardCharsets.UTF_8);
        var filtered = admin.data("GET", search(suffix), null);
        assertEquals(1, filtered.at("/totals/orderCount").asInt());
        assertEquals(3, filtered.at("/totals/matchingQuantity").asInt());
        var response = admin.raw("GET", search(suffix).replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, response.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
            var detail = book.getSheet("商品明细");
            var text = new StringBuilder(); double quantity = 0;
            for (var row : detail) {
                if (row.getRowNum() == 0) continue;
                assertEquals(order.path("orderNo").asText(), row.getCell(0).getStringCellValue());
                if (row.getCell(3).getCellType() == org.apache.poi.ss.usermodel.CellType.NUMERIC)
                    quantity += row.getCell(3).getNumericCellValue();
                text.append(row.getCell(10).getStringCellValue());
            }
            assertEquals(specification + "\n原商品单价：12.30 元（仅供参考）", text.toString());
            assertEquals(filtered.at("/totals/matchingQuantity").asDouble(), quantity);
            assertEquals(quantity, book.getSheet("订单明细").getRow(1).getCell(10).getNumericCellValue());
            assertEquals(quantity, book.getSheet("员工业绩").getRow(1).getCell(3).getNumericCellValue());
        }
    }

    @Test void orderingMethodFiltersEveryReportAndExportUsingTheSameExactValue() throws Exception {
        var names = List.of("下单人", "小程序", "到店", "客服号", "微信%_'\\");
        var created = new LinkedHashMap<String, JsonNode>();
        for (String method : names) {
            var input = new LinkedHashMap<>(create(a.id)); input.put("orderingMethod", " " + method + " ");
            created.put(method, a.data("POST", "/api/orders", input));
        }
        a.data("POST", "/api/orders", create(a.id));
        for (String method : names) {
            String suffix = "&orderingMethod=" + java.net.URLEncoder.encode(" " + method + " ", java.nio.charset.StandardCharsets.UTF_8);
            var report = admin.data("GET", search(suffix), null);
            assertEquals(1, report.at("/totals/orderCount").asInt()); assertEquals(created.get(method).path("orderId"), report.at("/items/0/orderId"));
            assertEquals(9, report.at("/totals/matchingQuantity").asInt()); assertEquals("52000", report.at("/totals/totalAmountCents").asText());
            assertEquals(2, report.path("sizes").size()); assertEquals(9, report.at("/employees/0/matchingQuantity").asInt());
            assertEquals(0, admin.data("GET", search(suffix + "&page=2&size=1"), null).path("items").size());
        }
        assertEquals(6, admin.data("GET", search(""), null).at("/totals/orderCount").asInt());
        assertEquals(6, admin.data("GET", search("&orderingMethod=%20%20"), null).at("/totals/orderCount").asInt());
        assertEquals(0, admin.data("GET", search("&orderingMethod=%25"), null).at("/totals/orderCount").asInt());
        assertEquals(0, admin.data("GET", search("&orderingMethod=" + "x".repeat(80)), null).at("/totals/orderCount").asInt());
        assertEquals(400, admin.raw("GET", search("&orderingMethod=" + "x".repeat(81)), null).statusCode());
        assertEquals(6, admin.data("GET", "/api/admin/orders?allUnpaid=true&orderingMethod=nomatch", null).at("/totals/orderCount").asInt());
        String method = names.getLast(), encoded = java.net.URLEncoder.encode(method, java.nio.charset.StandardCharsets.UTF_8);
        String suffix = "&orderingMethod=" + encoded + "&productName=" + java.net.URLEncoder.encode("八寸", java.nio.charset.StandardCharsets.UTF_8) + "&sizeInches=8&keyword=139";
        var combined = admin.data("GET", search(suffix), null);
        assertEquals(1, combined.at("/totals/orderCount").asInt()); assertEquals(2, combined.at("/totals/matchingQuantity").asInt());
        assertEquals("52000", combined.at("/totals/totalAmountCents").asText()); assertEquals(1, combined.path("sizes").size());
        assertEquals(2, combined.at("/employees/0/matchingQuantity").asInt());
        assertEquals(0, admin.data("GET", search(suffix + "&creditedEmployeeId=" + b.id), null).at("/totals/orderCount").asInt());
        var response = admin.raw("GET", search(suffix).replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, response.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
            assertEquals(2, book.getSheet("订单明细").getPhysicalNumberOfRows()); assertEquals(2, book.getSheet("商品明细").getPhysicalNumberOfRows());
            assertEquals("520.00", book.getSheet("订单明细").getRow(1).getCell(9).getStringCellValue());
            boolean recorded = false;
            for (var row : book.getSheet("统计")) if (row.getCell(0).getStringCellValue().equals("下单方式")) {
                assertEquals(method, row.getCell(1).getStringCellValue()); recorded = true;
            }
            assertTrue(recorded);
        }
        var download = admin.raw("POST", "/api/admin/orders/exports/zip", Map.of("from", "2026-10-01", "to", "2026-11-01", "orderingMethod", method));
        assertEquals(200, download.statusCode());
        try (var zip = new java.util.zip.ZipInputStream(new ByteArrayInputStream(download.body()))) {
            assertNotNull(zip.getNextEntry());
            try (var book = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) {
                assertEquals(4, book.getSheet("商品明细").getPhysicalNumberOfRows());
            }
            assertNull(zip.getNextEntry());
        }
        String id = created.get("到店").path("orderId").asText();
        jdbc.update("UPDATE cake_order SET ordering_method='  Legacy  ' WHERE id=?::uuid", id);
        assertEquals(1, admin.data("GET", search("&orderingMethod=Legacy"), null).at("/totals/orderCount").asInt());
        assertEquals(0, admin.data("GET", search("&orderingMethod=legacy"), null).at("/totals/orderCount").asInt());
        a.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("orderingMethod", "电话")));
        assertEquals(1, admin.data("GET", search("&orderingMethod=" + java.net.URLEncoder.encode("电话", java.nio.charset.StandardCharsets.UTF_8)), null).at("/totals/orderCount").asInt());
        a.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", Map.of("orderingMethod", "")));
        assertEquals(0, admin.data("GET", search("&orderingMethod=" + java.net.URLEncoder.encode("电话", java.nio.charset.StandardCharsets.UTF_8)), null).at("/totals/orderCount").asInt());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type='ORDER_INFORMATION_CHANGED' AND jsonb_exists(details->'after','orderingMethod')", Integer.class, id));
        id = created.get(method).path("orderId").asText();
        admin.data("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "合成删除"));
        var deleted = deletedFilters();
        String deletedQuery = "/api/admin/orders?deleted=true&from=" + deleted.get("from") + "&to=" + deleted.get("to");
        assertEquals(1, admin.data("GET", deletedQuery + "&orderingMethod=" + encoded, null).at("/totals/orderCount").asInt());
        assertEquals(0, admin.data("GET", deletedQuery + "&orderingMethod=nomatch", null).at("/totals/orderCount").asInt());
    }
    @Test void productNameSharesItemMatchingAcrossReportsExportsAndZipSelection() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        var other = a.data("POST", "/api/orders", create(a.id));
        jdbc.update("UPDATE cake_order_item SET name='普通商品' WHERE order_id=?::uuid", other.path("orderId").asText());
        String name = java.net.URLEncoder.encode(" 蛋糕 ", java.nio.charset.StandardCharsets.UTF_8);
        var all = admin.data("GET", search("&productName=" + name), null);
        assertEquals(1, all.at("/totals/orderCount").asInt()); assertEquals(9, all.at("/totals/matchingQuantity").asInt());
        assertEquals("52000", all.at("/totals/totalAmountCents").asText());
        assertEquals(0, admin.data("GET", search("&productName=" + name + "&page=2&size=1"), null).path("items").size());
        String suffix = "&productName=" + java.net.URLEncoder.encode("八寸", java.nio.charset.StandardCharsets.UTF_8);
        var filtered = admin.data("GET", search(suffix + "&sizeInches=8&keyword=139"), null);
        assertEquals(id, filtered.at("/items/0/orderId").asText());
        assertEquals(2, filtered.at("/totals/matchingQuantity").asInt()); assertEquals(2, filtered.at("/totals/cakeQuantity").asInt());
        assertEquals("52000", filtered.at("/totals/totalAmountCents").asText());
        assertEquals(1, filtered.path("sizes").size()); assertEquals("8", filtered.at("/sizes/0/size").asText());
        assertEquals(2, filtered.at("/employees/0/matchingQuantity").asInt()); assertEquals("52000", filtered.at("/employees/0/totalAmountCents").asText());
        assertEquals(Set.of("CAKE", "OTHER"), json.convertValue(filtered.at("/items/0/productTypes"), Set.class));
        assertFalse(filtered.at("/items/0/products").asText().contains("十寸"));
        assertEquals(0, admin.data("GET", search(suffix + "&sizeInches=10"), null).at("/totals/orderCount").asInt());
        assertEquals(0, admin.data("GET", search(suffix + "&keyword=nomatch"), null).at("/totals/orderCount").asInt());
        assertEquals(1, admin.data("GET", search(suffix + "&keyword=" + order.path("orderNo").asText()), null).at("/totals/orderCount").asInt());
        var response = admin.raw("GET", search(suffix).replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, response.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
            assertEquals(2, book.getSheet("订单明细").getPhysicalNumberOfRows());
            assertEquals(2, book.getSheet("商品明细").getPhysicalNumberOfRows());
            assertEquals("八寸蛋糕", book.getSheet("商品明细").getRow(1).getCell(1).getStringCellValue());
            assertEquals(2d, book.getSheet("订单明细").getRow(1).getCell(10).getNumericCellValue());
            assertEquals("520.00", book.getSheet("订单明细").getRow(1).getCell(9).getStringCellValue());
        }
        var download = admin.raw("POST", "/api/admin/orders/exports/zip", Map.of("from", "2026-10-01", "to", "2026-11-01", "productName", "八寸"));
        assertEquals(200, download.statusCode());
        try (var zip = new java.util.zip.ZipInputStream(new ByteArrayInputStream(download.body()))) {
            assertNotNull(zip.getNextEntry());
            try (var book = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) {
                assertEquals(4, book.getSheet("商品明细").getPhysicalNumberOfRows());
            }
            assertNull(zip.getNextEntry());
        }
    }
    @Test void productNameIsLiteralOptionalAndRespectsRemovedAndDeletedOrders() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id)); String id = order.path("orderId").asText();
        String name = "点心%_'\\";
        jdbc.update("UPDATE cake_order_item SET name=? WHERE order_id=?::uuid AND product_type='OTHER'", name, id);
        String suffix = "&productName=" + java.net.URLEncoder.encode(name, java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(6, admin.data("GET", search(suffix), null).at("/totals/matchingQuantity").asInt());
        assertEquals(0, admin.data("GET", search("&productName=%25%25"), null).at("/totals/orderCount").asInt());
        assertEquals(1, admin.data("GET", search("&productName=%20%20"), null).at("/totals/orderCount").asInt());
        assertEquals(200, admin.raw("GET", search("&productName=" + "x".repeat(100)), null).statusCode());
        assertEquals(400, admin.raw("GET", search("&productName=" + "x".repeat(101)), null).statusCode());
        assertEquals(1, admin.data("GET", "/api/admin/orders?allUnpaid=true&productName=nomatch", null).at("/totals/orderCount").asInt());
        jdbc.update("UPDATE cake_order_item SET is_removed=true WHERE order_id=?::uuid AND name=?", id, name);
        assertEquals(0, admin.data("GET", search(suffix), null).at("/totals/orderCount").asInt());
        admin.data("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "合成删除"));
        var filters = deletedFilters();
        String deleted = "/api/admin/orders?deleted=true&from=" + filters.get("from") + "&to=" + filters.get("to");
        assertEquals(1, admin.data("GET", deleted + "&productName=" + java.net.URLEncoder.encode("八寸", java.nio.charset.StandardCharsets.UTF_8), null).at("/totals/orderCount").asInt());
        assertEquals(0, admin.data("GET", deleted + suffix, null).at("/totals/orderCount").asInt());
    }
    @Test void sizesUseExactTextInGroupingFilteringAndExport() throws Exception {
        String doubleTier = "6+8寸双层";
        var body = new LinkedHashMap<>(create(b.id));
        body.put("items", java.util.stream.IntStream.range(0, 6).mapToObj(index -> Map.of(
                "name", "合成蛋糕 " + index, "productType", "CAKE", "quantity", index + 1,
                "attributes", Map.of("size", List.of("8", "8.00", "8寸", " " + doubleTier + "　", doubleTier, "　").get(index))))
                .toList());
        var order = a.data("POST", "/api/orders", body);
        assertEquals(doubleTier, order.at("/items/3/attributes/size").asText());
        assertEquals("8.00", order.at("/items/1/attributes/size").asText());
        var result = admin.data("GET", search(""), null);
        assertEquals(6, result.at("/totals/unclassifiedCakeQuantity").asInt());
        var counts = new HashMap<String, Integer>();
        result.path("sizes").forEach(row -> {
            assertEquals(1, row.path("orderCount").asInt());
            counts.put(row.path("size").isNull() ? null : row.path("size").asText(), row.path("cakeQuantity").asInt());
        });
        assertEquals(6, counts.remove(null));
        assertEquals(Map.of("8", 1, "8.00", 2, "8寸", 3, doubleTier, 9), counts);
        for (var group : counts.entrySet()) {
            String filter = "&sizeInches=" + java.net.URLEncoder.encode(group.getKey(), java.nio.charset.StandardCharsets.UTF_8);
            assertEquals(group.getValue(), admin.data("GET", search(filter), null).at("/totals/cakeQuantity").asInt());
        }
        String path = search("&sizeInches=" + java.net.URLEncoder.encode(doubleTier, java.nio.charset.StandardCharsets.UTF_8));
        var download = admin.raw("GET", path.replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, download.statusCode());
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(download.body()))) {
            assertEquals(doubleTier, book.getSheet("尺寸统计").getRow(1).getCell(0).getStringCellValue());
            assertEquals(9d, book.getSheet("尺寸统计").getRow(1).getCell(2).getNumericCellValue());
            var products = book.getSheet("商品明细");
            assertEquals(3, products.getPhysicalNumberOfRows());
            assertEquals(doubleTier, products.getRow(1).getCell(4).getStringCellValue());
            assertEquals(doubleTier, products.getRow(2).getCell(4).getStringCellValue());
        }
    }
    @Test void historicalSizeValuesRemainReadableAndUseExactFiltering() throws Exception {
        var order = a.data("POST", "/api/orders", create(b.id));
        String id = order.path("orderId").asText();
        String item = order.at("/items/0/itemId").asText();
        var samples = List.of("\"abc\"", "{\"tiers\":[8]}", "null", "\"8寸\"", "\"8.0\"", "\"8.001\"", "\"8.000000\"", "\"　 \"", "8");
        for (String size : samples) {
            jdbc.update("UPDATE cake_order_item SET attributes=jsonb_build_object('size',?::jsonb) WHERE id=?::uuid", size, item);
            var value = admin.data("GET", search("&sizeInches=8"), null);
            assertEquals(size.equals("8") ? 2 : 0, value.at("/totals/cakeQuantity").asInt());
            var detail = a.data("GET", "/api/orders/" + id, null);
            assertEquals(json.readTree(size), detail.at("/items/0/attributes/size"));
            assertEquals("原味", detail.at("/items/0/attributes/base").asText());
        }
    }
    @Test void ownershipChangesRecordRealActorAndArchivedEmployeeKeepsHistoricalAttribution() throws Exception {
        var order = b.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        admin.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 0, "changes", Map.of("creditedEmployeeId", a.id)));
        var activity = a.data("GET", "/api/orders/" + id + "/activities?type=ORDER_INFORMATION_CHANGED", null).at("/items/0");
        assertEquals(admin.id, activity.path("actorId").asText());
        assertEquals(b.id, activity.at("/details/before/creditedEmployeeId").asText());
        assertEquals(a.id, activity.at("/details/after/creditedEmployeeId").asText());
        var historical = b.data("POST", "/api/orders", create(b.id));
        admin.data("POST", "/api/admin/employees/" + b.id + "/archive", null);
        assertEquals("师傅 B", a.data("GET", "/api/orders/" + historical.path("orderId").asText(), null).at("/creditedEmployee/nickname").asText());
        assertEquals(1, admin.data("GET", search("&creditedEmployeeId=" + b.id), null).at("/totals/orderCount").asInt());
        var rejected = a.raw("PATCH", "/api/orders/" + id + "/information",
                Map.of("expectedVersion", 1, "changes", Map.of("creditedEmployeeId", b.id)));
        assertEquals(409, rejected.statusCode());
        assertEquals("ACCOUNT_ARCHIVED", json.readTree(rejected.body()).path("code").asText());
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
        for (String suffix : List.of("&status=UNKNOWN", "&paymentStatus=no", "&creditedEmployeeId=bad", "&page=0", "&size=0", "&size=101", "&includeCancelled=bad"))
            assertEquals(400, admin.raw("GET", search(suffix), null).statusCode(), suffix);
        assertEquals(400, admin.raw("GET", "/api/admin/orders?from=2026-02-30&to=2026-11-01", null).statusCode());
        assertEquals(400, admin.raw("GET", "/api/admin/orders?from=2026-11-01&to=2026-10-01", null).statusCode());
        var empty = admin.data("GET", search("&keyword=%25"), null); assertEquals(0, empty.at("/totals/orderCount").asInt());
        var paged = admin.data("GET", search("&includeCancelled=true&page=2&size=1"), null); assertEquals(0, paged.path("items").size()); assertEquals(1, paged.at("/totals/orderCount").asInt());
    }
    @Test void managementExportHandlesMoreThanOneHundredOrdersAndLegacyUnassignedOrders() throws Exception {
        a.data("POST", "/api/orders", create(a.id));
        jdbc.update("WITH new_orders AS (INSERT INTO cake_order(id,order_no,version,status,payment_status,customer_phone,fulfillment_type,requested_receive_date,planned_handoff_at,created_by,created_at,confirmed_at,updated_at)"
                + " SELECT gen_random_uuid(),'legacy-'||n,0,'CAKE_BASE','UNPAID','13900000000','PICKUP',DATE '2026-10-17',TIMESTAMPTZ '2026-10-17T06:00:00Z',?::uuid,now(),now(),now() FROM generate_series(1,105)n RETURNING id)"
                + " INSERT INTO cake_order_item(id,order_id,name,product_type,quantity,attributes,production_status,is_removed,created_at,updated_at) SELECT gen_random_uuid(),id,'旧蛋糕','CAKE',1,'{}'::jsonb,'NOT_STARTED',false,now(),now() FROM new_orders", a.id);
        var data = admin.data("GET", search("&unassigned=true&size=100"), null); assertEquals(105, data.at("/totals/orderCount").asInt()); assertEquals(100, data.path("items").size());
        var result = admin.raw("GET", search("&unassigned=true").replace("/api/admin/orders?", "/api/admin/orders/export?"), null);
        assertEquals(200, result.statusCode()); try (var book = new XSSFWorkbook(new ByteArrayInputStream(result.body()))) { assertEquals(106, book.getSheet("订单明细").getPhysicalNumberOfRows()); }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ORDER_EXPORTED'", Integer.class));
    }
    @Test void employeeGroupsUseStableAccountsAndExposeUnknownAmountsWithoutDuplicatingMixedOrderMoney() throws Exception {
        var first = b.data("POST", "/api/orders", create(b.id));
        a.data("PATCH", "/api/orders/" + first.path("orderId").asText() + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID"));
        var profile = admin.data("GET", "/api/admin/employees?employeeNumber=B001", null).at("/items/0");
        admin.data("PATCH", "/api/admin/employees/" + b.id, Map.of("expectedVersion", profile.path("version").asLong(), "nickname", "新名字", "jobRoles", List.of("FRONT_DESK")));
        var withoutAmount = new LinkedHashMap<>(create(b.id)); withoutAmount.remove("totalAmountCents");
        b.data("POST", "/api/orders", withoutAmount);
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
        var order = b.data("POST", "/api/orders", create(b.id)); String id = order.path("orderId").asText();
        String listPath = search("&sizeInches=8&creditedEmployeeId=" + b.id
                + "&paymentStatus=UNPAID&fulfillmentType=PICKUP&keyword=" + order.path("orderNo").asText());
        var before = admin.data("GET", listPath, null);
        assertEquals(1, before.at("/totals/orderCount").asInt());
        assertEquals(id, before.at("/items/0/orderId").asText());
        String exportPath = listPath.replace("/api/admin/orders?", "/api/admin/orders/export?");
        var totalsRead = new java.util.concurrent.CountDownLatch(1); var resumeExport = new java.util.concurrent.CountDownLatch(1);
        doAnswer(invocation -> {
            var result = invocation.callRealMethod(); totalsRead.countDown();
            if (!resumeExport.await(10, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("export did not resume");
            return result;
        }).when(management).totals(any());
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var export = executor.submit(() -> admin.raw("GET", exportPath, null));
            try {
                assertTrue(totalsRead.await(10, java.util.concurrent.TimeUnit.SECONDS));
                String itemId = null; for (var item : order.path("items")) if (item.path("name").asText().equals("八寸蛋糕")) itemId = item.path("itemId").asText();
                assertNotNull(itemId);
                a.data("PATCH", "/api/orders/" + id, Map.of("expectedVersion", 0, "itemId", itemId, "changes", Map.of("quantity", 3)));
                a.data("PATCH", "/api/orders/" + id + "/information", Map.of("expectedVersion", 1, "changes", Map.of("totalAmountCents", 60000)));
            } finally { resumeExport.countDown(); }
            var response = export.get(); assertEquals(200, response.statusCode());
            try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
                var orderRow = book.getSheet("订单明细").getRow(1);
                assertNotNull(orderRow, "筛选后的导出应包含目标订单");
                assertEquals(order.path("orderNo").asText(), orderRow.getCell(0).getStringCellValue());
                assertEquals("520.00", orderRow.getCell(9).getStringCellValue());
                assertEquals(2d, orderRow.getCell(10).getNumericCellValue());
                assertEquals(2d, book.getSheet("尺寸统计").getRow(1).getCell(2).getNumericCellValue());
                assertEquals("520.00", book.getSheet("员工业绩").getRow(1).getCell(5).getStringCellValue());
                assertEquals(2d, book.getSheet("商品明细").getRow(1).getCell(3).getNumericCellValue());
            }
        } finally { reset(management); }
        var latest = admin.data("GET", listPath, null);
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
    @Test void deletionIsReadOnlyIdempotentAndSeparateFromNormalQueriesAndReports() throws Exception {
        for (String status : List.of("CAKE_BASE", "LAYER", "FROSTING", "DECORATING", "WAITING_DELIVERY", "COMPLETED", "CANCELLED")) {
            var original = a.data("POST", "/api/orders", create(a.id)); String id = original.path("orderId").asText();
            jdbc.update("UPDATE cake_order SET status=?,payment_status='PAID',paid_at=CURRENT_TIMESTAMP WHERE id=?::uuid", status, id);
            assertEquals(403, a.raw("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "无权限")).statusCode());
            var deleted = admin.data("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", " 合成删除 "));
            assertEquals(status, deleted.path("status").asText()); assertEquals("合成删除", deleted.at("/deletion/reason").asText());
            assertEquals(admin.id, deleted.at("/deletion/deletedBy").asText()); assertEquals(1, deleted.path("version").asInt());
            assertEquals(deleted, admin.data("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "重试不覆盖")));
            assertEquals(409, a.raw("POST", "/api/orders/" + id + "/notes", Map.of("content", "不得写入")).statusCode());
            assertEquals(409, a.raw("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 1, "paymentStatus", "UNPAID")).statusCode());
            String restartPath = "/api/orders/" + id + "/restart";
            var restart = Map.of("expectedVersion", 1);
            var forbidden = a.raw("POST", restartPath, restart);
            assertEquals(403, forbidden.statusCode());
            assertEquals("FORBIDDEN", json.readTree(forbidden.body()).path("code").asText());
            var rejected = admin.raw("POST", restartPath, restart);
            assertEquals(409, rejected.statusCode());
            assertEquals("ORDER_DELETED", json.readTree(rejected.body()).path("code").asText());
            assertEquals(403, a.raw("POST", "/api/orders/" + id + "/exports/xlsx", null).statusCode());
            assertEquals(200, admin.raw("POST", "/api/orders/" + id + "/exports/xlsx", null).statusCode());
        }
        assertEquals(7, jdbc.queryForObject("SELECT count(*) FROM cake_order_deletion_audit", Integer.class));
        assertEquals(7, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ORDER_DELETED'", Integer.class));
        assertEquals(0, admin.data("GET", search("&includeCancelled=true"), null).at("/totals/orderCount").asInt());
        assertTrue(a.data("GET", "/api/orders/calendar?from=2026-10-01&to=2026-11-01", null).isEmpty());
        assertEquals(0, a.data("GET", "/api/orders/workbench?date=2026-10-17", null).path("pendingOrders").size());
        assertTrue(a.data("GET", "/api/orders/workbench/cake-bases?date=2026-10-17", null).path("items").isEmpty());
        assertEquals(0, a.data("GET", "/api/orders/workbench/payment-summary?date=2026-10-17", null).path("totalOrderCount").asInt());
        var filters = deletedFilters();
        var query = "/api/admin/orders?deleted=true&from=" + filters.get("from") + "&to=" + filters.get("to");
        var result = a.data("GET", query, null);
        assertEquals(7, result.at("/totals/orderCount").asInt()); assertEquals("0", result.at("/totals/totalAmountCents").asText());
        assertTrue(result.path("sizes").isEmpty()); assertTrue(result.path("employees").isEmpty());
        assertEquals(400, a.raw("GET", query.replace("/api/admin/orders?", "/api/admin/orders/export?"), null).statusCode());
        var zip = a.raw("POST", "/api/admin/orders/exports/zip", filters); assertEquals(200, zip.statusCode());
        assertTrue(zip.headers().firstValue("Content-Disposition").orElseThrow().contains("filename*=UTF-8''"));
        int files = 0;
        try (var archive = new java.util.zip.ZipInputStream(new ByteArrayInputStream(zip.body()), java.nio.charset.StandardCharsets.UTF_8)) {
            while (archive.getNextEntry() != null) {
                try (var workbook = new XSSFWorkbook(new ByteArrayInputStream(archive.readAllBytes()))) {
                    assertEquals("已删除", workbook.getSheet("订单信息").getRow(2).getCell(1).getStringCellValue());
                }
                files++;
            }
        }
        assertEquals(7, files);
    }
    @Test void deletionRequiresCurrentVersionAndReasonAndRollsBackWithItsAudit() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id)); String id = order.path("orderId").asText();
        assertEquals(400, admin.raw("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", " ")).statusCode());
        assertEquals(409, admin.raw("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 99, "reason", "合成删除")).statusCode());
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic delete audit unavailable")).when(orderActivities)
                .append(argThat(activity -> activity.type().equals("ORDER_DELETED")));
        assertEquals(503, admin.raw("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "合成删除")).statusCode());
        assertEquals(order, a.data("GET", "/api/orders/" + id, null));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_deletion_audit", Integer.class));
    }
    @Test void deletedOrdersRemainQueryableAndExportableAfterYears() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id));
        String id = order.path("orderId").asText();
        admin.data("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "历史保留"));
        jdbc.update("UPDATE cake_order SET deleted_at=CURRENT_TIMESTAMP-INTERVAL '800 days' WHERE id=?::uuid", id);
        var today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
        var list = admin.data("GET", "/api/admin/orders?deleted=true&from=" + today.minusDays(801) + "&to=" + today.minusDays(799), null);
        assertEquals(id, list.at("/items/0/orderId").asText());
        assertEquals(200, admin.raw("GET", "/api/orders/" + id + "/images", null).statusCode());
        assertEquals(200, admin.raw("POST", "/api/orders/" + id + "/exports/xlsx", null).statusCode());
        assertEquals(0, admin.data("GET", search("&includeCancelled=true"), null).at("/totals/orderCount").asInt());
    }

    @Test void keyedAdditionReplaysAfterCommitAndUnderConcurrency() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id));
        String path = "/api/orders/" + order.path("orderId").asText() + "/items";
        String key = UUID.randomUUID().toString();
        String itemId = UUID.randomUUID().toString();
        var item = Map.of("itemId", itemId, "name", "追加商品", "productType", "OTHER", "quantity", 1, "attributes", Map.of("specification", "合成数据"));
        var body = Map.of("expectedVersion", 0, "item", item);
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var first = executor.submit(() -> { start.await(); return a.raw("POST", path, body, key); });
            var second = executor.submit(() -> { start.await(); return a.raw("POST", path, body, key); });
            start.countDown();
            assertEquals(201, first.get(10, java.util.concurrent.TimeUnit.SECONDS).statusCode());
            assertEquals(201, second.get(10, java.util.concurrent.TimeUnit.SECONDS).statusCode());
        }
        var replay = a.raw("POST", path, Map.of("expectedVersion", 1, "item", item), key);
        assertEquals(201, replay.statusCode());
        assertEquals(1, json.readTree(replay.body()).at("/data/version").asLong());
        var changed = new LinkedHashMap<String, Object>(item);
        changed.put("quantity", 2);
        var conflict = a.raw("POST", path, Map.of("expectedVersion", 1, "item", changed), key);
        assertEquals(409, conflict.statusCode());
        assertEquals("IDEMPOTENCY_KEY_CONFLICT", json.readTree(conflict.body()).path("code").asText());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE id=?::uuid", Integer.class, itemId));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ITEM_ADDED'", Integer.class));
    }

    @Test void keyedAdditionCanRetryAfterItsReceiptTransactionRollsBack() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id));
        String path = "/api/orders/" + order.path("orderId").asText() + "/items";
        var body = Map.of("expectedVersion", 0, "item", Map.of("itemId", UUID.randomUUID().toString(),
                "name", "合成商品", "productType", "OTHER", "quantity", 1, "attributes", Map.of()));
        String key = UUID.randomUUID().toString();
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic receipt failure")).doCallRealMethod()
                .when(orderActivities).appendItemAddition(any(), eq(UUID.fromString(key)), anyString());
        assertEquals(503, a.raw("POST", path, body, key).statusCode());
        assertEquals(order, a.data("GET", path.substring(0, path.length() - "/items".length()), null));
        assertEquals(201, a.raw("POST", path, body, key).statusCode());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ITEM_ADDED'", Integer.class));
    }

    @Test void managerRestoresTheOriginalOrderExactlyOnceAndCanDeleteItAgain() throws Exception {
        String key = UUID.randomUUID().toString(); var body = create(a.id);
        var order = json.readTree(a.raw("POST", "/api/orders", body, key).body()).path("data");
        String id = order.path("orderId").asText(), path = "/api/orders/" + id;
        admin.data("POST", path + "/delete", Map.of("expectedVersion", 0, "reason", "误删"));
        jdbc.update("UPDATE cake_order SET deleted_at=CURRENT_TIMESTAMP-INTERVAL '800 days' WHERE id=?::uuid", id);
        assertEquals(403, a.raw("POST", path + "/restore", Map.of("expectedVersion", 1)).statusCode());
        assertEquals(409, admin.raw("POST", path + "/restore", Map.of("expectedVersion", 0)).statusCode());
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var first = executor.submit(() -> { start.await(); return admin.raw("POST", path + "/restore", Map.of("expectedVersion", 1)).statusCode(); });
            var second = executor.submit(() -> { start.await(); return admin.raw("POST", path + "/restore", Map.of("expectedVersion", 1)).statusCode(); });
            start.countDown();
            assertEquals(Set.of(200, 409), Set.of(first.get(10, java.util.concurrent.TimeUnit.SECONDS), second.get(10, java.util.concurrent.TimeUnit.SECONDS)));
        }
        var restored = a.data("GET", path, null);
        assertEquals(2, restored.path("version").asInt());
        assertTrue(restored.path("deletion").isNull());
        for (String field : List.of("orderId", "orderNo", "status", "paymentStatus", "items"))
            assertEquals(order.path(field), restored.path(field));
        assertEquals(id, json.readTree(a.raw("POST", "/api/orders", body, key).body()).at("/data/orderId").asText());
        admin.data("POST", path + "/delete", Map.of("expectedVersion", 2, "reason", "再次删除"));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ORDER_DELETED'", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ORDER_RESTORED'", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_deletion_audit", Integer.class));
    }
    @Test void frontDeskClerkCanQueryOrdersAndViewTotals() throws Exception {
        var order = b.data("POST", "/api/orders", create(b.id));
        a.data("POST", "/api/orders", create(a.id));
        var profile = a.data("GET", "/api/me", null);
        admin.data("PATCH", "/api/admin/employees/" + a.id, Map.of("expectedVersion", profile.path("version").asLong(),
                "nickname", "前厅店员", "jobRoles", List.of("FRONT_DESK_CLERK")));
        a.login("A001", PASSWORD);
        var me = a.data("GET", "/api/me", null);
        assertEquals("STAFF", me.path("systemRole").asText());
        assertTrue(me.at("/access/uiCapabilities").valueStream().anyMatch(value -> value.asText().equals("ORDER_MANAGEMENT")));
        var report = a.data("GET", search("&creditedEmployeeId=" + b.id), null);
        assertEquals(1, report.path("items").size());
        assertEquals(order.path("orderId"), report.at("/items/0/orderId"));
        assertEquals(1, report.at("/totals/orderCount").asInt());
        assertEquals(52000, report.at("/totals/totalAmountCents").asLong());
    }

    @Test void sixJobsProjectPhoneAndTimesAndOnlyStoreManagersAreAdministrators() throws Exception {
        var command = new LinkedHashMap<>(create(b.id));
        command.put("customer", Map.of("customerName", "隐私客户", "phone", "13900000000", "memberPhone", "13811112222", "buyerName", "隐私订购人"));
        command.put("orderingMethod", "到店");
        var order = a.data("POST", "/api/orders", command); String id = order.path("orderId").asText();
        for (String role : List.of("STORE_MANAGER", "FRONT_DESK_SUPERVISOR", "FRONT_DESK_CLERK", "PASTRY_SUPERVISOR", "DECORATOR", "BAKER")) {
            var current = admin.data("GET", "/api/admin/employees?employeeNumber=A001", null).at("/items/0");
            admin.data("PATCH", "/api/admin/employees/" + a.id, Map.of("expectedVersion", current.path("version").asLong(), "nickname", "岗位测试", "jobRoles", List.of(role)));
            a.login("A001", PASSWORD);
            var me = a.data("GET", "/api/me", null); assertEquals(role.equals("STORE_MANAGER") ? "SUPER_ADMIN" : "STAFF", me.path("systemRole").asText());
            var detail = a.data("GET", "/api/orders/" + id, null); assertEquals("13900000000", detail.at("/customer/phone").asText());
            boolean production = Set.of("PASTRY_SUPERVISOR", "DECORATOR", "BAKER").contains(role);
            assertEquals(production, detail.at("/customer/customerName").isNull()); assertEquals(production, detail.at("/customer/memberPhone").isNull());
            assertEquals("隐私订购人", detail.at("/customer/buyerName").asText()); assertEquals("到店", detail.path("orderingMethod").asText());
            assertEquals(production, detail.path("totalAmountCents").isNull());
            assertEquals("2026-10-17", detail.at("/fulfillment/requestedReceiveDate").asText());
            if (production) {
                assertEquals(403, a.raw("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "越权")).statusCode());
                var updated = a.data("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", detail.path("version").asLong(), "action", "COMPLETE_BASE"));
                assertEquals("13900000000", updated.at("/customer/phone").asText()); assertTrue(updated.at("/customer/customerName").isNull());
                assertEquals("隐私订购人", updated.at("/customer/buyerName").asText()); assertEquals("到店", updated.path("orderingMethod").asText());
                a.data("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", updated.path("version").asLong(), "action", "ROLLBACK_PRODUCTION"));
            }
        }
        var adminProfile = admin.data("GET", "/api/me", null);
        assertEquals(409, admin.raw("PATCH", "/api/admin/employees/" + admin.id, Map.of("expectedVersion", adminProfile.path("version").asLong(), "nickname", "店主", "jobRoles", List.of("FRONT_DESK_CLERK"))).statusCode());
    }
    @Test void decoratorCanCompleteProductionAndNeedsAnotherJobToMaintainItems() throws Exception {
        var input = new LinkedHashMap<>(create(a.id));
        input.put("orderingMethod", "到店");
        var order = a.data("POST", "/api/orders", input);
        String path = "/api/orders/" + order.path("orderId").asText();
        String firstItem = order.at("/items/0/itemId").asText();
        var profile = b.data("GET", "/api/me", null);
        String employee = "/api/admin/employees/" + b.id;
        var decorator = admin.data("PATCH", employee, Map.of("expectedVersion", profile.path("version").asLong(),
                "nickname", "裱花师", "jobRoles", List.of("DECORATOR")));

        var denied = b.raw("PATCH", path + "/information", Map.of("expectedVersion", 0, "changes", Map.of("orderingMethod", "电话")));
        assertEquals(403, denied.statusCode());
        assertEquals("FORBIDDEN", json.readTree(denied.body()).path("code").asText());
        var unchanged = b.data("GET", path, null);
        assertEquals(0, unchanged.path("version").asLong());
        assertEquals("到店", unchanged.path("orderingMethod").asText());

        String extraItem = UUID.randomUUID().toString();
        assertEquals(403, b.raw("PATCH", path, Map.of("expectedVersion", 0, "itemId", firstItem, "changes", Map.of("name", "改款蛋糕"))).statusCode());
        assertEquals(403, b.raw("POST", path + "/items", Map.of("expectedVersion", 0,
                "item", Map.of("itemId", extraItem, "name", "补充商品", "quantity", 1))).statusCode());
        assertEquals(403, b.raw("POST", path + "/items/" + firstItem + "/remove", Map.of("expectedVersion", 0)).statusCode());
        var completed = b.data("PATCH", path + "/items/" + firstItem + "/production-status", Map.of("expectedVersion", 0, "completed", true));
        assertEquals("COMPLETED", completed.at("/items/0/productionStatus").asText());

        admin.data("PATCH", employee, Map.of("expectedVersion", decorator.path("version").asLong(),
                "nickname", "兼岗裱花师", "jobRoles", List.of("DECORATOR", "FRONT_DESK_CLERK")));
        var renamed = b.data("PATCH", path, Map.of("expectedVersion", completed.path("version").asLong(), "itemId", firstItem, "changes", Map.of("name", "改款蛋糕")));
        assertEquals("改款蛋糕", renamed.at("/items/0/name").asText());
        var added = b.data("POST", path + "/items", Map.of("expectedVersion", renamed.path("version").asLong(),
                "item", Map.of("itemId", extraItem, "name", "补充商品", "quantity", 1)));
        assertEquals(4, added.path("items").size());
        var removed = b.data("POST", path + "/items/" + extraItem + "/remove", Map.of("expectedVersion", added.path("version").asLong()));
        assertEquals(3, removed.path("items").size());
        var produced = b.data("POST", path + "/production-actions", Map.of("expectedVersion", removed.path("version").asLong(), "action", "COMPLETE_BASE"));
        assertEquals("LAYER", produced.path("status").asText());

        var edited = b.data("PATCH", path + "/information", Map.of("expectedVersion", produced.path("version").asLong(),
                "changes", Map.of("orderingMethod", "电话")));
        assertEquals("电话", edited.path("orderingMethod").asText());
    }
    @Test void singleJobDecoratorCanRestartButNeedsAnotherJobToCancel() throws Exception {
        var order = a.data("POST", "/api/orders", create(a.id));
        String path = "/api/orders/" + order.path("orderId").asText();
        String employee = "/api/admin/employees/" + b.id;
        var profile = b.data("GET", "/api/me", null);
        profile = admin.data("PATCH", employee, Map.of("expectedVersion", profile.path("version").asLong(),
                "nickname", "裱花师", "jobRoles", List.of("DECORATOR")));

        var cancel = Map.of("expectedVersion", order.path("version").asLong(), "reason", "合成取消");
        var denied = b.raw("POST", path + "/cancel", cancel);
        assertEquals(403, denied.statusCode());
        assertEquals("FORBIDDEN", json.readTree(denied.body()).path("code").asText());
        var cancelled = a.data("POST", path + "/cancel", cancel);
        assertEquals("CANCELLED", cancelled.path("status").asText());
        var restart = Map.of("expectedVersion", cancelled.path("version").asLong());
        assertEquals(403, a.raw("POST", path + "/restart", restart).statusCode());
        var restarted = b.data("POST", path + "/restart", restart);
        assertEquals("CAKE_BASE", restarted.path("status").asText());

        for (String otherRole : List.of("FRONT_DESK_CLERK", "STORE_MANAGER")) {
            profile = admin.data("PATCH", employee, Map.of("expectedVersion", profile.path("version").asLong(),
                    "nickname", "兼岗裱花师", "jobRoles", List.of("DECORATOR", otherRole)));
            b.login("B001", PASSWORD);
            cancelled = b.data("POST", path + "/cancel",
                    Map.of("expectedVersion", restarted.path("version").asLong(), "reason", "合成取消"));
            assertEquals("CANCELLED", cancelled.path("status").asText());
            restarted = b.data("POST", path + "/restart", Map.of("expectedVersion", cancelled.path("version").asLong()));
            assertEquals("CAKE_BASE", restarted.path("status").asText());
        }
    }
    @Test void singleJobDecoratorCannotConfirmFulfillmentButCanReopenAndRollBack() throws Exception {
        String employee = "/api/admin/employees/" + b.id;
        var profile = b.data("GET", "/api/me", null);
        profile = admin.data("PATCH", employee, Map.of("expectedVersion", profile.path("version").asLong(),
                "nickname", "裱花师", "jobRoles", List.of("DECORATOR")));
        var waiting = new LinkedHashMap<String, JsonNode>();
        for (String type : List.of("PICKUP", "DELIVERY")) {
            String confirm = type.equals("PICKUP") ? "CONFIRM_PICKUP" : "COMPLETE_DELIVERY";
            var input = new LinkedHashMap<>(create(a.id));
            if (type.equals("DELIVERY")) input.put("fulfillment", Map.of("type", type, "address", "合成配送地址",
                    "requestedReceiveDate", "2026-10-17", "plannedHandoffAt", "2026-10-17T14:00:00+08:00"));
            var order = a.data("POST", "/api/orders", input);
            String path = "/api/orders/" + order.path("orderId").asText();
            for (String action : List.of("COMPLETE_BASE", "COMPLETE_LAYER", "COMPLETE_FROSTING")) {
                order = b.data("POST", path + "/production-actions", Map.of("expectedVersion", order.path("version").asLong(), "action", action));
            }
            for (var item : order.path("items")) {
                order = b.data("PATCH", path + "/items/" + item.path("itemId").asText() + "/production-status",
                        Map.of("expectedVersion", order.path("version").asLong(), "completed", true));
            }
            order = b.data("POST", path + "/production-actions", Map.of("expectedVersion", order.path("version").asLong(), "action", "COMPLETE_DECORATION"));
            var confirmation = Map.of("expectedVersion", order.path("version").asLong(), "action", confirm);
            assertEquals(403, b.raw("POST", path + "/fulfillment-actions", confirmation).statusCode());
            order = a.data("POST", path + "/fulfillment-actions", confirmation);
            assertEquals("COMPLETED", order.path("status").asText());
            order = b.data("POST", path + "/fulfillment-actions",
                    Map.of("expectedVersion", order.path("version").asLong(), "action", "ROLLBACK_FULFILLMENT"));
            assertEquals("WAITING_DELIVERY", order.path("status").asText());
            order = b.data("POST", path + "/production-actions", Map.of("expectedVersion", order.path("version").asLong(), "action", "REOPEN_PRODUCTION"));
            assertEquals("DECORATING", order.path("status").asText());
            waiting.put(confirm, b.data("POST", path + "/production-actions",
                    Map.of("expectedVersion", order.path("version").asLong(), "action", "COMPLETE_DECORATION")));
        }
        for (String otherRole : List.of("FRONT_DESK_CLERK", "STORE_MANAGER")) {
            profile = admin.data("PATCH", employee, Map.of("expectedVersion", profile.path("version").asLong(),
                    "nickname", "兼岗裱花师", "jobRoles", List.of("DECORATOR", otherRole)));
            b.login("B001", PASSWORD);
            for (var entry : waiting.entrySet()) {
                var order = entry.getValue();
                String path = "/api/orders/" + order.path("orderId").asText() + "/fulfillment-actions";
                var completed = b.data("POST", path, Map.of("expectedVersion", order.path("version").asLong(), "action", entry.getKey()));
                assertEquals("COMPLETED", completed.path("status").asText());
                entry.setValue(b.data("POST", path, Map.of("expectedVersion", completed.path("version").asLong(), "action", "ROLLBACK_FULFILLMENT")));
            }
        }
    }
    @Test void restoreActivityFailureRollsBackTheOrderVersionAndDeletion() throws Exception {
        String id = a.data("POST", "/api/orders", create(a.id)).path("orderId").asText();
        String path = "/api/orders/" + id;
        var deleted = admin.data("POST", path + "/delete", Map.of("expectedVersion", 0, "reason", "合成误删"));
        doThrow(new org.springframework.dao.DataAccessResourceFailureException("synthetic restore audit failure")).when(orderActivities)
                .append(argThat(activity -> activity.type().equals("ORDER_RESTORED")));
        assertEquals(503, admin.raw("POST", path + "/restore", Map.of("expectedVersion", 1)).statusCode());
        assertEquals(deleted, admin.data("GET", path, null));
    }
    @Test void confirmedLegacyRoleAssignmentsAreAtomicAuditedAndSafeToRepeat() {
        var assignments = Map.of("A001", Set.of("FRONT_DESK_CLERK"), "B001", Set.of("DECORATOR"));
        var result = identity.migrateLegacyJobs("ADMIN", assignments); assertEquals(2, result.size());
        assertEquals(Set.of("FRONT_DESK_CLERK"), result.stream().filter(account -> account.employeeNumber().equals("A001")).findFirst().orElseThrow().jobRoles());
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action='identity.roles_migrated'", Integer.class));
        identity.migrateLegacyJobs("ADMIN", assignments);
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM audit_operation WHERE action='identity.roles_migrated'", Integer.class));
        assertThrows(org.xaspire.WuhouCake.identity.domain.model.valobj.IdentityFailure.class,
                () -> identity.migrateLegacyJobs("ADMIN", Map.of("A001", Set.of("BAKER"))));
    }
    @Test void paymentAndDeletionCannotBothCommitAgainstTheSameVersion() throws Exception {
        String id = a.data("POST", "/api/orders", create(a.id)).path("orderId").asText();
        try (var executor = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var deletion = executor.submit(() -> { start.await(); return admin.raw("POST", "/api/orders/" + id + "/delete", Map.of("expectedVersion", 0, "reason", "并发删除")); });
            var payment = executor.submit(() -> { start.await(); return b.raw("PATCH", "/api/orders/" + id + "/payment-status", Map.of("expectedVersion", 0, "paymentStatus", "PAID")); });
            start.countDown();
            assertEquals(Set.of(200, 409), Set.of(deletion.get().statusCode(), payment.get().statusCode()));
        }
        assertEquals(1, a.data("GET", "/api/orders/" + id, null).path("version").asInt());
    }
    private Map<String, Object> deletedFilters() {
        var date = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
        return Map.of("from", date.minusDays(29).toString(), "to", date.plusDays(1).toString(), "deleted", true);
    }
    private String search(String suffix) { return "/api/admin/orders?from=2026-10-01&to=2026-11-01" + suffix; }
    private Map<String, Object> create(String employee) {
        return Map.of("customer", Map.of("customerName", "合成客户", "phone", "13900000000"), "creditedEmployeeId", employee,
                "fulfillment", Map.of("type", "PICKUP", "requestedReceiveDate", "2026-10-17", "plannedHandoffAt", "2026-10-17T14:00:00+08:00"), "totalAmountCents", 52000,
                "items", List.of(Map.of("name", "八寸蛋糕", "productType", "CAKE", "quantity", 2, "attributes", Map.of("size", "8", "base", " ")),
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

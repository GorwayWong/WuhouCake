package org.xaspire.WuhouCake.bootstrap;

import com.fasterxml.jackson.databind.*;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.zip.ZipInputStream;
import javax.imageio.ImageIO;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.event.TransactionalEventListener;
import org.slf4j.LoggerFactory;
import org.xaspire.WuhouCake.bootstrap.security.ApiErrors;
import org.xaspire.WuhouCake.bootstrap.integration.JwtTestKeys;
import org.xaspire.WuhouCake.identity.application.service.IdentityService;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.adapter.web.OrderStreams;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.domain.repository.OrderActivities;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("integration")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Import(OrderExportIT.EventsConfiguration.class)
class OrderExportIT {
    private static final String SCHEMA = "order_export_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:order-export-it:" + UUID.randomUUID();
    private static final String INITIAL = "Initial password for test!", PASSWORD = "Permanent password for test!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        JwtTestKeys.properties(registry);
        registry.add("spring.flyway.default-schema", () -> SCHEMA); registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.datasource.hikari.schema", () -> SCHEMA); registry.add("wuhoucake.identity.redis-namespace", () -> NAMESPACE);
    }
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired IdentityService identity;
    @Autowired Changes changes;
    @Autowired org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderImageMaintenanceMapper maintenance;
    @Autowired OrderImageValidator validator;
    @Autowired org.xaspire.WuhouCake.order.application.service.OrderExportSnapshotService snapshots;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
    @MockitoSpyBean OrderImages images;
    @MockitoSpyBean OrderActivities activities;
    @MockitoSpyBean OrderExportFiles files;
    @MockitoSpyBean OrderStreams streams;
    @BeforeEach void clean() {
        reset(images, activities, files, streams); changes.events.clear();
        jdbc.execute("TRUNCATE cake_order_image, cake_order_activity, cake_order_item, cake_order, audit_operation, identity_account_role, identity_account CASCADE");
        clearSessions();
    }
    @AfterAll void removeTestData() {
        reset(images, activities, files, streams); clearSessions(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE");
    }
    private void clearSessions() { var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys); }

    @Test void uploadsMetadataContentAndSingleExportHaveAuthenticatedImmutableHistory() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText(), item = order.at("/items/0/itemId").asText();
        var png = picture("png"); var jpeg = picture("jpeg");
        var upload = staff.upload(id, null, png, "../fake.exe"); assertEquals(201, upload.statusCode(), text(upload));
        var image = data(upload); String imageId = image.path("imageId").asText();
        assertEquals("image/png", image.path("contentType").asText()); assertEquals("fake.exe.png", image.path("filename").asText());
        assertEquals(staff.accountId, image.path("uploadedBy").asText()); assertEquals("前台员工", image.path("uploaderNameSnapshot").asText());
        assertEquals(201, staff.upload(id, item, jpeg, "cake.jpg").statusCode());
        assertArrayEquals(png, jdbc.queryForObject("SELECT content FROM cake_order_image WHERE id=?::uuid", byte[].class, imageId));
        clearInvocations(images);
        var list = staff.request("GET", "/api/orders/" + id + "/images", null); assertEquals(2, data(list).size());
        verify(images, never()).content(any(), any());
        var content = staff.request("GET", "/api/orders/" + id + "/images/" + imageId, null);
        assertArrayEquals(png, content.body()); assertEquals("image/png", header(content, "Content-Type")); assertEquals("no-store", header(content, "Cache-Control"));
        var another = data(staff.request("POST", "/api/orders", create("2026-10-16"))).path("orderId").asText();
        assertEquals(404, staff.request("GET", "/api/orders/" + another + "/images/" + imageId, null).statusCode());
        assertEquals(404, staff.upload(another, item, png, "x.png").statusCode());
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> jdbc.update("INSERT INTO cake_order_image"
                + " (id, order_id, item_id, content_type, filename, content, size, width, height, uploaded_by, uploader_name_snapshot, uploaded_at)"
                + " SELECT gen_random_uuid(), ?::uuid, ?::uuid, content_type, filename, content, size, width, height, uploaded_by, uploader_name_snapshot, uploaded_at"
                + " FROM cake_order_image WHERE id=?::uuid", another, item, imageId));
        assertEquals(404, staff.upload(UUID.randomUUID().toString(), null, png, "x.png").statusCode());
        var anonymous = new Client();
        assertEquals(401, anonymous.upload(id, null, png, "x.png").statusCode());
        for (String path : List.of("/images", "/images/" + imageId)) assertEquals(401, anonymous.request("GET", "/api/orders/" + id + path, null).statusCode());
        assertEquals(401, anonymous.request("POST", "/api/orders/" + id + "/exports/xlsx", null).statusCode());
        assertEquals(401, anonymous.request("POST", "/api/orders/exports/zip", range()).statusCode());
        staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "整单少糖"));
        staff.request("POST", "/api/orders/" + id + "/notes", Map.of("itemId", item, "content", "商品备注"));
        var before = data(staff.request("GET", "/api/orders/" + id, null)); changes.events.clear();
        var tempBefore = temporaryFiles();
        var exported = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        assertEquals(200, exported.statusCode(), text(exported)); assertEquals("no-store", header(exported, "Cache-Control"));
        assertTrue(header(exported, "Content-Type").contains("spreadsheetml")); assertTrue(header(exported, "Content-Disposition").startsWith("attachment;"));
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(exported.body()))) {
            assertEquals(2, book.getAllPictures().size()); assertEquals(3, book.getSheet("商品明细").getPhysicalNumberOfRows());
            assertEquals(3, book.getSheet("工作备注").getPhysicalNumberOfRows());
        }
        assertEquals(before, data(staff.request("GET", "/api/orders/" + id, null))); assertTrue(changes.events.isEmpty());
        var history = data(staff.request("GET", "/api/orders/" + id + "/activities?type=ORDER_EXPORTED", null));
        assertEquals(0, history.path("total").asInt());
        assertEquals(tempBefore, temporaryFiles());
    }
    @Test void rejectsInvalidUploadsAndSerializesConcurrentImageLimit() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        assertEquals(400, staff.upload(id, null, new byte[0], "x.png").statusCode());
        assertEquals(415, staff.upload(id, null, "not an image".getBytes(StandardCharsets.UTF_8), "x.png").statusCode());
        assertEquals(413, staff.upload(id, null, new byte[5 * 1024 * 1024 + 1], "x.png").statusCode());
        var png = picture("png"); for (int i = 0; i < 7; i++) assertEquals(201, staff.upload(id, null, png, "x.png").statusCode());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.upload(id, null, png, "a.png"); });
            var b = executor.submit(() -> { start.await(); return staff.upload(id, null, png, "b.png"); });
            start.countDown(); assertEquals(Set.of(201, 409), Set.of(a.get().statusCode(), b.get().statusCode()));
        }
        assertEquals(8, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
    }
    @Test void removedItemImageIsRetainedButExcludedFromFutureExports() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText(), item = order.at("/items/0/itemId").asText();
        var image = data(staff.upload(id, item, picture("png"), "x.png"));
        assertEquals(200, staff.request("POST", "/api/orders/" + id + "/items/" + item + "/remove", Map.of("expectedVersion", 0)).statusCode());
        assertEquals(404, staff.upload(id, item, picture("png"), "x.png").statusCode());
        assertEquals(1, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertEquals(200, staff.request("GET", "/api/orders/" + id + "/images/" + image.path("imageId").asText(), null).statusCode());
        var response = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null); assertEquals(200, response.statusCode(), text(response));
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) {
            assertTrue(book.getAllPictures().isEmpty()); assertEquals(2, book.getSheet("商品明细").getPhysicalNumberOfRows());
        }
    }
    @Test void imageRemovalIsScopedIdempotentReleasesQuotaAndPreservesSnapshots() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText(), item = order.at("/items/0/itemId").asText();
        var png = picture("png"); var image = data(staff.upload(id, item, png, "cake.png"));
        String imageId = image.path("imageId").asText(), path = "/api/orders/" + id + "/images/" + imageId;
        for (int i = 0; i < 7; i++) assertEquals(201, staff.upload(id, null, png, "other.png").statusCode());
        assertEquals(409, staff.upload(id, null, png, "full.png").statusCode());
        var added = data(staff.request("GET", "/api/orders/" + id + "/activities?type=IMAGE_ADDED", null));
        assertEquals(8, added.path("total").asInt());
        String another = data(staff.request("POST", "/api/orders", create("2026-10-16"))).path("orderId").asText();
        assertEquals(404, staff.request("DELETE", "/api/orders/" + another + "/images/" + imageId, null).statusCode());
        assertEquals(401, new Client().request("DELETE", path, null).statusCode());
        changes.events.clear();
        assertEquals(200, staff.request("DELETE", path, null).statusCode());
        assertEquals(200, staff.request("DELETE", path, null).statusCode());
        assertEquals(1, changes.events.size());
        assertEquals(new OrderChanged(UUID.fromString(id), UUID.fromString(item), OrderChanged.Type.IMAGE_REMOVED, 0, order.path("orderNo").asText()), changes.events.peek());
        assertEquals(404, staff.request("GET", path, null).statusCode());
        assertEquals(7, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertTrue(jdbc.queryForObject("SELECT is_removed FROM cake_order_image WHERE id=?::uuid", Boolean.class, imageId));
        assertArrayEquals(png, images.content(UUID.fromString(id), UUID.fromString(imageId)).orElseThrow());
        var removed = data(staff.request("GET", "/api/orders/" + id + "/activities?type=IMAGE_REMOVED", null));
        assertEquals(1, removed.path("total").asInt());
        var log = removed.at("/items/0");
        assertEquals(imageId, log.at("/details/imageId").asText()); assertEquals("cake.png", log.at("/details/filename").asText());
        assertEquals(item, log.path("itemId").asText()); assertEquals(staff.accountId, log.path("actorId").asText());
        assertFalse(log.path("createdAt").asText().isEmpty());
        var exported = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(exported.body()))) { assertEquals(7, book.getAllPictures().size()); }
        assertEquals(201, staff.upload(id, null, png, "replacement.png").statusCode());
        assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
        assertEquals(9, jdbc.queryForObject("SELECT count(*) FROM cake_order_image WHERE order_id=?::uuid", Integer.class, id));
    }
    @Test void imageDataAndActivityRollBackTogether() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        changes.events.clear();
        doThrow(new DataAccessResourceFailureException("test log unavailable")).when(activities).append(argThat(log -> log.type().equals("IMAGE_ADDED")));
        assertEquals(503, staff.upload(id, null, picture("png"), "failed.png").statusCode());
        assertEquals(0, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertTrue(changes.events.isEmpty()); reset(activities);
        var image = data(staff.upload(id, null, picture("png"), "kept.png")); changes.events.clear();
        doThrow(new DataAccessResourceFailureException("test log unavailable")).when(activities).append(argThat(log -> log.type().equals("IMAGE_REMOVED")));
        assertEquals(503, staff.request("DELETE", "/api/orders/" + id + "/images/" + image.path("imageId").asText(), null).statusCode());
        assertEquals(1, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertEquals(0, data(staff.request("GET", "/api/orders/" + id + "/activities?type=IMAGE_REMOVED", null)).path("total").asInt());
        assertTrue(changes.events.isEmpty());
        assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
    }
    @Test void exportSnapshotKeepsItsImageWhenRemovedDuringGeneration() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        var image = data(staff.upload(id, null, picture("png"), "snapshot.png"));
        doAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            assertEquals(200, staff.request("DELETE", "/api/orders/" + id + "/images/" + image.path("imageId").asText(), null).statusCode());
            return invocation.callRealMethod();
        }).when(files).generate(any(), anyString(), eq(false));
        var response = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        assertEquals(200, response.statusCode(), text(response));
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(response.body()))) { assertEquals(1, book.getAllPictures().size()); }
        reset(files);
        var next = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(next.body()))) { assertTrue(book.getAllPictures().isEmpty()); }
    }
    @Test void batchFiltersDatesAndBusinessConditionsWithoutCreatingActivity() throws Exception {
        var staff = staff(); var a = data(staff.request("POST", "/api/orders", create("2026-10-01")));
        var b = data(staff.request("POST", "/api/orders", create("2026-10-02")));
        var c = data(staff.request("POST", "/api/orders", create("2026-10-03")));
        staff.request("POST", "/api/orders", create("2026-11-01"));
        jdbc.update("UPDATE cake_order SET payment_status='PAID', fulfillment_type='PICKUP', status='COMPLETED' WHERE id=?::uuid", b.path("orderId").asText());
        jdbc.update("UPDATE cake_order SET status='CANCELLED' WHERE id=?::uuid", c.path("orderId").asText());
        var all = staff.request("POST", "/api/orders/exports/zip", range());
        assertEquals(200, all.statusCode(), text(all));
        assertEquals(List.of(filename(a), filename(b), filename(c)), entries(all));
        assertEquals(0, exportCount());
        var filtered = new LinkedHashMap<String, Object>(range()); filtered.put("status", "WAITING_PRODUCTION"); filtered.put("paymentStatus", "UNPAID"); filtered.put("fulfillmentType", "DELIVERY");
        assertEquals(List.of(filename(a)), entries(staff.request("POST", "/api/orders/exports/zip", filtered)));
        filtered = new LinkedHashMap<>(range()); filtered.put("paymentStatus", "PAID"); assertEquals(List.of(filename(b)), entries(staff.request("POST", "/api/orders/exports/zip", filtered)));
        filtered = new LinkedHashMap<>(range()); filtered.put("status", "CANCELLED"); assertEquals(List.of(filename(c)), entries(staff.request("POST", "/api/orders/exports/zip", filtered)));
        filtered = new LinkedHashMap<>(range()); filtered.put("fulfillmentType", "PICKUP"); assertEquals(List.of(filename(b)), entries(staff.request("POST", "/api/orders/exports/zip", filtered)));
    }
    @Test void activityUnavailableDoesNotBlockExportAndGenerationFailureDeletesFiles() throws Exception {
        var staff = staff(); var a = data(staff.request("POST", "/api/orders", create("2026-10-01")));
        staff.request("POST", "/api/orders", create("2026-10-02"));
        var before = temporaryFiles();
        doThrow(new DataAccessResourceFailureException("test log unavailable")).when(activities).append(any());
        assertEquals(200, staff.request("POST", "/api/orders/exports/zip", range()).statusCode());
        assertEquals(0, exportCount()); assertEquals(before, temporaryFiles()); reset(activities);
        String id = a.path("orderId").asText(); staff.upload(id, null, picture("png"), "x.png");
        doThrow(new DataAccessResourceFailureException("test image unavailable")).when(images).content(any(), any());
        assertEquals(503, staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null).statusCode());
        assertEquals(0, exportCount()); assertEquals(before, temporaryFiles());
    }
    @Test void snapshotsStayConsistentAcrossConcurrentChangesWithoutHoldingGenerationTransaction() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-01"))); String id = order.path("orderId").asText();
        doAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
            jdbc.update("UPDATE cake_order SET version=version+1, payment_status='PAID', updated_at=now() WHERE id=?::uuid", id);
            return invocation.callRealMethod();
        }).when(files).generate(any(), anyString(), eq(false));
        doAnswer(invocation -> { assertTrue(TransactionSynchronizationManager.isActualTransactionActive()); return invocation.callRealMethod(); })
                .when(activities).append(argThat(activity -> activity.type().equals("ORDER_EXPORTED")));
        var result = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null); assertEquals(200, result.statusCode(), text(result));
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(result.body()))) {
            boolean found = false;
            for (var row : book.getSheet("订单信息")) if (row.getCell(0).getStringCellValue().equals("付款状态")) {
                assertEquals("未付款", row.getCell(1).getStringCellValue()); found = true;
            }
            assertTrue(found);
        }
        assertEquals("PAID", data(staff.request("GET", "/api/orders/" + id, null)).path("paymentStatus").asText());
        assertEquals(0, exportCount());
    }
    @Test void emptyInvalidAndOverLimitRequestsNeverCreateLogs() throws Exception {
        var staff = staff();
        var empty = staff.request("POST", "/api/orders/exports/zip", range()); assertEquals(400, empty.statusCode()); assertEquals("EXPORT_EMPTY", body(empty).path("code").asText());
        assertEquals(400, staff.request("POST", "/api/orders/exports/zip", Map.of("from", "2026-10-01", "to", "2026-12-01")).statusCode());
        assertEquals(400, staff.request("POST", "/api/orders/exports/zip", Map.of("from", "2026-10-01")).statusCode());
        var a = data(staff.request("POST", "/api/orders", create("2026-10-01")));
        jdbc.update("INSERT INTO cake_order (id, order_no, version, status, payment_status, customer_phone, fulfillment_type, delivery_address, requested_receive_date,"
                + " planned_handoff_at, created_by, created_at, confirmed_at, updated_at) SELECT gen_random_uuid(), 'test-' || n, 0, status, payment_status,"
                + " customer_phone, fulfillment_type, delivery_address, requested_receive_date, planned_handoff_at, created_by, created_at, confirmed_at, updated_at"
                + " FROM cake_order CROSS JOIN generate_series(1,100) n WHERE id=?::uuid", a.path("orderId").asText());
        var tooMany = staff.request("POST", "/api/orders/exports/zip", range()); assertEquals(400, tooMany.statusCode());
        assertEquals("EXPORT_LIMIT_EXCEEDED", body(tooMany).path("code").asText()); assertEquals(0, exportCount());
    }
    @Test void textAndRowBudgetsRejectBeforeMaterializingLargeSnapshots() throws Exception {
        var staff = staff(); var a = data(staff.request("POST", "/api/orders", create("2026-10-01"))); String id = a.path("orderId").asText();
        jdbc.update("INSERT INTO cake_order_activity(order_id,type,content,actor_id,actor_name_snapshot,created_at)"
                + " VALUES (?::uuid,'NOTE',repeat('字',2800000),?::uuid,'员工',now())", id, staff.accountId);
        var hugeText = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        assertEquals(413, hugeText.statusCode()); assertEquals("EXPORT_CONTENT_TOO_LARGE", body(hugeText).path("code").asText());
        jdbc.update("DELETE FROM cake_order_activity WHERE type='NOTE'");
        jdbc.update("INSERT INTO cake_order_activity(order_id,type,content,actor_id,actor_name_snapshot,created_at)"
                + " SELECT ?::uuid,'NOTE','备注',?::uuid,'员工',now() FROM generate_series(1,10001)", id, staff.accountId);
        var tooManyRows = staff.request("POST", "/api/orders/exports/zip", range());
        assertEquals(413, tooManyRows.statusCode()); assertEquals("EXPORT_CONTENT_TOO_LARGE", body(tooManyRows).path("code").asText());
        assertEquals(0, exportCount());
    }
    @Test void noteMetadataAndDetailsCountTowardsTextBudget() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-01")));
        String id = order.path("orderId").asText(); var before = temporaryFiles();
        jdbc.update("INSERT INTO cake_order_activity(order_id,type,content,actor_id,actor_name_snapshot,created_at)"
                + " SELECT ?::uuid,'NOTE',repeat('x',850),?::uuid,repeat('😀',40),now() FROM generate_series(1,9000)", id, staff.accountId);
        assertTrue(jdbc.queryForObject("SELECT sum(octet_length(content)) FROM cake_order_activity WHERE type='NOTE'", Long.class) < 8L * 1024 * 1024);
        var metadata = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        assertEquals(413, metadata.statusCode()); assertEquals("EXPORT_CONTENT_TOO_LARGE", body(metadata).path("code").asText());
        jdbc.update("DELETE FROM cake_order_activity WHERE type='NOTE'");
        jdbc.update("INSERT INTO cake_order_activity(order_id,item_id,type,content,details,actor_id,actor_name_snapshot,created_at)"
                + " VALUES (?::uuid,?::uuid,'NOTE','备注',jsonb_build_object('legacy',repeat('字',2800000)),?::uuid,'员工',now())",
                id, order.at("/items/0/itemId").asText(), staff.accountId);
        var details = staff.request("POST", "/api/orders/exports/zip", range());
        assertEquals(413, details.statusCode()); assertEquals("EXPORT_CONTENT_TOO_LARGE", body(details).path("code").asText());
        assertEquals(0, exportCount()); assertEquals(before, temporaryFiles());
        verify(files, never()).generate(any(), anyString(), anyBoolean());
    }
    @Test void exportIsUnaffectedByDeferredActivityWriteFailure() throws Exception {
        var staff = staff(); var a = data(staff.request("POST", "/api/orders", create("2026-10-01")));
        var b = data(staff.request("POST", "/api/orders", create("2026-10-02"))); var before = temporaryFiles();
        jdbc.execute("CREATE FUNCTION reject_export_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.type='ORDER_EXPORTED' THEN RAISE EXCEPTION 'test deferred commit failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$");
        jdbc.execute("CREATE CONSTRAINT TRIGGER reject_export_commit AFTER INSERT ON cake_order_activity DEFERRABLE INITIALLY DEFERRED"
                + " FOR EACH ROW EXECUTE FUNCTION reject_export_commit()");
        var appended = new AtomicInteger();
        doAnswer(invocation -> {
            var result = invocation.callRealMethod(); appended.incrementAndGet();
            assertEquals(before.size() + 1, temporaryFiles().size()); return result;
        }).when(activities).append(argThat(activity -> activity.type().equals("ORDER_EXPORTED")));
        try {
            var response = staff.request("POST", "/api/orders/exports/zip", range());
            assertEquals(200, response.statusCode(), text(response)); assertTrue(header(response, "Content-Type").contains("application/zip"));
            assertEquals(0, appended.get()); assertEquals(0, exportCount()); assertEquals(before, temporaryFiles());
            assertEquals(a, data(staff.request("GET", "/api/orders/" + a.path("orderId").asText(), null)));
            assertEquals(b, data(staff.request("GET", "/api/orders/" + b.path("orderId").asText(), null)));
        } finally { jdbc.execute("DROP FUNCTION reject_export_commit() CASCADE"); }
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void deferredImageCommitFailureRollsBackDataActivityAndNotification(boolean removal) throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        var image = removal ? data(staff.upload(id, null, picture("png"), "kept.png")) : null;
        changes.events.clear();
        jdbc.execute("CREATE FUNCTION reject_image_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.type IN ('IMAGE_ADDED','IMAGE_REMOVED') THEN RAISE EXCEPTION 'test deferred commit failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$");
        jdbc.execute("CREATE CONSTRAINT TRIGGER reject_image_commit AFTER INSERT ON cake_order_activity DEFERRABLE INITIALLY DEFERRED"
                + " FOR EACH ROW EXECUTE FUNCTION reject_image_commit()");
        try {
            var response = removal ? staff.request("DELETE", "/api/orders/" + id + "/images/" + image.path("imageId").asText(), null)
                    : staff.upload(id, null, picture("png"), "rejected.png");
            assertEquals(503, response.statusCode(), text(response));
            assertEquals(removal ? 1 : 0, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
            assertEquals(removal ? 1 : 0, jdbc.queryForObject("SELECT count(*) FROM cake_order_image WHERE order_id=?::uuid AND NOT is_removed", Integer.class, id));
            assertEquals(removal ? 1 : 0, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type='IMAGE_ADDED'", Integer.class, id));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid AND type='IMAGE_REMOVED'", Integer.class, id));
            assertTrue(changes.events.isEmpty());
            assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
        } finally { jdbc.execute("DROP FUNCTION reject_image_commit() CASCADE"); }
    }
    @Test void exactDateAndOrderLimitsExportEveryOrderWithoutTruncation() throws Exception {
        var staff = staff(); var expected = new ArrayList<String>();
        expected.add(filename(data(staff.request("POST", "/api/orders", create("2026-10-01")))));
        for (int i = 1; i < 100; i++) expected.add(filename(data(staff.request("POST", "/api/orders", create("2026-11-11")))));
        staff.request("POST", "/api/orders", create("2026-11-12"));
        changes.events.clear(); var before = temporaryFiles();
        var exact = Map.of("from", "2026-10-01", "to", "2026-11-12");
        var names = entries(staff.request("POST", "/api/orders/exports/zip", exact));
        assertEquals(100, names.size()); assertEquals(new HashSet<>(expected), new HashSet<>(names));
        assertEquals(0, exportCount()); assertTrue(changes.events.isEmpty()); assertEquals(before, temporaryFiles());
        var longRange = staff.request("POST", "/api/orders/exports/zip", Map.of("from", "2026-10-01", "to", "2026-11-13"));
        assertEquals(400, longRange.statusCode()); assertEquals("EXPORT_LIMIT_EXCEEDED", body(longRange).path("code").asText());
        staff.request("POST", "/api/orders", create("2026-11-11")); changes.events.clear();
        var tooMany = staff.request("POST", "/api/orders/exports/zip", exact);
        assertEquals(400, tooMany.statusCode()); assertEquals("EXPORT_LIMIT_EXCEEDED", body(tooMany).path("code").asText());
        assertEquals(0, exportCount()); assertTrue(changes.events.isEmpty()); assertEquals(before, temporaryFiles());
    }
    @Test void malformedExportFiltersReturnValidationErrorsWithoutFilesOrHistory() throws Exception {
        var staff = staff(); var before = temporaryFiles();
        for (var filters : List.of(Map.of("from", "2026-02-30", "to", "2026-03-01"),
                Map.of("from", "not-a-date", "to", "2026-11-01"),
                Map.of("from", "2026-11-01", "to", "2026-10-01"),
                Map.of("from", "2026-10-01", "to", "2026-10-01"),
                Map.of("from", "2026-10-01", "to", "2026-11-01", "status", "UNKNOWN"),
                Map.of("from", "2026-10-01", "to", "2026-11-01", "fulfillmentType", "UNKNOWN"),
                Map.of("from", "2026-10-01", "to", "2026-11-01", "paymentStatus", "UNKNOWN"))) {
            var response = staff.request("POST", "/api/orders/exports/zip", filters);
            assertEquals(400, response.statusCode(), filters + ": " + text(response));
            assertEquals("VALIDATION_FAILED", body(response).path("code").asText());
        }
        assertEquals(0, exportCount()); assertEquals(before, temporaryFiles());
    }
    @Test void deferredProductionCommitFailureRollsBackOrderItemsHistoryAndNotification() throws Exception {
        var staff = staff(); var original = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = original.path("orderId").asText(); changes.events.clear();
        jdbc.execute("CREATE FUNCTION reject_production_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.type='ORDER_PRODUCTION_CHANGED' THEN RAISE EXCEPTION 'test deferred commit failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$");
        jdbc.execute("CREATE CONSTRAINT TRIGGER reject_production_commit AFTER INSERT ON cake_order_activity DEFERRABLE INITIALLY DEFERRED"
                + " FOR EACH ROW EXECUTE FUNCTION reject_production_commit()");
        try {
            var response = staff.request("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", 0, "action", "START_PRODUCTION"));
            assertEquals(503, response.statusCode(), text(response));
            assertEquals(original, data(staff.request("GET", "/api/orders/" + id, null)));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Integer.class, id));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE order_id=?::uuid AND production_status<>'NOT_STARTED'", Integer.class, id));
            assertTrue(changes.events.isEmpty());
        } finally { jdbc.execute("DROP FUNCTION reject_production_commit() CASCADE"); }
        assertEquals(200, staff.request("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", 0, "action", "START_PRODUCTION")).statusCode());
        assertEquals(1, changes.events.size());
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void revokedEmployeeStreamMustStopReceivingOrderEvents(boolean archive) throws Exception {
        var staff = staff(); var admin = new Client(); admin.login("0001", PASSWORD);
        var second = new Client(); second.login("0002", PASSWORD);
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        try (var input = stream(staff); var reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8));
                var peerInput = stream(second); var peer = new BufferedReader(new InputStreamReader(peerInput, StandardCharsets.UTF_8));
                var adminInput = stream(admin); var healthy = new BufferedReader(new InputStreamReader(adminInput, StandardCharsets.UTF_8))) {
            for (var connection : List.of(reader, peer, healthy)) assertTrue(nextStreamFrame(connection).contains("event:ready"));
            var revoked = admin.request("POST", "/api/admin/employees/" + staff.accountId + (archive ? "/archive" : "/reset-password"), null);
            assertEquals(200, revoked.statusCode(), text(revoked));
            assertEquals(401, staff.request("GET", "/api/me", null).statusCode());
            assertEquals(401, staff.request("POST", "/api/auth/refresh", null).statusCode());
            assertNull(nextStreamFrame(reader), "Revoked stream must close without waiting for another order event");
            assertNull(nextStreamFrame(peer), "Every old session for the revoked employee must close");
            assertEquals(201, admin.request("POST", "/api/orders/" + order.path("orderId").asText() + "/notes", Map.of("content", "撤销后事件")).statusCode());
            var event = nextStreamFrame(healthy); assertNotNull(event);
            assertTrue(event.contains("event:order.changed") && event.contains(order.path("orderId").asText()), event);
        }
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void failedRevocationCommitKeepsTheOriginalSessionAndStream(boolean archive) throws Exception {
        var staff = staff(); var admin = new Client(); admin.login("0001", PASSWORD);
        var original = data(staff.request("GET", "/api/me", null));
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        var auditCount = jdbc.queryForObject("SELECT count(*) FROM audit_operation", Long.class);
        jdbc.execute("CREATE FUNCTION reject_credentials_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.credential_version<>OLD.credential_version THEN RAISE EXCEPTION 'test credential commit failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$");
        jdbc.execute("CREATE CONSTRAINT TRIGGER reject_credentials_commit AFTER UPDATE ON identity_account DEFERRABLE INITIALLY DEFERRED"
                + " FOR EACH ROW EXECUTE FUNCTION reject_credentials_commit()");
        try (var input = stream(staff); var reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            assertTrue(nextStreamFrame(reader).contains("event:ready"));
            var rejected = admin.request("POST", "/api/admin/employees/" + staff.accountId + (archive ? "/archive" : "/reset-password"), null);
            assertEquals(503, rejected.statusCode(), text(rejected));
            assertEquals(original, data(staff.request("GET", "/api/me", null)));
            assertEquals(auditCount, jdbc.queryForObject("SELECT count(*) FROM audit_operation", Long.class));
            assertEquals(201, admin.request("POST", "/api/orders/" + order.path("orderId").asText() + "/notes", Map.of("content", "撤销回滚后事件")).statusCode());
            var event = nextStreamFrame(reader); assertNotNull(event); assertTrue(event.contains("event:order.changed"), event);
            assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Integer.class));
        } finally { jdbc.execute("DROP FUNCTION reject_credentials_commit() CASCADE"); }
    }
    private InputStream stream(Client client) throws Exception {
        var response = client.client.send(client.builder("/api/orders/stream", false).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
        assertEquals(200, response.statusCode()); return response.body();
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void clientDisconnectCompletesTheSseWithoutErrorLogOrJsonAndOtherClientsKeepWorking(boolean reset) throws Exception {
        var staff = staff(); var admin = new Client(); admin.login("0001", PASSWORD);
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        var completed = new CountDownLatch(1);
        doAnswer(invocation -> {
            var emitter = (org.springframework.web.servlet.mvc.method.annotation.SseEmitter) invocation.callRealMethod();
            emitter.onCompletion(completed::countDown); return emitter;
        }).when(streams).subscribe(eq(UUID.fromString(staff.accountId)), anyLong(), any(java.time.Instant.class), any(BooleanSupplier.class));
        var logger = (Logger) LoggerFactory.getLogger(ApiErrors.class); var previous = logger.getLevel(); logger.setLevel(Level.DEBUG);
        var root = (Logger) LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME); var logs = new DisconnectLogs(); logs.start(); root.addAppender(logs);
        try (var healthyInput = stream(admin); var healthy = new BufferedReader(new InputStreamReader(healthyInput, StandardCharsets.UTF_8))) {
            assertTrue(nextStreamFrame(healthy).contains("event:ready"));
            String requestId = null;
            try (var socket = new Socket("127.0.0.1", port)) {
                socket.setSoTimeout(5000); if (reset) socket.setSoLinger(true, 0);
                socket.getOutputStream().write(("GET /api/orders/stream HTTP/1.1\r\nHost: localhost:" + port
                        + "\r\nAuthorization: Bearer " + staff.token + "\r\nAccept: text/event-stream\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                socket.getOutputStream().flush(); var reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                assertTrue(reader.readLine().contains("200"));
                for (String line; (line = reader.readLine()) != null && !line.isEmpty();) {
                    if (line.toLowerCase(Locale.ROOT).startsWith("x-request-id:")) requestId = line.substring(line.indexOf(':') + 1).strip();
                }
                assertNotNull(requestId); boolean ready = false;
                for (int i = 0; i < 20; i++) { String line = reader.readLine(); if (line == null) break; if (line.contains("event:ready")) { ready = true; break; } }
                assertTrue(ready);
            }
            int notes = 0;
            do {
                notes++;
                assertEquals(201, admin.request("POST", "/api/orders/" + order.path("orderId").asText() + "/notes", Map.of("content", "断开后的正常备注" + notes)).statusCode());
                assertTrue(nextStreamFrame(healthy).contains("event:order.changed"));
            } while (completed.getCount() != 0 && notes < 3);
            assertTrue(completed.await(5, TimeUnit.SECONDS));
            String streamRequestId = requestId;
            assertTrue(logs.events.stream().anyMatch(event -> event.getLoggerName().equals(ApiErrors.class.getName())
                    && event.getLevel().equals(Level.DEBUG) && event.getFormattedMessage().contains("request_disconnected requestId=" + streamRequestId)));
            assertFalse(logs.events.stream().anyMatch(event -> event.getLevel().isGreaterOrEqual(Level.ERROR) && event.getFormattedMessage().contains(streamRequestId)));
            assertFalse(logs.events.stream().anyMatch(event -> event.getThrowableProxy() != null
                    && event.getThrowableProxy().getClassName().equals("org.springframework.http.converter.HttpMessageNotWritableException")));
            doThrow(new IllegalStateException("synthetic server failure")).when(activities).append(any());
            var failed = admin.request("POST", "/api/orders/" + order.path("orderId").asText() + "/notes", Map.of("content", "故障对照"));
            assertEquals(500, failed.statusCode()); assertEquals("INTERNAL_ERROR", body(failed).path("code").asText());
            String failureId = header(failed, "X-Request-Id"); assertFalse(failureId.isBlank());
            assertTrue(logs.events.stream().anyMatch(event -> event.getLoggerName().equals(ApiErrors.class.getName())
                    && event.getLevel().equals(Level.ERROR) && event.getFormattedMessage().contains(failureId)));
            assertEquals(1 + notes, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Integer.class));
        } finally { root.detachAppender(logs); logs.stop(); logger.setLevel(previous); reset(streams, activities); }
    }
    @Test void rolledBackSnapshotTransactionReleasesEveryCapturedImage() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        staff.upload(id, null, picture("png"), "rollback.png");
        var before = temporaryFiles();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactions);
        transaction.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
        assertThrows(IllegalStateException.class, () -> transaction.executeWithoutResult(status -> {
            snapshots.single(UUID.fromString(id));
            throw new IllegalStateException("synthetic snapshot rollback");
        }));
        assertEquals(before, temporaryFiles());
    }
    @Test void imageMetadataAndBytesStayInOneSnapshotDuringHistoricalRecompression() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText(); byte[] png = picture("png"), jpeg = picture("jpeg");
        String image = data(staff.upload(id, null, png, "snapshot.png")).path("imageId").asText();
        var readStarted = new CountDownLatch(1); var resume = new CountDownLatch(1);
        doAnswer(invocation -> {
            readStarted.countDown();
            if (!resume.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("image read did not resume");
            return invocation.callRealMethod();
        }).when(images).content(UUID.fromString(id), UUID.fromString(image));
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var exported = executor.submit(() -> staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null));
            try {
                assertTrue(readStarted.await(10, TimeUnit.SECONDS));
                jdbc.update("UPDATE cake_order_image SET content=?,content_type='image/jpeg',filename='snapshot.jpg',size=? WHERE id=?::uuid", jpeg, jpeg.length, image);
            } finally { resume.countDown(); }
            var result = exported.get(15, TimeUnit.SECONDS); assertEquals(200, result.statusCode(), text(result));
            try (var book = new XSSFWorkbook(new ByteArrayInputStream(result.body()))) {
                assertEquals(1, book.getAllPictures().size()); assertArrayEquals(png, book.getAllPictures().getFirst().getData());
                assertEquals("image/png", book.getAllPictures().getFirst().getMimeType());
            }
        } finally { reset(images); }
        assertEquals("image/jpeg", header(staff.request("GET", "/api/orders/" + id + "/images/" + image, null), "Content-Type"));
    }
    @Test void historicalProcessingIncludesRemovedImagesIsResumableAndLeavesBusinessHistoryUntouched() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        String image = data(staff.upload(id, null, picture("png"), "historical.png")).path("imageId").asText();
        staff.request("DELETE", "/api/orders/" + id + "/images/" + image, null);
        jdbc.update("UPDATE cake_order_image SET processing_version=0 WHERE id=?::uuid", image);
        var before = data(staff.request("GET", "/api/orders/" + id, null));
        long activitiesBefore = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        var uploadedAt = jdbc.queryForObject("SELECT uploaded_at FROM cake_order_image WHERE id=?::uuid", java.sql.Timestamp.class, image);
        var service = new org.xaspire.WuhouCake.order.application.service.OrderImageMaintenanceService(
                new org.xaspire.WuhouCake.order.infrastructure.persistence.repository.PostgresOrderImageMaintenance(maintenance), validator);
        var result = service.recompress(); assertEquals(1, result.processed()); assertEquals(0, result.failed());
        assertEquals(0, service.recompress().processed());
        assertEquals(before, data(staff.request("GET", "/api/orders/" + id, null)));
        assertEquals(activitiesBefore, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        assertEquals(uploadedAt, jdbc.queryForObject("SELECT uploaded_at FROM cake_order_image WHERE id=?::uuid", java.sql.Timestamp.class, image));
        assertEquals(Boolean.TRUE, jdbc.queryForObject("SELECT is_removed FROM cake_order_image WHERE id=?::uuid", Boolean.class, image));
        byte[] invalid = "synthetic corrupt image".getBytes(StandardCharsets.UTF_8);
        jdbc.update("UPDATE cake_order_image SET processing_version=0,content=?,size=? WHERE id=?::uuid", invalid, invalid.length, image);
        assertEquals(1, service.recompress().failed());
        assertArrayEquals(invalid, jdbc.queryForObject("SELECT content FROM cake_order_image WHERE id=?::uuid", byte[].class, image));
    }
    private static String nextStreamFrame(BufferedReader reader) throws Exception {
        var next = CompletableFuture.supplyAsync(() -> {
            try { return streamFrame(reader); } catch (IOException failure) { return null; }
        });
        try { return next.get(5, TimeUnit.SECONDS); }
        finally { next.cancel(true); }
    }
    private static String streamFrame(BufferedReader reader) throws IOException {
        var frame = new StringBuilder();
        for (String line; (line = reader.readLine()) != null;) {
            if (line.startsWith(":")) continue;
            if (line.isEmpty()) { if (!frame.isEmpty()) return frame.toString(); }
            else frame.append(line).append('\n');
        }
        return frame.isEmpty() ? null : frame.toString();
    }
    private int exportCount() { return jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='ORDER_EXPORTED'", Integer.class); }
    private List<String> entries(HttpResponse<byte[]> response) throws Exception {
        assertEquals(200, response.statusCode(), text(response)); var result = new ArrayList<String>();
        try (var zip = new ZipInputStream(new ByteArrayInputStream(response.body()), StandardCharsets.UTF_8)) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                result.add(entry.getName()); try (var book = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) { assertEquals(4, book.getNumberOfSheets()); }
            }
        }
        return result;
    }
    private static String filename(JsonNode order) { return order.path("orderNo").asText() + ".xlsx"; }
    private static Map<String, Object> range() { return Map.of("from", "2026-10-01", "to", "2026-11-01"); }
    private static Map<String, Object> create(String date) {
        return Map.of("customer", Map.of("customerName", "客户", "phone", "13800000000"), "totalAmountCents", 12345,
                "fulfillment", Map.of("type", "DELIVERY", "address", "地址", "requestedReceiveDate", date, "plannedHandoffAt", date + "T10:00:00+08:00"),
                "items", List.of(Map.of("name", "蛋糕", "quantity", 1, "unitPriceCents", 10000, "attributes", Map.of("size", "8", "nested", List.of(Map.of("flavor", "草莓")))),
                        Map.of("name", "纸杯", "quantity", 6)));
    }
    private Client staff() throws Exception {
        identity.initializeAdministrator("0001", "店长", INITIAL);
        var admin = new Client(); admin.login("0001", INITIAL); admin.changePassword(INITIAL); admin.login("0001", PASSWORD);
        var response = admin.request("POST", "/api/admin/employees", Map.of("employeeNumber", "0002", "nickname", "前台员工", "jobRoles", List.of("FRONT_DESK"), "systemRole", "STAFF"));
        assertEquals(201, response.statusCode(), text(response)); var provisioned = data(response);
        var staff = new Client(); staff.accountId = provisioned.at("/account/accountId").asText();
        String temporary = provisioned.path("temporaryPassword").asText(); staff.login("0002", temporary); staff.changePassword(temporary); staff.login("0002", PASSWORD); return staff;
    }
    private JsonNode body(HttpResponse<byte[]> response) throws IOException { return json.readTree(response.body()); }
    private JsonNode data(HttpResponse<byte[]> response) throws IOException { return body(response).path("data"); }
    private static String text(HttpResponse<byte[]> response) { return response.statusCode() == 200 ? "200" : new String(response.body(), StandardCharsets.UTF_8); }
    private static String header(HttpResponse<?> response, String name) { return response.headers().firstValue(name).orElse(""); }
    private static byte[] picture(String format) throws IOException {
        var image = new BufferedImage(12, 6, BufferedImage.TYPE_INT_RGB);
        try (var output = new ByteArrayOutputStream()) { assertTrue(ImageIO.write(image, format, output)); return output.toByteArray(); } finally { image.flush(); }
    }
    private static Set<String> temporaryFiles() throws IOException {
        try (var paths = Files.list(Path.of(System.getProperty("java.io.tmpdir")))) {
            return paths.map(path -> path.getFileName().toString()).filter(name -> name.startsWith("wuhoucake-export-")).collect(java.util.stream.Collectors.toSet());
        }
    }
    @TestConfiguration(proxyBeanMethods = false) static class EventsConfiguration { @Bean Changes changes() { return new Changes(); } }
    static class Changes {
        final Queue<OrderChanged> events = new ConcurrentLinkedQueue<>();
        @TransactionalEventListener public void changed(OrderChanged event) { events.add(event); }
    }
    static class DisconnectLogs extends AppenderBase<ILoggingEvent> {
        final Queue<ILoggingEvent> events = new ConcurrentLinkedQueue<>();
        @Override protected void append(ILoggingEvent event) { event.prepareForDeferredProcessing(); events.add(event); }
    }
    final class Client {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient client = HttpClient.newBuilder().cookieHandler(cookies).build();
        String token, accountId;
        void login(String number, String password) throws Exception {
            var result = request("POST", "/api/auth/login", Map.of("employeeNumber", number, "password", password));
            assertEquals(200, result.statusCode(), text(result)); token = data(result).path("accessToken").asText();
        }
        void changePassword(String current) throws Exception { assertEquals(200, request("POST", "/api/me/password", Map.of("currentPassword", current, "newPassword", PASSWORD)).statusCode()); }
        HttpResponse<byte[]> request(String method, String path, Object body) throws Exception {
            boolean auth = path.startsWith("/api/auth/");
            if (auth && !method.equals("GET")) request("GET", "/api/auth/csrf", null);
            var builder = builder(path, auth).header("Content-Type", "application/json");
            if (auth && !method.equals("GET")) cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("XSRF-TOKEN"))
                    .findFirst().ifPresent(cookie -> builder.header("X-XSRF-TOKEN", cookie.getValue()));
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(body)));
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        }
        HttpResponse<byte[]> upload(String orderId, String itemId, byte[] bytes, String filename) throws Exception {
            String boundary = "WuhouBoundary" + UUID.randomUUID(); var output = new ByteArrayOutputStream();
            if (itemId != null) output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"itemId\"\r\n\r\n" + itemId + "\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + filename
                    + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(bytes); output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            return client.send(builder("/api/orders/" + orderId + "/images", false).header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(output.toByteArray())).build(), HttpResponse.BodyHandlers.ofByteArray());
        }
        HttpRequest.Builder builder(String path, boolean auth) {
            var result = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(30));
            if (token != null && !auth) result.header("Authorization", "Bearer " + token); return result;
        }
    }
}

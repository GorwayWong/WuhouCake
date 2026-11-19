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
@org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
@org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@Import(OrderExportIT.EventsConfiguration.class)
class OrderExportIT {
    private static final String SCHEMA = "order_export_it_" + UUID.randomUUID().toString().replace("-", "");
    private static final String NAMESPACE = "wuhoucake:order-export-it:" + UUID.randomUUID();
    private static Path multipartDirectory;
    private static final String INITIAL = "Initial password for test!", PASSWORD = "Permanent password for test!";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) throws IOException {
        JwtTestKeys.properties(registry);
        multipartDirectory = Files.createTempDirectory("wuhou-tomcat-multipart-it-");
        registry.add("spring.servlet.multipart.location", () -> multipartDirectory.toString());
        registry.add("spring.flyway.default-schema", () -> SCHEMA); registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("management.endpoints.web.exposure.include", () -> "health,prometheus");
        registry.add("management.metrics.distribution.percentiles-histogram.http.server.requests", () -> "true");
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> 5);
        registry.add("spring.datasource.hikari.schema", () -> SCHEMA); registry.add("wuhoucake.identity.redis-namespace", () -> NAMESPACE);
    }
    @LocalServerPort int port;
    @Autowired org.springframework.test.web.servlet.MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired StringRedisTemplate redis;
    @Autowired IdentityService identity;
    @Autowired Changes changes;
    @Autowired ExportSnapshotMeasurements measurements;
    @Autowired javax.sql.DataSource source;

    private static final String LOAD_DATE = "2026-10-16";
    private static final String LOAD_ZIP = "/api/admin/orders/exports/zip";
    private static final Map<String, String> LOAD_FILTER = Map.of("from", LOAD_DATE, "to", "2026-10-17", "dateBasis", "RECEIVE");

    @Test
    @org.junit.jupiter.api.condition.EnabledIfSystemProperty(named = "wuhou.export.load", matches = "true")
    void measureFullExportWithConcurrentOrderCreationAndWorkbenchReads() throws Exception {
        var staff = staff();
        seedExportLoad(staff);
        var pool = source.unwrap(com.zaxxer.hikari.HikariDataSource.class).getHikariPoolMXBean();
        staff.request("POST", "/api/orders", create("2026-10-17"));
        staff.request("GET", "/api/orders/workbench/cards?date=" + LOAD_DATE, null);
        var zip = staff.request("POST", LOAD_ZIP, LOAD_FILTER);
        assertEquals(200, zip.statusCode(), text(zip));
        assertEquals(100, entries(zip).size());
        for (int round = 1; round <= 3; round++) {
            exportLoadRound(staff, pool, round, false);
            exportLoadRound(staff, pool, round, true);
        }
    }

    private void seedExportLoad(Client staff) throws Exception {
        byte[] png = picture("png");
        for (int i = 0; i < 100; i++) {
            var created = staff.request("POST", "/api/orders", create(LOAD_DATE));
            assertEquals(201, created.statusCode(), text(created));
            var order = data(created);
            String id = order.path("orderId").asText(), item = order.at("/items/0/itemId").asText();
            assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "整单备注")).statusCode());
            assertEquals(201, staff.request("POST", "/api/orders/" + id + "/notes", Map.of("content", "商品备注", "itemId", item)).statusCode());
            assertEquals(201, staff.upload(id, item, png, "reference.png").statusCode());
        }
    }

    private void exportLoadRound(Client staff, com.zaxxer.hikari.HikariPoolMXBean pool, int round, boolean withExport) throws Exception {
        var writes = new ConcurrentLinkedQueue<Long>();
        var reads = new ConcurrentLinkedQueue<Long>();
        var exports = new ConcurrentLinkedQueue<Long>();
        var errors = new ConcurrentLinkedQueue<String>();
        var peakPending = new AtomicInteger();
        var pendingSamples = new AtomicInteger();
        var busyExports = new AtomicInteger();
        measurements.samples.clear();
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        try (var workers = Executors.newVirtualThreadPerTaskExecutor();
             var scheduler = Executors.newScheduledThreadPool(1)) {
            var writeRate = scheduler.scheduleAtFixedRate(() -> workers.submit(() -> sample(writes, errors, "create", 201,
                    () -> staff.request("POST", "/api/orders", create("2026-10-17")))), 0, 250, TimeUnit.MILLISECONDS);
            var readRate = scheduler.scheduleAtFixedRate(() -> workers.submit(() -> sample(reads, errors, "workbench", 200,
                    () -> staff.request("GET", "/api/orders/workbench/cards?date=" + LOAD_DATE, null))), 0, 125, TimeUnit.MILLISECONDS);
            var pending = scheduler.scheduleAtFixedRate(() -> {
                int waiting = pool.getThreadsAwaitingConnection();
                peakPending.accumulateAndGet(waiting, Math::max);
                if (waiting > 0) pendingSamples.incrementAndGet();
            }, 0, 50, TimeUnit.MILLISECONDS);
            if (withExport) workers.submit(() -> {
                while (System.nanoTime() < end && errors.isEmpty()) {
                    long started = System.nanoTime();
                    try {
                        var response = staff.request("POST", LOAD_ZIP, LOAD_FILTER);
                        if (response.statusCode() == 200) exports.add(System.nanoTime() - started);
                        else {
                            String code = body(response).path("code").asText();
                            if (response.statusCode() == 503 && code.equals("EXPORT_BUSY")) {
                                busyExports.incrementAndGet();
                                // The client may finish reading before the server releases export admission.
                                TimeUnit.SECONDS.sleep(Long.parseLong(header(response, "Retry-After")));
                            } else errors.add("export HTTP " + response.statusCode() + " " + code);
                        }
                    } catch (Exception failure) { errors.add("export " + failure.getClass().getSimpleName()); }
                }
            });
            TimeUnit.NANOSECONDS.sleep(Math.max(0, end - System.nanoTime()));
            writeRate.cancel(false); readRate.cancel(false); pending.cancel(false);
        }
        var snapshots = List.copyOf(measurements.samples);
        System.out.printf(Locale.ROOT,
                "EXPORT_LOAD round=%d export=%b create=[%s] read=[%s] zip=[%s] snapshot=[%s] sql=%s poolPeakWaiters=%d poolWaitingSamples=%d busyExports=%d errors=%s%n",
                round, withExport, timings(writes), timings(reads), timings(exports), timings(snapshots.stream().map(ExportSnapshotMeasurements.Sample::elapsed).toList()),
                snapshots.stream().map(ExportSnapshotMeasurements.Sample::statements).distinct().sorted().toList(),
                peakPending.get(), pendingSamples.get(), busyExports.get(), errors);
        assertTrue(errors.isEmpty(), errors.toString());
        assertTrue(writes.size() >= 100 && reads.size() >= 200);
        if (withExport) assertFalse(snapshots.isEmpty());
    }

    @FunctionalInterface private interface LoadRequest { HttpResponse<byte[]> run() throws Exception; }

    private static void sample(Queue<Long> samples, Queue<String> errors, String name, int expected, LoadRequest request) {
        long start = System.nanoTime();
        try {
            var response = request.run();
            if (response.statusCode() != expected) errors.add(name + " HTTP " + response.statusCode());
            else samples.add(System.nanoTime() - start);
        } catch (Exception error) { errors.add(name + " " + error.getClass().getSimpleName()); }
    }

    private static String timings(Collection<Long> samples) {
        if (samples.isEmpty()) return "n=0";
        var sorted = samples.stream().sorted().toList();
        int size = sorted.size();
        return String.format(Locale.ROOT, "n=%d p50=%.2f p95=%.2f max=%.2f", size,
                sorted.get((size - 1) / 2) / 1e6, sorted.get((int) Math.ceil(size * .95) - 1) / 1e6, sorted.getLast() / 1e6);
    }
    @Autowired org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderImageMaintenanceMapper maintenance;
    @Autowired OrderImageValidator validator;
    @Autowired org.xaspire.WuhouCake.order.application.service.OrderImageService uploads;
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
    @AfterAll void removeTestData() throws IOException {
        reset(images, activities, files, streams); clearSessions(); jdbc.execute("DROP SCHEMA " + SCHEMA + " CASCADE");
        Files.deleteIfExists(multipartDirectory);
    }
    private void clearSessions() { var keys = redis.keys(NAMESPACE + ":*"); if (keys != null && !keys.isEmpty()) redis.delete(keys); }

    @Test void exportsPlaceLegacyPricesInSpecsWithoutWritingNewProductPrices() throws Exception {
        var staff = staff(); var input = (com.fasterxml.jackson.databind.node.ObjectNode) json.valueToTree(create("2026-10-16"));
        String cakeId = UUID.randomUUID().toString(), drinkId = UUID.randomUUID().toString();
        ((com.fasterxml.jackson.databind.node.ObjectNode) input.withArray("items").get(0)).put("itemId", cakeId).put("memberPriceCents", 9000);
        ((com.fasterxml.jackson.databind.node.ObjectNode) input.withArray("items").get(1)).put("itemId", drinkId).put("productType", "DRINK").put("unitPriceCents", 2300).put("memberPriceCents", 0);
        var created = staff.request("POST", "/api/orders", input); assertEquals(201, created.statusCode(), text(created));
        String id = data(created).path("orderId").asText();
        assertNull(jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, cakeId));
        assertNull(jdbc.queryForObject("SELECT member_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, cakeId));
        assertNull(jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, drinkId));
        jdbc.update("UPDATE cake_order_item SET unit_price_cents=12000,member_price_cents=10000 WHERE id=?::uuid", cakeId);
        jdbc.update("UPDATE cake_order_item SET unit_price_cents=2300,member_price_cents=0,attributes=jsonb_build_object('specification',?) WHERE id=?::uuid", "果汁\n少冰", drinkId);
        var detail = data(staff.request("GET", "/api/orders/" + id, null));
        for (var item : detail.path("items")) if (item.path("itemId").asText().equals(cakeId)) { assertEquals(12000, item.path("unitPriceCents").asInt()); assertEquals(10000, item.path("memberPriceCents").asInt()); }
        var workbench = data(staff.request("GET", "/api/orders/workbench?date=2026-10-16", null));
        for (var item : workbench.at("/pendingOrders/0/items")) if (item.path("itemId").asText().equals(cakeId)) assertEquals(12000, item.path("unitPriceCents").asInt());
        var revised = staff.request("PATCH", "/api/orders/" + id, Map.of("expectedVersion", 0, "itemId", cakeId, "changes", Map.of("quantity", 2)));
        assertEquals(200, revised.statusCode(), text(revised));
        long count = jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class);
        var ignored = staff.request("PATCH", "/api/orders/" + id, Map.of("expectedVersion", 1, "itemId", cakeId, "changes", Map.of("unitPriceCents", -1, "memberPriceCents", 5)));
        assertEquals(400, ignored.statusCode(), text(ignored));
        assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity", Long.class));
        assertEquals(12000L, jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, cakeId));
        var single = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null); assertEquals(200, single.statusCode(), text(single));
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(single.body()))) { assertHistoricalSpecs(book, 2, 4); }
        var batch = staff.request("POST", "/api/orders/exports/zip", range()); assertEquals(200, batch.statusCode(), text(batch));
        try (var zip = new ZipInputStream(new ByteArrayInputStream(batch.body()))) {
            assertNotNull(zip.getNextEntry()); try (var book = new XSSFWorkbook(new ByteArrayInputStream(zip.readAllBytes()))) { assertHistoricalSpecs(book, 2, 4); }
        }
        var report = staff.request("GET", "/api/admin/orders/export?from=2026-10-16&to=2026-10-17", null); assertEquals(200, report.statusCode(), text(report));
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(report.body()))) { assertHistoricalSpecs(book, 2, 10); }
        assertEquals(12000L, jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, cakeId));
        assertEquals(12345L, jdbc.queryForObject("SELECT total_amount_cents FROM cake_order WHERE id=?::uuid", Long.class, id));
        var toCake = staff.request("PATCH", "/api/orders/" + id, Map.of("expectedVersion", 1, "itemId", drinkId, "changes", Map.of("productType", "CAKE")));
        assertEquals(200, toCake.statusCode(), text(toCake));
        assertEquals(2300L, jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, drinkId));
        var toDrink = staff.request("PATCH", "/api/orders/" + id, Map.of("expectedVersion", 2, "itemId", cakeId, "changes", Map.of("productType", "DRINK")));
        assertEquals(200, toDrink.statusCode(), text(toDrink));
        assertEquals(12000L, jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE id=?::uuid", Long.class, cakeId));
        var added = staff.request("POST", "/api/orders/" + id + "/items", Map.of("expectedVersion", 3, "item", Map.of("name", "追加蛋糕", "productType", "CAKE", "quantity", 1, "unitPriceCents", 999, "memberPriceCents", 500)));
        assertEquals(201, added.statusCode(), text(added));
        assertNull(jdbc.queryForObject("SELECT unit_price_cents FROM cake_order_item WHERE name='追加蛋糕'", Long.class));
    }
    private static void assertHistoricalSpecs(XSSFWorkbook book, int typeColumn, int specificationColumn) {
        boolean cake = false, other = false;
        for (var row : book.getSheet("商品明细")) {
            if (row.getRowNum() == 0) continue;
            String specification = row.getCell(specificationColumn).getStringCellValue();
            if ("蛋糕".equals(row.getCell(typeColumn).getStringCellValue())) {
                cake = true; assertTrue(specification.contains("原商品单价：120.00 元（仅供参考）"));
            } else if ("其他".equals(row.getCell(typeColumn).getStringCellValue())) {
                other = true; assertTrue(specification.contains("果汁\n少冰"));
                assertTrue(specification.contains("原商品单价：23.00 元（仅供参考）"));
                assertTrue(specification.contains("原会员单价：0.00 元（仅供参考）"));
            }
        }
        assertTrue(cake); assertTrue(other);
    }

    @Test void stableItemIdentifiersAndImageRetriesKeepOwnershipAndFiveImagesPerItem() throws Exception {
        var staff = staff(); var input = (com.fasterxml.jackson.databind.node.ObjectNode) json.valueToTree(create("2026-10-16"));
        String first = UUID.randomUUID().toString(), second = UUID.randomUUID().toString();
        ((com.fasterxml.jackson.databind.node.ObjectNode) input.withArray("items").get(0)).put("itemId", first);
        ((com.fasterxml.jackson.databind.node.ObjectNode) input.withArray("items").get(1)).put("itemId", second);
        UUID creationId = UUID.randomUUID();
        var request = staff.builder("/api/orders", false).header("Content-Type", "application/json").header("Idempotency-Key", creationId.toString())
                .POST(HttpRequest.BodyPublishers.ofByteArray(json.writeValueAsBytes(input))).build();
        var created = data(staff.client.send(request, HttpResponse.BodyHandlers.ofByteArray()));
        String id = created.path("orderId").asText();
        assertEquals(id, data(staff.client.send(request, HttpResponse.BodyHandlers.ofByteArray())).path("orderId").asText());
        assertEquals(Set.of(first, second), Set.of(created.at("/items/0/itemId").asText(), created.at("/items/1/itemId").asText()));
        assertEquals(409, staff.request("POST", "/api/orders", input).statusCode());
        ((com.fasterxml.jackson.databind.node.ObjectNode) input.withArray("items").get(1)).put("itemId", first);
        assertEquals(400, staff.request("POST", "/api/orders", input).statusCode());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order", Integer.class));
        byte[] png = picture("png"); UUID uploadId = UUID.randomUUID();
        assertEquals(400, staff.upload(id, null, png, "missing.png", UUID.randomUUID()).statusCode());
        String imageId;
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var a = executor.submit(() -> staff.upload(id, first, png, "same.png", uploadId));
            var b = executor.submit(() -> staff.upload(id, first, png, "same.png", uploadId));
            var one = a.get(); var two = b.get();
            assertEquals(201, one.statusCode(), text(one)); assertEquals(201, two.statusCode(), text(two));
            imageId = data(one).path("imageId").asText(); assertEquals(imageId, data(two).path("imageId").asText());
        }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_image_upload", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='IMAGE_ADDED'", Integer.class));
        assertEquals(409, staff.upload(id, second, png, "same.png", uploadId).statusCode());
        assertEquals(409, staff.upload(id, first, png, "different.png", uploadId).statusCode());
        assertEquals(409, staff.upload(id, first, picture("jpeg"), "same.png", uploadId).statusCode());
        for (int i = 0; i < 4; i++) assertEquals(201, staff.upload(id, first, png, "first.png").statusCode());
        for (int i = 0; i < 5; i++) assertEquals(201, staff.upload(id, second, png, "second.png").statusCode());
        assertEquals(10, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertEquals(imageId, data(staff.upload(id, first, png, "same.png", uploadId)).path("imageId").asText());
        assertEquals(409, staff.upload(id, second, png, "sixth.png").statusCode());
        assertEquals(200, staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null).statusCode());
        assertEquals(200, staff.request("DELETE", "/api/orders/" + id + "/images/" + imageId, null).statusCode());
        assertEquals(409, staff.upload(id, first, png, "same.png", uploadId).statusCode());
        assertEquals(201, staff.upload(id, first, png, "replacement.png").statusCode());
    }

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
        var png = picture("png"); for (int i = 0; i < 4; i++) assertEquals(201, staff.upload(id, null, png, "x.png").statusCode());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var start = new CountDownLatch(1);
            var a = executor.submit(() -> { start.await(); return staff.upload(id, null, png, "a.png"); });
            var b = executor.submit(() -> { start.await(); return staff.upload(id, null, png, "b.png"); });
            start.countDown(); assertEquals(Set.of(201, 409), Set.of(a.get().statusCode(), b.get().statusCode()));
        }
        assertEquals(5, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
    }
    @Test void authenticatedUploadRejectsExtraPartsAndOversizedChunkedBodyBeforeDecoding() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String path = "/api/orders/" + order.path("orderId").asText() + "/images";
        String item = order.at("/items/0/itemId").asText();
        byte[] png = picture("png");
        String boundary = "BoundedOrderImage";
        var body = new ByteArrayOutputStream();
        body.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"itemId\"\r\n\r\n" + item
                + "\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.png\""
                + "\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        body.write(png);
        var extra = new ByteArrayOutputStream();
        body.writeTo(extra);
        extra.write(("\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"extra\"; filename=\"y.png\""
                + "\r\nContent-Type: image/png\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
        extra.write(png);
        byte[] ending = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.US_ASCII);
        extra.write(ending);
        body.write(ending);
        var request = staff.builder(path, false).header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(extra.toByteArray())).build();
        var rejected = staff.client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(400, rejected.statusCode(), text(rejected));
        assertEquals("INVALID_UPLOAD_PARTS", body(rejected).path("code").asText());
        var chunked = staff.builder(path, false).header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new java.io.SequenceInputStream(
                        new ByteArrayInputStream(body.toByteArray()), new ByteArrayInputStream(new byte[6 * 1024 * 1024])))).build();
        assertEquals(-1, chunked.bodyPublisher().orElseThrow().contentLength());
        assertEquals(413, staff.client.send(chunked, HttpResponse.BodyHandlers.ofByteArray()).statusCode());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_image", Integer.class));
        assertEquals(201, staff.upload(order.path("orderId").asText(), item, png, "accepted.png").statusCode());
    }

    @Test void rejectsUnsupportedMultipartBeforeTomcatStagesAnyPart() throws Exception {
        var anonymous = new Client();
        try (var watcher = multipartDirectory.getFileSystem().newWatchService()) {
            multipartDirectory.register(watcher, StandardWatchEventKinds.ENTRY_CREATE);
            for (String path : List.of("/api/auth/login", "/api/auth/refresh", "/api/auth/logout",
                    "/api/public/order-entries/" + UUID.randomUUID() + "/submissions")) {
                var rejected = anonymous.multipart(path, null, new byte[]{1, 2, 3}, "synthetic.bin", null);
                assertEquals(415, rejected.statusCode(), text(rejected));
                assertEquals("MULTIPART_NOT_SUPPORTED", body(rejected).path("code").asText());
            }
            assertNull(watcher.poll());
            try (var entries = Files.list(multipartDirectory)) { assertEquals(0, entries.count()); }
        }
        var noCsrf = anonymous.client.send(anonymous.builder("/api/auth/login", true)
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{}")).build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(403, noCsrf.statusCode());
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        assertEquals(201, staff.upload(order.path("orderId").asText(), null, picture("png"), "accepted.png").statusCode());
    }

    @Test void orderImageAcceptsQueryOrBodyItemIdAndRejectsAmbiguity() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String path = "/api/orders/" + order.path("orderId").asText() + "/images";
        String item = order.at("/items/0/itemId").asText();
        byte[] png = picture("png");
        assertEquals(201, staff.multipart(path + "?%69temId=" + item, null, png, "query.png", null).statusCode());
        assertEquals(201, staff.multipart(path, item, png, "body.png", null).statusCode());
        assertEquals(201, staff.multipart(path + "?itemId=" + item, item, png, "both.png", null).statusCode());
        for (String query : List.of("", "?itemId=invalid", "?itemId=" + item + "&itemId=" + item)) {
            var rejected = staff.multipart(path + query, null, png, "rejected.png", null);
            assertEquals(400, rejected.statusCode());
            assertEquals("INVALID_UPLOAD_PARTS", body(rejected).path("code").asText());
        }
        assertEquals(400, staff.multipart(path + "?itemId=" + UUID.randomUUID(), item, png, "conflict.png", null).statusCode());
        assertEquals(3, data(staff.request("GET", path, null)).size());
    }

    @Test void fullOrderAllowsIdempotentReplayAndRejectsAnotherActiveImage() throws Exception {
        var staff = staff();
        var input = (com.fasterxml.jackson.databind.node.ObjectNode) json.valueToTree(create("2026-10-16"));
        for (int i = 2; i < 10; i++) input.withArray("items").addObject().put("name", "合成商品 " + i).put("quantity", 1);
        var order = data(staff.request("POST", "/api/orders", input));
        String id = order.path("orderId").asText();
        var png = picture("png");
        for (int i = 0; i < 8; i++) {
            seedImages(id, order.at("/items/" + i + "/itemId").asText(), staff.accountId, png.length, i == 7 ? 4 : 5, false);
        }
        String first = order.at("/items/8/itemId").asText(), second = order.at("/items/9/itemId").asText();
        UUID key = UUID.randomUUID();
        var last = staff.upload(id, first, png, "last.png", key);
        assertEquals(201, last.statusCode(), text(last));
        var excessive = staff.upload(id, second, png, "excessive.png", UUID.randomUUID());
        assertEquals(409, excessive.statusCode(), text(excessive));
        assertEquals("ORDER_IMAGE_COUNT_EXCEEDED", body(excessive).path("code").asText());
        assertEquals(data(last), data(staff.upload(id, first, png, "last.png", key)));
        assertEquals("IDEMPOTENCY_KEY_CONFLICT",
                body(staff.upload(id, second, png, "last.png", key)).path("code").asText());
        assertEquals(40, jdbc.queryForObject("SELECT count(*) FROM cake_order_image", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_image_upload", Integer.class));
    }

    @Test void retainedImagesCountAgainstStorageAndExactByteLimitIsAllowed() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText(), item = order.at("/items/0/itemId").asText();
        byte[] png = picture("png");
        int mib = 1024 * 1024;
        seedImages(id, item, staff.accountId, 5 * mib, 6, true);
        seedImages(id, item, staff.accountId, 2 * mib - png.length + 1, 1, true);
        var overByOne = staff.upload(id, item, png, "limit.png", UUID.randomUUID());
        assertEquals(409, overByOne.statusCode(), text(overByOne));
        assertEquals("ORDER_IMAGE_STORAGE_EXCEEDED", body(overByOne).path("code").asText());
        assertEquals(7, jdbc.queryForObject("SELECT count(*) FROM cake_order_image", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_image_upload", Integer.class));
        jdbc.update("UPDATE cake_order_image SET content=substring(content FOR (size-1)::int), size=size-1 WHERE size < ?", 5 * mib);
        var exact = staff.upload(id, item, png, "limit.png", UUID.randomUUID());
        assertEquals(201, exact.statusCode(), text(exact));
        String image = data(exact).path("imageId").asText();
        assertEquals(200, staff.request("DELETE", "/api/orders/" + id + "/images/" + image, null).statusCode());
        assertEquals("ORDER_IMAGE_STORAGE_EXCEEDED",
                body(staff.upload(id, item, png, "replacement.png")).path("code").asText());
        assertEquals(32L * mib, jdbc.queryForObject("SELECT sum(size) FROM cake_order_image", Long.class));
        assertArrayEquals(png, jdbc.queryForObject("SELECT content FROM cake_order_image WHERE id=?::uuid", byte[].class, image));
        assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
    }

    @Test void concurrentUploadsToDifferentItemsCannotExceedStoredBytes() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        var id = UUID.fromString(order.path("orderId").asText());
        var first = UUID.fromString(order.at("/items/0/itemId").asText());
        var second = UUID.fromString(order.at("/items/1/itemId").asText());
        var author = new org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator(UUID.fromString(staff.accountId), "Fixture");
        var png = picture("png");
        int mib = 1024 * 1024;
        seedImages(id.toString(), first.toString(), staff.accountId, 5 * mib, 6, true);
        seedImages(id.toString(), first.toString(), staff.accountId, 2 * mib - png.length, 1, true);
        var arriving = new CountDownLatch(2);
        doAnswer(invocation -> {
            arriving.countDown();
            return invocation.callRealMethod();
        }).when(images).lockOrder(id);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var held = new CountDownLatch(1);
            var release = new CountDownLatch(1);
            var lock = executor.submit(() -> new org.springframework.transaction.support.TransactionTemplate(transactions)
                    .executeWithoutResult(status -> {
                        jdbc.queryForObject("SELECT id::text FROM cake_order WHERE id=? FOR UPDATE", String.class, id);
                        held.countDown();
                        try { assertTrue(release.await(10, TimeUnit.SECONDS)); }
                        catch (InterruptedException failure) { Thread.currentThread().interrupt(); throw new AssertionError(failure); }
                    }));
            assertTrue(held.await(5, TimeUnit.SECONDS));
            var a = executor.submit(() -> uploadResult(id, first, author, png));
            var b = executor.submit(() -> uploadResult(id, second, author, png));
            try { assertTrue(arriving.await(5, TimeUnit.SECONDS)); }
            finally { release.countDown(); }
            lock.get(5, TimeUnit.SECONDS);
            assertEquals(Set.of("STORED", "ORDER_IMAGE_STORAGE_EXCEEDED"),
                    new HashSet<>(List.of(a.get(5, TimeUnit.SECONDS), b.get(5, TimeUnit.SECONDS))));
        }
        assertEquals(32L * mib, jdbc.queryForObject("SELECT sum(size) FROM cake_order_image", Long.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_image_upload", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE type='IMAGE_ADDED'", Integer.class));
    }

    private String uploadResult(UUID order, UUID item, org.xaspire.WuhouCake.order.api.command.OrderCommands.Operator author, byte[] png) {
        try {
            uploads.upload(order, item, png, "race.png", author, UUID.randomUUID());
            return "STORED";
        } catch (org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure failure) {
            return failure.code();
        }
    }

    private void seedImages(String order, String item, String author, int bytes, int count, boolean removed) {
        jdbc.update("""
                INSERT INTO cake_order_image(id, order_id, item_id, content_type, filename, content, size, width, height,
                                              uploaded_by, uploader_name_snapshot, uploaded_at, is_removed)
                SELECT gen_random_uuid(), ?::uuid, ?::uuid, 'image/png', 'fixture.png',
                       decode(repeat('00', ?), 'hex'), ?, 1, 1, ?::uuid, 'Fixture', now(), ?
                  FROM generate_series(1, ?)
                """, order, item, bytes, bytes, author, removed, count);
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
        for (int i = 0; i < 4; i++) assertEquals(201, staff.upload(id, null, png, "other.png").statusCode());
        assertEquals(409, staff.upload(id, null, png, "full.png").statusCode());
        var added = data(staff.request("GET", "/api/orders/" + id + "/activities?type=IMAGE_ADDED", null));
        assertEquals(5, added.path("total").asInt());
        String another = data(staff.request("POST", "/api/orders", create("2026-10-16"))).path("orderId").asText();
        assertEquals(404, staff.request("DELETE", "/api/orders/" + another + "/images/" + imageId, null).statusCode());
        assertEquals(401, new Client().request("DELETE", path, null).statusCode());
        changes.events.clear();
        assertEquals(200, staff.request("DELETE", path, null).statusCode());
        assertEquals(200, staff.request("DELETE", path, null).statusCode());
        assertEquals(1, changes.events.size());
        assertEquals(new OrderChanged(UUID.fromString(id), UUID.fromString(item), OrderChanged.Type.IMAGE_REMOVED, 0, order.path("orderNo").asText()), changes.events.peek());
        assertEquals(404, staff.request("GET", path, null).statusCode());
        assertEquals(4, data(staff.request("GET", "/api/orders/" + id + "/images", null)).size());
        assertTrue(jdbc.queryForObject("SELECT is_removed FROM cake_order_image WHERE id=?::uuid", Boolean.class, imageId));
        assertArrayEquals(png, images.content(UUID.fromString(id), UUID.fromString(imageId)).orElseThrow());
        var removed = data(staff.request("GET", "/api/orders/" + id + "/activities?type=IMAGE_REMOVED", null));
        assertEquals(1, removed.path("total").asInt());
        var log = removed.at("/items/0");
        assertEquals(imageId, log.at("/details/imageId").asText()); assertEquals("cake.png", log.at("/details/filename").asText());
        assertEquals(item, log.path("itemId").asText()); assertEquals(staff.accountId, log.path("actorId").asText());
        assertFalse(log.path("createdAt").asText().isEmpty());
        var exported = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        try (var book = new XSSFWorkbook(new ByteArrayInputStream(exported.body()))) { assertEquals(4, book.getAllPictures().size()); }
        assertEquals(201, staff.upload(id, null, png, "replacement.png").statusCode());
        assertEquals(order, data(staff.request("GET", "/api/orders/" + id, null)));
        assertEquals(6, jdbc.queryForObject("SELECT count(*) FROM cake_order_image WHERE order_id=?::uuid", Integer.class, id));
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
        }).when(files).generate(any(), anyString(), eq(false), any());
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
        var filtered = new LinkedHashMap<String, Object>(range()); filtered.put("status", "CAKE_BASE"); filtered.put("paymentStatus", "UNPAID"); filtered.put("fulfillmentType", "DELIVERY");
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
        }).when(files).generate(any(), anyString(), eq(false), any());
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
    @Test void batchSnapshotsKeepSelectionOrderContentAndTransactionIsolation() throws Exception {
        var staff = staff();
        var later = data(staff.request("POST", "/api/orders", create("2026-10-02")));
        var earlier = data(staff.request("POST", "/api/orders", create("2026-10-01")));
        String id = earlier.path("orderId").asText(), active = earlier.at("/items/0/itemId").asText();
        String removed = earlier.at("/items/1/itemId").asText(), path = "/api/orders/" + id;
        assertEquals(201, staff.request("POST", path + "/notes", Map.of("content", "整单")).statusCode());
        for (int i = 0; i < 4; i++) {
            assertEquals(201, staff.request("POST", path + "/notes", Map.of("itemId", active, "content", "保留顺序 " + i)).statusCode());
        }
        assertEquals(201, staff.request("POST", path + "/notes", Map.of("itemId", removed, "content", "已移除商品")).statusCode());
        byte[] png = picture("png");
        var image = data(staff.upload(id, active, png, "before.png")).path("imageId").asText();
        assertEquals(201, staff.upload(id, removed, png, "removed.png").statusCode());
        assertEquals(200, staff.request("POST", path + "/items/" + removed + "/remove", Map.of("expectedVersion", 0)).statusCode());
        var expected = snapshots.single(UUID.fromString(id)).getFirst();
        assertEquals(List.of("整单", "保留顺序 3", "保留顺序 2", "保留顺序 1"),
                expected.notes().stream().map(note -> note.content()).toList());
        assertEquals(List.of(image), expected.images().stream().map(row -> row.imageId().toString()).toList());

        try (var concurrent = Executors.newVirtualThreadPerTaskExecutor()) {
            doAnswer(invocation -> {
                assertEquals(1, concurrent.submit(() -> jdbc.update(
                        "UPDATE cake_order_image SET is_removed=true WHERE id=?::uuid", image)).get(5, TimeUnit.SECONDS));
                return invocation.callRealMethod();
            }).when(images).listForOrders(anyList());
            var filter = new OrderExportQueries.Filter(java.time.LocalDate.parse("2026-10-01"),
                    java.time.LocalDate.parse("2026-10-03"), null, null, null);
            var batch = snapshots.batch(filter);
            assertEquals(List.of(id, later.path("orderId").asText()), batch.stream().map(row -> row.order().id().toString()).toList());
            assertEquals(expected.notes(), batch.getFirst().notes());
            assertEquals(expected.images(), batch.getFirst().images());
            assertEquals(expected.order().activeItems().stream().map(item -> item.itemId()).toList(),
                    batch.getFirst().order().activeItems().stream().map(item -> item.itemId()).toList());
        }
        assertTrue(snapshots.single(UUID.fromString(id)).getFirst().images().isEmpty());
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
        verify(files, never()).generate(any(), anyString(), anyBoolean(), any());
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
        var paths = List.of("/api/orders/exports/zip", LOAD_ZIP);
        var oneOrder = Map.of("from", "2026-10-01", "to", "2026-10-02");
        var counts = new HashMap<String, Integer>();
        for (String path : paths) {
            assertSnapshotQueries(staff, path, oneOrder, 1);
            counts.put(path, measurements.samples.element().statements());
        }
        for (int i = 1; i < 100; i++) expected.add(filename(data(staff.request("POST", "/api/orders", create("2026-11-11")))));
        staff.request("POST", "/api/orders", create("2026-11-12"));
        changes.events.clear(); var before = temporaryFiles();
        var exact = Map.of("from", "2026-10-01", "to", "2026-11-12");
        // Each ZIP path has one snapshot; compare one order with the full 100-order range.
        for (String path : paths) {
            var full = assertSnapshotQueries(staff, path, exact, 100);
            assertEquals(new HashSet<>(expected), new HashSet<>(full));
            assertEquals(counts.get(path).intValue(), measurements.samples.element().statements(), path);
        }
        assertEquals(0, exportCount()); assertTrue(changes.events.isEmpty()); assertEquals(before, temporaryFiles());
        var longRange = staff.request("POST", "/api/orders/exports/zip", Map.of("from", "2026-10-01", "to", "2026-11-13"));
        assertEquals(400, longRange.statusCode()); assertEquals("EXPORT_LIMIT_EXCEEDED", body(longRange).path("code").asText());
        staff.request("POST", "/api/orders", create("2026-11-11")); changes.events.clear();
        var tooMany = staff.request("POST", "/api/orders/exports/zip", exact);
        assertEquals(400, tooMany.statusCode()); assertEquals("EXPORT_LIMIT_EXCEEDED", body(tooMany).path("code").asText());
        assertEquals(0, exportCount()); assertTrue(changes.events.isEmpty()); assertEquals(before, temporaryFiles());
    }
    private List<String> assertSnapshotQueries(Client staff, String path, Map<String, String> filter, int size) throws Exception {
        measurements.samples.clear();
        var response = staff.request("POST", path, filter);
        assertEquals(200, response.statusCode(), text(response));
        var names = entries(response);
        assertEquals(size, names.size());
        assertEquals(1, measurements.samples.size());
        int count = measurements.samples.element().statements();
        assertTrue(count > 0 && count <= 8, () -> path + " executed " + count + " snapshot statements");
        return names;
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
        String id = original.path("orderId").asText();
        var manager = new Client(); manager.login("0001", PASSWORD);
        changes.events.clear();
        jdbc.execute("CREATE FUNCTION reject_production_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
                + " IF NEW.type='ORDER_PRODUCTION_CHANGED' THEN RAISE EXCEPTION 'test deferred commit failure' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$");
        jdbc.execute("CREATE CONSTRAINT TRIGGER reject_production_commit AFTER INSERT ON cake_order_activity DEFERRABLE INITIALLY DEFERRED"
                + " FOR EACH ROW EXECUTE FUNCTION reject_production_commit()");
        try {
            var response = manager.request("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", 0, "action", "COMPLETE_BASE"));
            assertEquals(503, response.statusCode(), text(response));
            assertEquals("SERVICE_UNAVAILABLE", json.readTree(response.body()).path("code").asText());
            assertEquals(original, data(staff.request("GET", "/api/orders/" + id, null)));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cake_order_activity WHERE order_id=?::uuid", Integer.class, id));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cake_order_item WHERE order_id=?::uuid AND production_status<>'NOT_STARTED'", Integer.class, id));
            assertTrue(changes.events.isEmpty());
        } finally { jdbc.execute("DROP FUNCTION reject_production_commit() CASCADE"); }
        assertEquals(200, manager.request("POST", "/api/orders/" + id + "/production-actions", Map.of("expectedVersion", 0, "action", "COMPLETE_BASE")).statusCode());
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
    @Test void immutableImageCopyDoesNotHoldMetadataTransactionAndMissingContentCancelsDownload() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        UUID id = UUID.fromString(order.path("orderId").asText());
        UUID image = UUID.fromString(data(staff.upload(id.toString(), null, picture("png"), "captured.png")).path("imageId").asText());
        var before = temporaryFiles();
        doAnswer(invocation -> {
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive(), "immutable BYTEA read holds metadata transaction");
            return invocation.callRealMethod();
        }).when(images).content(id, image);
        var path = "/api/orders/" + id + "/exports/xlsx";
        var copied = staff.request("POST", path, null);
        assertEquals(200, copied.statusCode(), text(copied));
        try (var workbook = new XSSFWorkbook(new ByteArrayInputStream(copied.body()))) {
            assertEquals(1, workbook.getAllPictures().size());
        }
        doAnswer(invocation -> {
            jdbc.update("DELETE FROM cake_order_image WHERE id=?", image);
            return invocation.callRealMethod();
        }).when(images).content(id, image);
        var missing = staff.request("POST", path, null);
        assertEquals(404, missing.statusCode(), text(missing));
        assertEquals("IMAGE_NOT_FOUND", body(missing).path("code").asText());
        assertEquals("", header(missing, "Content-Disposition"));
        assertEquals(before, temporaryFiles());
    }

    @Test void unauthorizedDownloadDoesNotCompeteForAnActiveExport() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        var path = "/api/orders/" + order.path("orderId").asText() + "/exports/xlsx";
        var entered = new CountDownLatch(1);
        var resume = new CountDownLatch(1);
        doAnswer(invocation -> {
            entered.countDown();
            assertTrue(resume.await(10, TimeUnit.SECONDS));
            return invocation.callRealMethod();
        }).when(files).generate(any(), anyString(), eq(false), any());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var active = executor.submit(() -> staff.request("POST", path, null));
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                assertEquals(401, new Client().request("POST", path, null).statusCode());
                var busy = staff.request("POST", path, null);
                assertEquals(503, busy.statusCode(), text(busy));
                assertEquals("EXPORT_BUSY", body(busy).path("code").asText());
            } finally { resume.countDown(); }
            assertEquals(200, active.get(10, TimeUnit.SECONDS).statusCode());
        }
        assertEquals(200, staff.request("POST", path, null).statusCode());
    }

    @Test void prometheusExposesBoundedInfrastructureMetricsOnLoopback() throws Exception {
        var remote = mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/actuator/prometheus")
                .header("X-Forwarded-For", "127.0.0.1").with(request -> {
                    request.setRemoteAddr("192.0.2.10");
                    return request;
                })).andReturn().getResponse();
        assertEquals(401, remote.getStatus());
        var client = new Client();
        assertEquals(200, client.request("GET", "/actuator/health", null).statusCode());
        var response = client.request("GET", "/actuator/prometheus", null);
        assertEquals(200, response.statusCode(), text(response));
        String metrics = new String(response.body(), StandardCharsets.UTF_8);
        assertTrue(metrics.contains("jvm_memory_used_bytes"));
        assertTrue(metrics.contains("hikaricp_connections_active"));
        assertTrue(metrics.contains("wuhou_uploads_active"));
        assertTrue(metrics.contains("wuhou_sse_connections"));
        assertTrue(metrics.contains("wuhou_temp_reserved_bytes"));
        assertTrue(metrics.contains("tomcat_threads_current_threads"));
        assertTrue(metrics.contains("http_server_requests_seconds_bucket"));
        assertFalse(metrics.contains("orderId="));
        assertFalse(metrics.contains("employeeId="));
        assertFalse(metrics.contains("requestId="));
    }

    @Test void legacyMetadataSnapshotDoesNotStageBytesAndRecompressionBeforeCopyCancelsExport() throws Exception {
        var staff = staff();
        var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText();
        String image = data(staff.upload(id, null, picture("png"), "before.png")).path("imageId").asText();
        byte[] original = picture("png");
        original = Arrays.copyOf(original, original.length + 4096);
        jdbc.update("UPDATE cake_order_image SET processing_version=0,content=?,size=? WHERE id=?::uuid",
                original, original.length, image);
        var before = temporaryFiles();
        var snapshot = snapshots.single(UUID.fromString(id));
        assertEquals(1, snapshot.getFirst().images().size());
        assertEquals(before, temporaryFiles());
        var recompressed = picture("jpeg");
        doAnswer(invocation -> {
            assertEquals(1, maintenance.replace(image, recompressed, "image/jpeg", "after.jpg", recompressed.length, 12, 6));
            return invocation.callRealMethod();
        }).when(files).generate(any(), anyString(), eq(false), any());
        var result = staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null);
        assertEquals(409, result.statusCode(), text(result));
        assertEquals("EXPORT_IMAGE_CHANGED", body(result).path("code").asText());
        assertEquals("", header(result, "Content-Disposition"));
        assertEquals(before, temporaryFiles());
    }

    @Test void rolledBackSnapshotTransactionReleasesEveryCapturedImage() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16"))); String id = order.path("orderId").asText();
        staff.upload(id, null, picture("png"), "rollback.png");
        jdbc.update("UPDATE cake_order_image SET processing_version=0 WHERE order_id=?::uuid", id);
        var before = temporaryFiles();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactions);
        transaction.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
        assertThrows(IllegalStateException.class, () -> transaction.executeWithoutResult(status -> {
            snapshots.single(UUID.fromString(id));
            assertEquals(before, temporaryFilesUnchecked());
            throw new IllegalStateException("synthetic snapshot rollback");
        }));
        assertEquals(before, temporaryFiles());
    }
    @Test void imageMetadataAndBytesStayInOneSnapshotDuringHistoricalRecompression() throws Exception {
        var staff = staff(); var order = data(staff.request("POST", "/api/orders", create("2026-10-16")));
        String id = order.path("orderId").asText(); byte[] png = picture("png"), jpeg = picture("jpeg");
        String image = data(staff.upload(id, null, png, "snapshot.png")).path("imageId").asText();
        byte[] original = Arrays.copyOf(png, png.length + 4096);
        jdbc.update("UPDATE cake_order_image SET processing_version=0,content=?,size=? WHERE id=?::uuid",
                original, original.length, image);
        var readStarted = new CountDownLatch(1); var resume = new CountDownLatch(1);
        doAnswer(invocation -> {
            assertTrue(TransactionSynchronizationManager.isActualTransactionActive());
            readStarted.countDown();
            if (!resume.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("image read did not resume");
            return invocation.callRealMethod();
        }).when(images).content(UUID.fromString(id), UUID.fromString(image));
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var exported = executor.submit(() -> staff.request("POST", "/api/orders/" + id + "/exports/xlsx", null));
            try {
                assertTrue(readStarted.await(10, TimeUnit.SECONDS));
                assertEquals(1, maintenance.replace(image, jpeg, "image/jpeg", "snapshot.jpg", jpeg.length, 12, 6));
            } finally { resume.countDown(); }
            var result = exported.get(15, TimeUnit.SECONDS); assertEquals(200, result.statusCode(), text(result));
            try (var book = new XSSFWorkbook(new ByteArrayInputStream(result.body()))) {
                assertEquals(1, book.getAllPictures().size()); assertArrayEquals(original, book.getAllPictures().getFirst().getData());
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
        byte[] original = jdbc.queryForObject("SELECT content FROM cake_order_image WHERE id=?::uuid", byte[].class, image);
        String metadataQuery = "SELECT filename,content_type,size,width,height,processing_version FROM cake_order_image WHERE id=?::uuid";
        var originalMetadata = jdbc.queryForMap(metadataQuery, image);
        for (int length : new int[]{original.length, original.length + 1}) {
            assertEquals(0, maintenance.replace(image, Arrays.copyOf(original, length), "image/jpeg", "replacement.jpg", length, 1, 1));
            var skip = new org.xaspire.WuhouCake.order.application.service.OrderImageMaintenanceService(
                    new org.xaspire.WuhouCake.order.infrastructure.persistence.repository.PostgresOrderImageMaintenance(maintenance),
                    (bytes, filename) -> new OrderImageValidator.Checked("image/jpeg", "replacement.jpg", 1, 1, Arrays.copyOf(bytes, length)));
            assertEquals(new org.xaspire.WuhouCake.order.application.service.OrderImageMaintenanceService.Result(0, 1, 0, 0, 0), skip.recompress());
        }
        assertArrayEquals(original, jdbc.queryForObject("SELECT content FROM cake_order_image WHERE id=?::uuid", byte[].class, image));
        assertEquals(originalMetadata, jdbc.queryForMap(metadataQuery, image));
        byte[] padded = Arrays.copyOf(original, original.length + 4096);
        jdbc.update("UPDATE cake_order_image SET content=?,size=? WHERE id=?::uuid", padded, padded.length, image);
        var result = service.recompress(); assertEquals(1, result.processed()); assertEquals(0, result.failed());
        assertTrue(result.storedBytes() < result.originalBytes());
        assertEquals(0, maintenance.replace(image, new byte[]{1}, "image/jpeg", "stale.jpg", 1, 1, 1));
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
    private static Set<String> temporaryFilesUnchecked() {
        try { return temporaryFiles(); }
        catch (IOException failure) { throw new java.io.UncheckedIOException(failure); }
    }
    private static Set<String> temporaryFiles() throws IOException {
        try (var paths = Files.list(Path.of(System.getProperty("java.io.tmpdir")))) {
            return paths.map(path -> path.getFileName().toString()).filter(name -> name.startsWith("wuhoucake-export-")).collect(java.util.stream.Collectors.toSet());
        }
    }
    @TestConfiguration(proxyBeanMethods = false) static class EventsConfiguration {
        @Bean Changes changes() { return new Changes(); }
        @Bean ExportSnapshotMeasurements exportSnapshotMeasurements() { return new ExportSnapshotMeasurements(); }
    }
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
            if (itemId == null) itemId = data(request("GET", "/api/orders/" + orderId, null)).at("/items/0/itemId").asText(UUID.randomUUID().toString());
            return upload(orderId, itemId, bytes, filename, null);
        }
        HttpResponse<byte[]> upload(String orderId, String itemId, byte[] bytes, String filename, UUID requestId) throws Exception {
            return multipart("/api/orders/" + orderId + "/images", itemId, bytes, filename, requestId);
        }
        HttpResponse<byte[]> multipart(String path, String itemId, byte[] bytes, String filename, UUID requestId) throws Exception {
            String boundary = "WuhouBoundary" + UUID.randomUUID(); var output = new ByteArrayOutputStream();
            if (itemId != null) output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"itemId\"\r\n\r\n" + itemId + "\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + filename
                    + "\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(bytes); output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            var request = builder(path, false).header("Content-Type", "multipart/form-data; boundary=" + boundary);
            if (requestId != null) request.header("Idempotency-Key", requestId.toString());
            return client.send(request.POST(HttpRequest.BodyPublishers.ofByteArray(output.toByteArray())).build(), HttpResponse.BodyHandlers.ofByteArray());
        }
        HttpRequest.Builder builder(String path, boolean auth) {
            var result = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(30));
            if (token != null && !auth) result.header("Authorization", "Bearer " + token); return result;
        }
    }
}

package org.xaspire.WuhouCake.order.infrastructure.files;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.zip.*;
import javax.imageio.ImageIO;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderFilesTest {
    private static final Instant NOW = Instant.parse("2026-10-16T02:00:00Z");
    private final OrderImages images = mock(OrderImages.class);
    private final PoiOrderExportFiles files = new PoiOrderExportFiles(images, new JsonCodec(new ObjectMapper()));

    @Test void validatesActualFormatAndSafeName() throws Exception {
        var validator = new JavaOrderImageValidator();
        for (var format : List.of("png", "jpeg")) {
            var checked = validator.validate(picture(format, 12, 6), "../unsafe\\photo\r\n.exe");
            assertEquals("image/" + format, checked.contentType()); assertEquals(12, checked.width()); assertEquals(6, checked.height());
            assertEquals("photo.exe", checked.filename());
        }
    }
    @Test void rejectsEmptyOversizedUnsupportedCorruptAndHugeImages() throws Exception {
        var validator = new JavaOrderImageValidator();
        assertEquals("INVALID_IMAGE", assertThrows(OrderFailure.class, () -> validator.validate(new byte[0], "a")).code());
        assertEquals("IMAGE_TOO_LARGE", assertThrows(OrderFailure.class,
                () -> validator.validate(new byte[OrderFileLimits.IMAGE_BYTES + 1], "a")).code());
        assertEquals("UNSUPPORTED_IMAGE_FORMAT", assertThrows(OrderFailure.class, () -> validator.validate("RIFFwebp".getBytes(), "a.png")).code());
        assertEquals("UNSUPPORTED_IMAGE_FORMAT", assertThrows(OrderFailure.class, () -> validator.validate(picture("gif", 2, 2), "a.png")).code());
        assertEquals("IMAGE_DIMENSIONS_EXCEEDED", assertThrows(OrderFailure.class,
                () -> validator.validate(picture("png", 8193, 1), "a")).code());
        var oversizedPixels = picture("png", 2, 2); var header = java.nio.ByteBuffer.wrap(oversizedPixels);
        header.putInt(16, 8000).putInt(20, 4000); var crc = new CRC32(); crc.update(oversizedPixels, 12, 17); header.putInt(29, (int) crc.getValue());
        assertEquals("IMAGE_DIMENSIONS_EXCEEDED", assertThrows(OrderFailure.class,
                () -> validator.validate(oversizedPixels, "a.png")).code());
        var png = picture("png", 12, 6);
        assertThrows(OrderFailure.class, () -> validator.validate(Arrays.copyOf(png, png.length / 2), "a.png"));
        var jpeg = picture("jpeg", 12, 6);
        assertThrows(OrderFailure.class, () -> validator.validate(Arrays.copyOf(jpeg, jpeg.length - 12), "a.jpg"));
    }
    @Test void workbookPreservesFieldsJsonTextAndEmbeddedPictures() throws Exception {
        var order = order("0000013"); var item = order.activeItems().getFirst();
        var random = new Random(7); var text = new StringBuilder("备注😀");
        for (int i = 0; i < 70000; i++) text.append((char) ('一' + random.nextInt(4000)));
        var longNote = text.toString();
        var note = OrderActivity.append(order.id(), item.itemId(), "NOTE", longNote, Map.of(), new Actor(UUID.randomUUID(), "员工"), NOW);
        var png = picture("png", 1200, 600); var jpeg = picture("jpeg", 12, 6);
        var first = image(order, null, "image/png", png); var second = image(order, item.itemId(), "image/jpeg", jpeg);
        when(images.content(order.id(), first.imageId())).thenReturn(Optional.of(png));
        when(images.content(order.id(), second.imageId())).thenReturn(Optional.of(jpeg));
        var file = files.generate(List.of(new OrderExportFiles.Snapshot(order, List.of(note), List.of(first, second))), "ignored.xlsx", false);
        try (var input = Files.newInputStream(Path.of(file.path())); var book = new XSSFWorkbook(input)) {
            assertEquals("订单-0000013.xlsx", file.filename()); assertEquals(4, book.getNumberOfSheets());
            assertEquals("=客户", book.getSheet("订单").getRow(7).getCell(1).getStringCellValue());
            var values = allText(book.getSheet("订单")); assertTrue(values.contains("2026-10-16 10:00:00")); assertTrue(values.contains("123.45"));
            var product = book.getSheet("商品").getRow(1);
            assertEquals("=蛋糕", product.getCell(1).getStringCellValue()); assertEquals(CellType.STRING, product.getCell(1).getCellType());
            assertEquals("1.01", product.getCell(4).getStringCellValue()); assertEquals("", product.getCell(5).getStringCellValue());
            assertEquals(Map.of("nested", Map.of("flavors", List.of("草莓", "芒果")), "base", "原味", "filling", "芒果"), new ObjectMapper().readValue(product.getCell(6).getStringCellValue(), Map.class));
            var restored = new StringBuilder();
            for (var row : book.getSheet("备注")) if (row.getRowNum() > 0) restored.append(row.getCell(2).getStringCellValue());
            assertEquals(longNote, restored.toString()); assertEquals(2, book.getAllPictures().size());
            assertArrayEquals(png, book.getAllPictures().getFirst().getData());
            var shapes = book.getSheet("图片").getDrawingPatriarch().getShapes(); assertEquals(2, shapes.size());
            var a = (ClientAnchor) shapes.getFirst().getAnchor(); var b = (ClientAnchor) shapes.getLast().getAnchor();
            assertTrue(a.getRow2() < b.getRow1());
        } finally { files.delete(file); }
        assertFalse(Files.exists(Path.of(file.path())));
    }
    @Test void zipUsesSameWorkbookAndSupportsOrdersWithoutImages() throws Exception {
        var data = List.of(new OrderExportFiles.Snapshot(order("0000001"), List.of(), List.of()),
                new OrderExportFiles.Snapshot(order("0000002"), List.of(), List.of()));
        var file = files.generate(data, "orders.zip", true);
        try (var archive = new ZipFile(file.path())) {
            assertEquals(2, archive.size());
            for (var entry : Collections.list(archive.entries())) {
                assertFalse(entry.getName().contains("/"));
                try (var book = new XSSFWorkbook(archive.getInputStream(entry))) { assertEquals(4, book.getNumberOfSheets()); assertTrue(book.getAllPictures().isEmpty()); }
            }
        } finally { files.delete(file); }
    }
    @Test void outputLimitAndRenderingFailureAreExplicitAndCleanTemporaryFiles() throws Exception {
        var output = new PoiOrderExportFiles.BoundedOutputStream(new ByteArrayOutputStream(), 3);
        output.write(new byte[3]);
        assertEquals("EXPORT_FILE_TOO_LARGE", assertThrows(OrderFailure.class, () -> output.write(1)).code());
        var order = order("0000001"); var image = image(order, null, "image/png", new byte[1]);
        when(images.content(any(), any())).thenReturn(Optional.empty());
        var before = temporaryFiles();
        assertThrows(OrderFailure.class, () -> files.generate(List.of(new OrderExportFiles.Snapshot(order, List.of(), List.of(image))), "a.zip", true));
        assertEquals(before, temporaryFiles());
    }
    @Test void actualWorkbookAndArchiveSizeFailuresRetainTheirErrorAndCleanFiles() throws Exception {
        var data = List.of(new OrderExportFiles.Snapshot(order("0000001"), List.of(), List.of()));
        for (var limits : List.of(new long[] {512, OrderFileLimits.ZIP_BYTES}, new long[] {OrderFileLimits.XLSX_BYTES, 512})) {
            var bounded = new PoiOrderExportFiles(images, new JsonCodec(new ObjectMapper()), limits[0], limits[1]);
            for (boolean zip : List.of(false, true)) {
                if (!zip && limits[0] != 512) continue;
                var before = temporaryFiles();
                try {
                    assertEquals("EXPORT_FILE_TOO_LARGE", assertThrows(OrderFailure.class,
                            () -> bounded.generate(data, zip ? "orders.zip" : "order.xlsx", zip)).code());
                } finally { assertEquals(before, temporaryFiles()); }
            }
        }
        var generated = files.generate(data, "orders.zip", true);
        long finalSize = generated.size(); files.delete(generated);
        var before = temporaryFiles();
        var bounded = new PoiOrderExportFiles(images, new JsonCodec(new ObjectMapper()), OrderFileLimits.XLSX_BYTES, finalSize - 64);
        assertEquals("EXPORT_FILE_TOO_LARGE", assertThrows(OrderFailure.class, () -> bounded.generate(data, "orders.zip", true)).code());
        assertEquals(before, temporaryFiles());
    }
    static Set<String> temporaryFiles() throws IOException {
        try (var paths = Files.list(Path.of(System.getProperty("java.io.tmpdir")))) {
            return paths.map(path -> path.getFileName().toString()).filter(name -> name.startsWith("wuhoucake-export-")).collect(java.util.stream.Collectors.toSet());
        }
    }
    private static String allText(Sheet sheet) {
        var text = new StringBuilder(); for (var row : sheet) for (var cell : row) text.append(cell.getStringCellValue()).append('\n'); return text.toString();
    }
    private static OrderImage image(Order order, UUID itemId, String mime, byte[] data) {
        return new OrderImage(UUID.randomUUID(), order.id(), itemId, mime, "参考", data.length, 1200, 600, UUID.randomUUID(), "员工", NOW);
    }
    private static Order order(String number) {
        var item = OrderItem.create(UUID.randomUUID(), "=蛋糕", "CAKE", 2, 101L, null, Map.of("nested", Map.of("flavors", List.of("草莓", "芒果"))), NOW);
        return Order.create(UUID.randomUUID(), number, new CustomerContact("=客户", "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.DELIVERY, "地址", LocalDate.of(2026, 10, 16), NOW, null), 12345L, List.of(item), UUID.randomUUID(), NOW);
    }
    private static byte[] picture(String format, int width, int height) throws IOException {
        var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        try (var output = new ByteArrayOutputStream()) { assertTrue(ImageIO.write(image, format, output)); return output.toByteArray(); }
        finally { image.flush(); }
    }
}

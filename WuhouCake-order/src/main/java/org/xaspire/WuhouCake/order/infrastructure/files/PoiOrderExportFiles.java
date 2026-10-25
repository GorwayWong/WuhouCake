package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.util.Units;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.*;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public final class PoiOrderExportFiles implements OrderExportFiles {
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.of("Asia/Shanghai"));
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private final OrderImages images;
    private final long xlsxLimit;
    private final long zipLimit;
    public PoiOrderExportFiles(OrderImages images) { this(images, XLSX_BYTES, ZIP_BYTES); }
    PoiOrderExportFiles(OrderImages images, long xlsxLimit, long zipLimit) {
        this.images = images; this.xlsxLimit = xlsxLimit; this.zipLimit = zipLimit;
    }

    @Override public File generate(List<Snapshot> snapshots, String filename, boolean zip) {
        Path path = null;
        try {
            path = Files.createTempFile("wuhoucake-export-", zip ? ".zip" : ".xlsx");
            try (var output = new BoundedOutputStream(Files.newOutputStream(path), zip ? zipLimit : xlsxLimit)) {
                if (zip) {
                    try (var archive = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
                        for (var snapshot : snapshots) {
                            archive.putNextEntry(new ZipEntry(orderFilename(snapshot)));
                            workbook(snapshot, new BoundedOutputStream(archive, xlsxLimit));
                            archive.closeEntry();
                        }
                    }
                } else workbook(snapshots.getFirst(), output);
            }
            String name = zip ? filename : "订单-" + orderFilename(snapshots.getFirst());
            return new File(path.toString(), name, zip ? "application/zip" : XLSX, Files.size(path));
        } catch (IOException | RuntimeException failure) {
            var propagated = exportFailure(failure);
            cleanup(path, propagated); throw propagated;
        } catch (Error failure) { cleanup(path, failure); throw failure; }
    }
    @Override public void delete(File file) {
        try { Files.deleteIfExists(Path.of(file.path())); }
        catch (IOException failure) { throw new UncheckedIOException("订单导出临时文件清理失败", failure); }
    }
    @Override public Snapshot captureImages(Snapshot snapshot) {
        var captured = new LinkedHashMap<UUID, String>();
        try {
            for (var image : snapshot.images()) {
                byte[] content = images.content(image.orderId(), image.imageId()).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND"));
                Path path = Files.createTempFile("wuhoucake-export-image-", ".bin");
                captured.put(image.imageId(), path.toString());
                Files.write(path, content);
            }
            return new Snapshot(snapshot.order(), snapshot.notes(), snapshot.images(), captured);
        } catch (IOException | RuntimeException failure) {
            for (String path : captured.values()) cleanup(Path.of(path), failure);
            throw failure instanceof RuntimeException runtime ? runtime : new UncheckedIOException((IOException) failure);
        } catch (Error failure) {
            for (String path : captured.values()) cleanup(Path.of(path), failure);
            throw failure;
        }
    }
    @Override public void releaseImages(List<Snapshot> snapshots) {
        IOException failure = null;
        for (var snapshot : snapshots) for (String path : snapshot.imageFiles().values()) {
            try { Files.deleteIfExists(Path.of(path)); }
            catch (IOException cleanup) {
                if (failure == null) failure = new IOException("订单图片快照临时文件清理失败");
                failure.addSuppressed(cleanup);
            }
        }
        if (failure != null) throw new UncheckedIOException(failure);
    }
    private static void cleanup(Path path, Throwable failure) {
        if (path != null) try { Files.deleteIfExists(path); } catch (IOException cleanup) { failure.addSuppressed(cleanup); }
    }
    private static RuntimeException exportFailure(Exception failure) {
        // POI 会包装写出异常，恢复大小上限错误，供现有 HTTP 错误映射返回 413。
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof OrderFailure limit && limit.code().equals("EXPORT_FILE_TOO_LARGE")) {
                if (cause != failure) for (var suppressed : failure.getSuppressed()) limit.addSuppressed(suppressed);
                return limit;
            }
        }
        return failure instanceof RuntimeException runtime ? runtime : new UncheckedIOException("订单导出文件生成失败", (IOException) failure);
    }
    private static String orderFilename(Snapshot snapshot) {
        var number = snapshot.order().orderNo();
        if (!number.matches("[0-9]+")) number = snapshot.order().id().toString();
        return number + ".xlsx";
    }
    private void workbook(Snapshot snapshot, OutputStream output) throws IOException {
        try (var book = new XSSFWorkbook()) {
            var order = snapshot.order(); var customer = order.customer(); var plan = order.fulfillment();
            var info = sheet(book, "订单信息", "项目", "内容");
            info.setColumnWidth(0, 22 * 256); info.setColumnWidth(1, 64 * 256);
            row(info, "订单号", order.orderNo());
            row(info, "订单状态", order.deletion() == null ? status(order.status(), order.currentStageCode()) : "已删除");
            if (order.deletion() != null) {
                row(info, "删除前状态", status(order.status(), order.currentStageCode()));
                row(info, "删除时间", time(order.deletion().deletedAt())); row(info, "删除员工", order.deletion().employeeName());
                row(info, "删除原因", order.deletion().reason()); row(info, "保留截止时间", time(order.deletion().expiresAt()));
            }
            row(info, "付款状态", label(order.paymentStatus()));
            row(info, "客户姓名", customer.customerName()); row(info, "客户手机号", customer.phone()); row(info, "会员手机号", customer.memberPhone());
            row(info, "客户订购人", customer.buyerName()); row(info, "交付方式", label(plan.type().name())); row(info, "配送地址", plan.address());
            row(info, "收货日期", plan.requestedReceiveDate()); row(info, "取货时间", time(plan.plannedHandoffAt()));
            row(info, "期望收货时间", time(plan.requestedReceiveAt()));
            row(info, "计划出品时间", time(plan.plannedFinishAt())); row(info, "约定总金额（元）", money(order.totalAmountCents()));
            row(info, "录单时间", time(order.createdAt()));
            row(info, "下单员工工号", order.creditedEmployee() == null ? null : order.creditedEmployee().employeeNumber());
            row(info, "下单员工", order.creditedEmployee() == null ? "未归属" : order.creditedEmployee().nickname());
            row(info, "最近更新时间", time(order.updatedAt()));
            var items = sheet(book, "商品明细", "序号", "商品名称", "商品类型", "数量", "单价（元）", "会员价（元）", "商品规格与要求", "制作进度");
            items.setColumnWidth(0, 8 * 256); items.setColumnWidth(3, 8 * 256); items.setColumnWidth(6, 52 * 256);
            var itemNames = new HashMap<UUID, String>(); int sequence = 0;
            for (var item : order.activeItems()) {
                itemNames.put(item.itemId(), "商品 " + (++sequence) + " · " + item.name());
                row(items, sequence, item.name(), label(item.productType()), item.quantity(), money(item.unitPriceCents()), money(item.memberPriceCents()),
                        specifications(item.attributes()), label(item.productionStatus()));
            }
            var notes = sheet(book, "工作备注", "所属商品", "备注内容", "记录员工", "记录时间");
            notes.setColumnWidth(1, 64 * 256);
            for (var note : snapshot.notes()) row(notes, scope(note.itemId(), itemNames), note.content(),
                    note.actorNameSnapshot(), time(note.createdAt()));
            var pictures = sheet(book, "参考图片", "所属商品", "图片名称", "上传员工", "上传时间");
            var drawing = pictures.createDrawingPatriarch();
            for (var image : snapshot.images()) {
                row(pictures, scope(image.itemId(), itemNames), image.filename(), image.uploaderNameSnapshot(), time(image.uploadedAt()));
                int firstRow = pictures.getLastRowNum() + 1;
                for (int i = 0; i < 18; i++) pictures.createRow(firstRow + i).setHeightInPoints(15);
                String captured = snapshot.imageFiles().get(image.imageId());
                var bytes = captured == null ? images.content(image.orderId(), image.imageId()).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND"))
                        : Files.readAllBytes(Path.of(captured));
                int index = book.addPicture(bytes, image.contentType().equals("image/png") ? Workbook.PICTURE_TYPE_PNG : Workbook.PICTURE_TYPE_JPEG);
                var anchor = book.getCreationHelper().createClientAnchor();
                anchor.setCol1(0); anchor.setRow1(firstRow); anchor.setAnchorType(ClientAnchor.AnchorType.MOVE_DONT_RESIZE);
                double scale = Math.min(1, Math.min(480.0 / image.width(), 320.0 / image.height()));
                // 单个绘图块保留 360px 高度，使用绝对尺寸保持比例且避免与下一张图片重叠。
                double width = image.width() * scale, height = image.height() * scale;
                int lastColumn = 0;
                while (width >= pictures.getColumnWidthInPixels(lastColumn)) width -= pictures.getColumnWidthInPixels(lastColumn++);
                anchor.setCol2(lastColumn); anchor.setDx2(Units.pixelToEMU((int) Math.round(width)));
                anchor.setRow2(firstRow + (int) (height / 20)); anchor.setDy2(Units.pixelToEMU((int) Math.round(height % 20)));
                drawing.createPicture(anchor, index);
            }
            for (int i = 0; i < book.getNumberOfSheets(); i++) {
                var sheet = book.getSheetAt(i);
                book.setPrintArea(i, 0, Math.max(1, sheet.getRow(0).getLastCellNum() - 1), 0, sheet.getLastRowNum());
            }
            book.write(output);
        }
    }
    private static Sheet sheet(XSSFWorkbook book, String name, String... headings) {
        var sheet = book.createSheet(name);
        for (int i = 0; i < headings.length; i++) sheet.setColumnWidth(i, (i == 0 ? 38 : 28) * 256);
        sheet.createFreezePane(0, 1);
        sheet.setDefaultRowHeightInPoints(30);
        sheet.setFitToPage(true);
        sheet.getPrintSetup().setPaperSize(PrintSetup.A4_PAPERSIZE);
        sheet.getPrintSetup().setFitWidth((short) 1); sheet.getPrintSetup().setFitHeight((short) 0);
        sheet.setRepeatingRows(new org.apache.poi.ss.util.CellRangeAddress(0, 0, -1, -1));
        row(sheet, (Object[]) headings);
        var style = book.createCellStyle(); var font = book.createFont(); font.setBold(true); style.setFont(font); style.setWrapText(true);
        var body = book.createCellStyle(); body.setWrapText(true); body.setVerticalAlignment(VerticalAlignment.TOP);
        for (int i = 0; i < headings.length; i++) sheet.setDefaultColumnStyle(i, body);
        for (var cell : sheet.getRow(0)) cell.setCellStyle(style);
        return sheet;
    }
    /** 长文本续行保留全部内容，同时限制单行高度，方便 WPS 显示和打印。 */
    private static void row(Sheet sheet, Object... values) {
        var text = Arrays.stream(values).map(value -> value == null ? "" : value.toString()).toArray(String[]::new);
        int[] offset = new int[text.length]; boolean more;
        do {
            int index = sheet.getPhysicalNumberOfRows() == 0 ? 0 : sheet.getLastRowNum() + 1;
            if (index >= 1_048_576) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
            var row = sheet.createRow(index); more = false; int lines = 1;
            for (int i = 0; i < text.length; i++) {
                int end = Math.min(text[i].length(), offset[i] + 320);
                if (end < text[i].length() && Character.isHighSurrogate(text[i].charAt(end - 1))) end--;
                String part = text[i].substring(offset[i], end);
                var cell = row.createCell(i, CellType.STRING); cell.setCellValue(part);
                if (sheet.getColumnStyle(i) != null) cell.setCellStyle(sheet.getColumnStyle(i));
                int width = Math.max(8, sheet.getColumnWidth(i) / 512);
                int wrapped = Arrays.stream(part.split("\n", -1)).mapToInt(line -> Math.max(1, (line.length() + width - 1) / width)).sum();
                lines = Math.max(lines, wrapped);
                offset[i] = end; more |= end < text[i].length();
            }
            row.setHeightInPoints(Math.min(409, Math.max(30, lines * 15 + 6)));
        } while (more);
    }
    private static String money(Long cents) { return cents == null ? "未填写" : BigDecimal.valueOf(cents, 2).toPlainString(); }
    private static String time(Instant instant) { return instant == null ? "未填写" : TIME.format(instant); }
    private static String scope(UUID itemId, Map<UUID, String> names) { return itemId == null ? "整张订单" : names.getOrDefault(itemId, "历史商品"); }
    private static String status(String status, String stage) { return label("PROCESSING".equals(status) && stage != null ? stage : status); }
    private static String label(String code) {
        if (code == null || code.isBlank()) return "未填写";
        return switch (code) {
            case "WAITING_PRODUCTION" -> "待制作"; case "PROCESSING" -> "生胚中";
            case "WAITING_DELIVERY" -> "待配送"; case "WAITING_PICKUP" -> "待自提";
            case "DELIVERING" -> "配送中"; case "COMPLETED" -> "已完成"; case "CANCELLED" -> "已取消";
            case "LAYER_DONE" -> "已夹层"; case "FROSTING_DONE" -> "已抹面"; case "OTHER_DONE" -> "其他已确认";
            case "PAID" -> "已付款"; case "UNPAID" -> "未付款";
            case "DELIVERY" -> "配送上门"; case "PICKUP" -> "门店自提";
            case "CAKE" -> "蛋糕"; case "DONUT" -> "甜甜圈"; case "CUPCAKE" -> "纸杯蛋糕";
            case "BREAD" -> "面包"; case "DRINK" -> "饮品"; case "OTHER" -> "其他茶歇";
            case "NOT_STARTED" -> "未开始"; case "IN_PROGRESS" -> "制作中";
            default -> code;
        };
    }
    private static final Map<String, String> SPECIFICATIONS = Map.ofEntries(
            Map.entry("size", "尺寸（寸）"), Map.entry("flavor", "奶油"), Map.entry("base", "内胚"), Map.entry("cakeBase", "内胚"),
            Map.entry("filling", "夹馅"), Map.entry("message", "祝福语"), Map.entry("specification", "规格"),
            Map.entry("requirements", "其他要求"), Map.entry("otherRequirements", "其他要求"));
    private static String specifications(Map<String, Object> attributes) {
        return attributes.entrySet().stream().map(entry -> SPECIFICATIONS.getOrDefault(entry.getKey(), entry.getKey()) + "：" + text(entry.getValue()))
                .collect(java.util.stream.Collectors.joining("\n"));
    }
    private static String text(Object value) {
        if (value == null) return "未填写";
        if (value instanceof Map<?, ?> map) return map.entrySet().stream().map(entry -> entry.getKey() + "：" + text(entry.getValue())).collect(java.util.stream.Collectors.joining("；"));
        if (value instanceof Collection<?> list) return list.stream().map(PoiOrderExportFiles::text).collect(java.util.stream.Collectors.joining("、"));
        return value.toString();
    }

    static final class BoundedOutputStream extends FilterOutputStream {
        private final long limit;
        private long written;
        BoundedOutputStream(OutputStream output, long limit) { super(output); this.limit = limit; }
        private void reserve(int length) {
            if (length > limit - written) throw new OrderFailure("EXPORT_FILE_TOO_LARGE");
            written += length;
        }
        @Override public void write(int value) throws IOException { reserve(1); out.write(value); }
        @Override public void write(byte[] bytes, int offset, int length) throws IOException { reserve(length); out.write(bytes, offset, length); }
    }
}

package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.math.BigDecimal;
import java.nio.file.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.util.Units;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;

public final class PoiOrderExportFiles implements OrderExportFiles {
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(ZoneId.of("Asia/Shanghai"));
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private final OrderImages images;
    private final JsonCodec json;
    private final long xlsxLimit;
    private final long zipLimit;
    public PoiOrderExportFiles(OrderImages images, JsonCodec json) { this(images, json, XLSX_BYTES, ZIP_BYTES); }
    PoiOrderExportFiles(OrderImages images, JsonCodec json, long xlsxLimit, long zipLimit) {
        this.images = images; this.json = json; this.xlsxLimit = xlsxLimit; this.zipLimit = zipLimit;
    }

    @Override public File generate(List<Snapshot> snapshots, String filename, boolean zip) {
        Path path = null;
        try {
            path = Files.createTempFile("wuhoucake-export-", zip ? ".zip" : ".xlsx");
            try (var output = new BoundedOutputStream(Files.newOutputStream(path), zip ? zipLimit : xlsxLimit)) {
                if (zip) {
                    try (var archive = new ZipOutputStream(output)) {
                        for (var snapshot : snapshots) {
                            archive.putNextEntry(new ZipEntry(orderFilename(snapshot)));
                            workbook(snapshot, new BoundedOutputStream(archive, xlsxLimit));
                            archive.closeEntry();
                        }
                    }
                } else workbook(snapshots.getFirst(), output);
            }
            String name = zip ? filename : orderFilename(snapshots.getFirst());
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
        return "订单-" + number + ".xlsx";
    }
    private void workbook(Snapshot snapshot, OutputStream output) throws IOException {
        try (var book = new XSSFWorkbook()) {
            var order = snapshot.order(); var customer = order.customer(); var plan = order.fulfillment();
            var info = sheet(book, "订单", "字段", "内容");
            row(info, "订单号", order.orderNo()); row(info, "订单 ID", order.id()); row(info, "快照版本", order.version());
            row(info, "订单状态", order.status()); row(info, "付款状态", order.paymentStatus()); row(info, "制作节点", order.currentStageCode());
            row(info, "客户", customer.customerName()); row(info, "联系电话", customer.phone()); row(info, "会员电话", customer.memberPhone());
            row(info, "购买人", customer.buyerName()); row(info, "交接方式", plan.type()); row(info, "地址", plan.address());
            row(info, "收货日期", plan.requestedReceiveDate()); row(info, "取货时间", time(plan.plannedHandoffAt()));
            row(info, "计划出品时间", time(plan.plannedFinishAt())); row(info, "约定总金额（元）", money(order.totalAmountCents()));
            row(info, "创建员工 ID", order.createdBy()); row(info, "创建时间", time(order.createdAt()));
            row(info, "下单员工工号", order.creditedEmployee() == null ? null : order.creditedEmployee().employeeNumber());
            row(info, "下单员工", order.creditedEmployee() == null ? "未归属" : order.creditedEmployee().nickname());
            row(info, "确认时间", time(order.confirmedAt())); row(info, "更新时间", time(order.updatedAt()));
            var items = sheet(book, "商品", "商品 ID", "名称", "类型", "数量", "报价（元）", "会员价（元）", "规格 JSON", "制作状态", "制作节点");
            for (var item : order.activeItems()) {
                row(items, item.itemId(), item.name(), item.productType(), item.quantity(), money(item.unitPriceCents()), money(item.memberPriceCents()),
                        json.write(item.attributes()), item.productionStatus(), item.currentStageCode());
            }
            var notes = sheet(book, "备注", "关联对象", "活动 ID", "内容", "员工 ID", "员工昵称", "时间");
            for (var note : snapshot.notes()) row(notes, note.itemId() == null ? "整单" : note.itemId(), note.id(), note.content(),
                    note.actorId(), note.actorNameSnapshot(), time(note.createdAt()));
            var pictures = sheet(book, "图片", "关联对象", "展示名", "上传员工 ID", "上传员工昵称", "上传时间", "图片 ID");
            var drawing = pictures.createDrawingPatriarch();
            for (var image : snapshot.images()) {
                row(pictures, image.itemId() == null ? "整单" : image.itemId(), image.filename(), image.uploadedBy(), image.uploaderNameSnapshot(),
                        time(image.uploadedAt()), image.imageId());
                int firstRow = pictures.getLastRowNum() + 1;
                for (int i = 0; i < 18; i++) pictures.createRow(firstRow + i).setHeightInPoints(15);
                var bytes = images.content(image.orderId(), image.imageId()).orElseThrow(() -> new OrderFailure("IMAGE_NOT_FOUND"));
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
            book.write(output);
        }
    }
    private static Sheet sheet(XSSFWorkbook book, String name, String... headings) {
        var sheet = book.createSheet(name);
        for (int i = 0; i < headings.length; i++) sheet.setColumnWidth(i, (i == 0 ? 38 : 28) * 256);
        sheet.createFreezePane(0, 1);
        row(sheet, (Object[]) headings);
        var style = book.createCellStyle(); var font = book.createFont(); font.setBold(true); style.setFont(font);
        for (var cell : sheet.getRow(0)) cell.setCellStyle(style);
        return sheet;
    }
    /** Excel 单元格最多 32767 个 UTF-16 字符，续行保留每列全部文本。 */
    private static void row(Sheet sheet, Object... values) {
        var text = Arrays.stream(values).map(value -> value == null ? "" : value.toString()).toArray(String[]::new);
        int[] offset = new int[text.length]; boolean more;
        do {
            int index = sheet.getPhysicalNumberOfRows() == 0 ? 0 : sheet.getLastRowNum() + 1;
            if (index >= 1_048_576) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
            var row = sheet.createRow(index); more = false;
            for (int i = 0; i < text.length; i++) {
                int end = Math.min(text[i].length(), offset[i] + 32767);
                if (end < text[i].length() && Character.isHighSurrogate(text[i].charAt(end - 1))) end--;
                row.createCell(i, CellType.STRING).setCellValue(text[i].substring(offset[i], end));
                offset[i] = end; more |= end < text[i].length();
            }
        } while (more);
    }
    private static String money(Long cents) { return cents == null ? "" : BigDecimal.valueOf(cents, 2).toPlainString(); }
    private static String time(Instant instant) { return instant == null ? "" : TIME.format(instant); }

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

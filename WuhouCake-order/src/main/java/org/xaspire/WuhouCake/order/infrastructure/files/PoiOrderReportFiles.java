package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.SpreadsheetVersion;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.apache.poi.ss.util.CellRangeAddress;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.*;
import org.xaspire.WuhouCake.order.domain.port.OrderReportFiles;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.ProductCategories;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;

public final class PoiOrderReportFiles implements OrderReportFiles {
    private static final long MAX_TEXT_BYTES = 8 * 1024 * 1024L;
    private static final long REPORT_XLSX_BYTES = 24L * 1024 * 1024;
    private static final int MAX_CELL_CHARS = SpreadsheetVersion.EXCEL2007.getMaxTextLength();
    private static final int SPEC_COLUMN = 10;
    private static final int SPEC_CHUNK_CHARS = 320;
    private static final int SPEC_CHUNK_NEWLINES = 12;

    @Override public byte[] generate(Filter filter, List<Row> rows, Totals totals, List<SizeSummary> sizes, List<EmployeeSummary> employees,
            List<ProductRow> products, Runnable checkDeadline) {
        if (rows.stream().mapToLong(r -> r.products() == null ? 0 : r.products().getBytes(StandardCharsets.UTF_8).length).sum() > MAX_TEXT_BYTES)
            throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
        var specifications = new ArrayList<String>(products.size());
        long textBytes = 0;
        for (var product : products) {
            checkDeadline.run();
            String specification = CakeSpecifications.historicalSpecification(product.specification(), product.unitPriceCents(), product.memberPriceCents());
            specifications.add(specification);
            textBytes += specification.getBytes(StandardCharsets.UTF_8).length;
            if (product.size() != null) textBytes += product.size().getBytes(StandardCharsets.UTF_8).length;
            for (String value : new String[]{product.name(), product.flavor(), product.base(), product.filling(), product.message(), product.requirements()}) {
                if (value == null) continue;
                if (value.length() > MAX_CELL_CHARS) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
                textBytes += value.getBytes(StandardCharsets.UTF_8).length;
            }
            if (textBytes > MAX_TEXT_BYTES) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
        }
        try (var book = new SXSSFWorkbook(64); var output = new ByteArrayOutputStream()) {
            book.setCompressTempFiles(true);
            var header = book.createCellStyle();
            var font = book.createFont();
            font.setBold(true);
            header.setFont(font);
            var summary = book.createSheet("统计");
            row(summary, "日期口径", filter.allUnpaid() ? "所有历史未付款" : filter.dateBasis().equals("CREATED") ? "录单日期（北京时间）" : "取货日期"); row(summary, "开始日期", filter.from()); row(summary, "结束日期（含当天）", filter.to() == null ? "不限日期" : filter.to().minusDays(1));
            row(summary, "订单状态", label(filter.status())); row(summary, "付款状态", label(filter.paymentStatus())); row(summary, "交接方式", label(filter.fulfillmentType()));
            rowWithLongText(summary, 1, "蛋糕尺寸", filter.size()); row(summary, "归属员工 ID", filter.creditedEmployeeId());
            row(summary, "仅未归属", filter.unassigned()); row(summary, "包含已取消", filter.includeCancelled()); row(summary, "搜索", filter.keyword());
            row(summary, "商品名称", filter.productName());
            row(summary, "下单方式", filter.orderingMethod());
            row(summary, "订单数", totals.orderCount()); row(summary, "匹配商品件数", totals.matchingQuantity()); row(summary, "蛋糕件数", totals.cakeQuantity());
            row(summary, "尺寸未填写蛋糕件数", totals.unclassifiedCakeQuantity());
            row(summary, "匹配订单已填写的约定总额（元）", yuan(totals.totalAmountCents()));
            row(summary, "标记已付款订单约定金额（元）", yuan(totals.paidAmountCents()));
            row(summary, "标记未付款订单约定金额（元）", yuan(totals.unpaidAmountCents()));
            row(summary, "未填写金额订单数", totals.missingAmountOrders());
            row(summary, "统计说明", "付款状态由员工手动标记；金额不等于实收。尺寸按填写文本精确匹配，尺寸和商品名称只统计匹配商品，不分摊整单金额。尺寸订单数为各组去重，混合尺寸订单会进入多组，不可相加。员工业绩按账号合并，名称为最近录单的归属快照；本表用于业绩核对。");
            var sizeSheet = book.createSheet("尺寸统计");
            heading(sizeSheet, header, "蛋糕尺寸", "涉及订单数（组内去重）", "蛋糕件数");
            for (var r : sizes) {
                checkDeadline.run();
                rowWithLongText(sizeSheet, 0, r.size() == null ? "尺寸未填写" : r.size(), r.orderCount(), r.cakeQuantity());
            }
            var employeeSheet = book.createSheet("员工业绩");
            heading(employeeSheet, header, "归属工号", "归属员工（最近录单快照）", "订单数", "匹配商品件数", "蛋糕件数", "已填写约定金额（元）", "标记已付款约定金额（元）", "标记未付款约定金额（元）", "未填写金额订单数", "归属员工 ID");
            for (var r : employees) row(employeeSheet, r.employeeNumber(), r.employeeName() == null ? "未归属" : r.employeeName(), r.orderCount(), r.matchingQuantity(), r.cakeQuantity(),
                    yuan(r.totalAmountCents()), yuan(r.paidAmountCents()), yuan(r.unpaidAmountCents()), r.missingAmountOrders(), r.employeeId());
            var sheet = book.createSheet("订单明细");
            heading(sheet, header, "订单号", "取货日期", "状态", "付款", "客户", "电话", "归属工号", "归属员工", "创建员工 ID", "订单约定金额（元）", "匹配商品件数", "蛋糕件数", "匹配商品");
            for (var r : rows) {
                checkDeadline.run();
                rowWithLongText(sheet, 12, r.orderNo(), r.receiveDate(), label(r.status()), label(r.paymentStatus()), r.customerName(), r.phone(), r.employeeNumber(),
                    r.employeeName() == null ? "未归属" : r.employeeName(), r.createdBy(), r.totalAmountCents() == null ? "" : BigDecimal.valueOf(r.totalAmountCents()).movePointLeft(2).toPlainString(),
                    r.matchingQuantity(), r.cakeQuantity(), r.products());
            }
            var productSheet = book.createSheet("商品明细");
            heading(productSheet, header, "订单号", "商品名称", "商品类型", "数量", "尺寸原值", "奶油", "内胚", "夹馅", "祝福语", "其他要求", "规格");
            var wrap = book.createCellStyle();
            wrap.setWrapText(true);
            for (int i = 0; i < products.size(); i++) {
                checkDeadline.run();
                productRows(productSheet, products.get(i), specifications.get(i), wrap);
            }
            summary.setColumnWidth(0, 24 * 256);
            summary.setColumnWidth(1, 24 * 256);
            filter(sizeSheet, 3);
            filter(employeeSheet, 10);
            filter(sheet, 13);
            filter(productSheet, 11);
            productSheet.setColumnWidth(SPEC_COLUMN, 52 * 256);
            book.write(new PoiOrderExportFiles.BoundedOutputStream(output, REPORT_XLSX_BYTES, checkDeadline));
            return output.toByteArray();
        } catch (IOException failure) { throw new UncheckedIOException(failure); }
    }
    private static void heading(Sheet sheet, CellStyle header, Object... headings) {
        for (var cell : row(sheet, headings)) {
            cell.setCellStyle(header);
            int index = cell.getColumnIndex();
            sheet.setColumnWidth(index, (index == 12 ? 60 : 24) * 256);
        }
        sheet.createFreezePane(0, 1);
    }

    private static void filter(Sheet sheet, int columns) {
        sheet.setAutoFilter(new CellRangeAddress(0, sheet.getLastRowNum(), 0, columns - 1));
    }

    private static void productRows(Sheet sheet, ProductRow product, String specification, CellStyle wrap) {
        int start = 0, part = 1;
        do {
            int end = specificationEnd(specification, start);
            String text = specification.substring(start, end);
            var detail = part == 1
                    ? rowWithLongText(sheet, 4, product.orderNo(), product.name(), ProductCategories.label(product.productType()), product.quantity(),
                            product.size(), product.flavor(), product.base(), product.filling(), product.message(), product.requirements(), text)
                    : row(sheet, product.orderNo(), product.name() + "（续 " + part + "）", "", null, "", "", "", "", "", "", text);
            detail.getCell(SPEC_COLUMN).setCellStyle(wrap);
            int lines = Arrays.stream(text.split("\n", -1)).mapToInt(line -> Math.max(1, (line.length() + 25) / 26)).sum();
            detail.setHeightInPoints(Math.min(409, Math.max(sheet.getDefaultRowHeightInPoints(), lines * 15 + 6)));
            start = end;
            part++;
        } while (start < specification.length());
    }

    private static org.apache.poi.ss.usermodel.Row rowWithLongText(Sheet sheet, int column, Object... values) {
        if (!(values[column] instanceof String text) || text.length() <= MAX_CELL_CHARS) return row(sheet, values);
        int end = cellEnd(text, 0);
        values[column] = text.substring(0, end);
        var first = row(sheet, values);
        while (end < text.length()) {
            int start = end;
            end = cellEnd(text, start);
            var continuation = new Object[column + 1];
            if (column > 0) continuation[0] = values[0];
            continuation[column] = text.substring(start, end);
            row(sheet, continuation);
        }
        return first;
    }

    private static int cellEnd(String text, int start) {
        int end = Math.min(text.length(), start + MAX_CELL_CHARS);
        return end < text.length() && Character.isHighSurrogate(text.charAt(end - 1)) ? end - 1 : end;
    }

    private static int specificationEnd(String text, int start) {
        int end = Math.min(text.length(), start + SPEC_CHUNK_CHARS), newlines = 0;
        for (int i = start; i < end; i++) {
            if (text.charAt(i) == '\n' && ++newlines == SPEC_CHUNK_NEWLINES) return i + 1;
        }
        if (end < text.length() && Character.isSurrogatePair(text.charAt(end - 1), text.charAt(end))) return end - 1;
        return end;
    }

    private static String yuan(String cents) { return new BigDecimal(cents).movePointLeft(2).toPlainString(); }
    private static String label(String value) {
        if (value == null) return "全部";
        return Map.ofEntries(Map.entry("CAKE_BASE", "出胚"), Map.entry("LAYER", "夹层"), Map.entry("FROSTING", "抹面"),
                Map.entry("DECORATING", "装饰"), Map.entry("WAITING_DELIVERY", "待配送"), Map.entry("COMPLETED", "已配送"), Map.entry("CANCELLED", "已取消"),
                Map.entry("PAID", "已付款"), Map.entry("UNPAID", "未付款"), Map.entry("PICKUP", "自提"), Map.entry("DELIVERY", "配送")).getOrDefault(value, value);
    }
    private static org.apache.poi.ss.usermodel.Row row(Sheet sheet, Object... values) {
        int index = sheet.getLastRowNum() + 1;
        if (index >= SpreadsheetVersion.EXCEL2007.getMaxRows()) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
        var row = sheet.createRow(index);
        for (int i = 0; i < values.length; i++) {
            String text = values[i] == null ? "" : String.valueOf(values[i]);
            var cell = row.createCell(i);
            if (values[i] instanceof Number number && Math.abs(number.doubleValue()) < 1_000_000_000_000_000d) cell.setCellValue(number.doubleValue());
            else cell.setCellValue(text);
        }
        return row;
    }
}

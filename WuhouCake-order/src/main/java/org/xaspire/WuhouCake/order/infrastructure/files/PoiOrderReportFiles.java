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
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.*;
import org.xaspire.WuhouCake.order.domain.port.OrderReportFiles;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.model.valobj.ProductCategories;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;

public final class PoiOrderReportFiles implements OrderReportFiles {
    private static final long MAX_TEXT_BYTES = 8 * 1024 * 1024L;
    private static final int MAX_CELL_CHARS = SpreadsheetVersion.EXCEL2007.getMaxTextLength();
    private static final int SPEC_COLUMN = 10;
    private static final int SPEC_CHUNK_CHARS = 320;
    private static final int SPEC_CHUNK_NEWLINES = 12;

    @Override public byte[] generate(Filter filter, List<Row> rows, Totals totals, List<SizeSummary> sizes, List<EmployeeSummary> employees, List<ProductRow> products) {
        if (rows.stream().mapToLong(r -> r.products() == null ? 0 : r.products().getBytes(StandardCharsets.UTF_8).length).sum() > MAX_TEXT_BYTES
                || rows.stream().anyMatch(r -> r.products() != null && r.products().length() > MAX_CELL_CHARS))
            throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
        var specifications = new ArrayList<String>(products.size());
        long textBytes = 0;
        for (var product : products) {
            String specification = CakeSpecifications.historicalSpecification(product.specification(), product.unitPriceCents(), product.memberPriceCents());
            specifications.add(specification);
            textBytes += specification.getBytes(StandardCharsets.UTF_8).length;
            for (String value : new String[]{product.name(), product.size(), product.flavor(), product.base(), product.filling(), product.message(), product.requirements()}) {
                if (value == null) continue;
                if (value.length() > MAX_CELL_CHARS) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
                textBytes += value.getBytes(StandardCharsets.UTF_8).length;
            }
            if (textBytes > MAX_TEXT_BYTES) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
        }
        try (var book = new XSSFWorkbook(); var output = new ByteArrayOutputStream()) {
            var summary = book.createSheet("统计");
            row(summary, "日期口径", filter.allUnpaid() ? "所有历史未付款" : filter.dateBasis().equals("CREATED") ? "录单日期（北京时间）" : "取货日期"); row(summary, "开始日期", filter.from()); row(summary, "结束日期（含当天）", filter.to() == null ? "不限日期" : filter.to().minusDays(1));
            row(summary, "订单状态", label(filter.status())); row(summary, "付款状态", label(filter.paymentStatus())); row(summary, "交接方式", label(filter.fulfillmentType()));
            row(summary, "蛋糕尺寸（寸）", filter.size()); row(summary, "归属员工 ID", filter.creditedEmployeeId());
            row(summary, "仅未归属", filter.unassigned()); row(summary, "包含已取消", filter.includeCancelled()); row(summary, "搜索", filter.keyword());
            row(summary, "商品名称", filter.productName());
            row(summary, "下单方式", filter.orderingMethod());
            row(summary, "订单数", totals.orderCount()); row(summary, "匹配商品件数", totals.matchingQuantity()); row(summary, "蛋糕件数", totals.cakeQuantity());
            row(summary, "尺寸待核对蛋糕件数", totals.unclassifiedCakeQuantity());
            row(summary, "匹配订单已填写的约定总额（元）", yuan(totals.totalAmountCents()));
            row(summary, "标记已付款订单约定金额（元）", yuan(totals.paidAmountCents()));
            row(summary, "标记未付款订单约定金额（元）", yuan(totals.unpaidAmountCents()));
            row(summary, "未填写金额订单数", totals.missingAmountOrders());
            row(summary, "统计说明", "付款状态由员工手动标记；金额不等于实收。尺寸和商品名称只统计匹配商品，不分摊整单金额。尺寸订单数为各组去重，混合尺寸订单会进入多组，不可相加。员工业绩按账号合并，名称为最近录单的归属快照；本表用于业绩核对。");
            var sizeSheet = book.createSheet("尺寸统计");
            row(sizeSheet, "蛋糕尺寸（寸）", "涉及订单数（组内去重）", "蛋糕件数");
            for (var r : sizes) row(sizeSheet, r.size() == null ? "尺寸待核对" : r.size(), r.orderCount(), r.cakeQuantity());
            var employeeSheet = book.createSheet("员工业绩");
            row(employeeSheet, "归属工号", "归属员工（最近录单快照）", "订单数", "匹配商品件数", "蛋糕件数", "已填写约定金额（元）", "标记已付款约定金额（元）", "标记未付款约定金额（元）", "未填写金额订单数", "归属员工 ID");
            for (var r : employees) row(employeeSheet, r.employeeNumber(), r.employeeName() == null ? "未归属" : r.employeeName(), r.orderCount(), r.matchingQuantity(), r.cakeQuantity(),
                    yuan(r.totalAmountCents()), yuan(r.paidAmountCents()), yuan(r.unpaidAmountCents()), r.missingAmountOrders(), r.employeeId());
            var sheet = book.createSheet("订单明细");
            row(sheet, "订单号", "取货日期", "状态", "付款", "客户", "电话", "归属工号", "归属员工", "创建员工 ID", "订单约定金额（元）", "匹配商品件数", "蛋糕件数", "匹配商品");
            for (var r : rows) row(sheet, r.orderNo(), r.receiveDate(), label(r.status()), label(r.paymentStatus()), r.customerName(), r.phone(), r.employeeNumber(),
                    r.employeeName() == null ? "未归属" : r.employeeName(), r.createdBy(), r.totalAmountCents() == null ? "" : BigDecimal.valueOf(r.totalAmountCents()).movePointLeft(2).toPlainString(),
                    r.matchingQuantity(), r.cakeQuantity(), r.products());
            var productSheet = book.createSheet("商品明细");
            row(productSheet, "订单号", "商品名称", "商品类型", "数量", "尺寸原值（寸）", "奶油", "内胚", "夹馅", "祝福语", "其他要求", "规格");
            var wrap = book.createCellStyle();
            wrap.setWrapText(true);
            for (int i = 0; i < products.size(); i++) productRows(productSheet, products.get(i), specifications.get(i), wrap);
            var header = book.createCellStyle(); var font = book.createFont(); font.setBold(true); header.setFont(font);
            for (var s : List.of(summary, sizeSheet, employeeSheet, sheet, productSheet)) {
                for (int i = 0; i < s.getRow(0).getLastCellNum(); i++) s.setColumnWidth(i, (i == 12 ? 60 : 24) * 256);
                if (s != summary) {
                    s.createFreezePane(0, 1);
                    s.setAutoFilter(new org.apache.poi.ss.util.CellRangeAddress(0, s.getLastRowNum(), 0, s.getRow(0).getLastCellNum() - 1));
                    for (var cell : s.getRow(0)) cell.setCellStyle(header);
                }
            }
            productSheet.setColumnWidth(SPEC_COLUMN, 52 * 256);
            book.write(output); return output.toByteArray();
        } catch (IOException failure) { throw new UncheckedIOException(failure); }
    }
    private static void productRows(Sheet sheet, ProductRow product, String specification, CellStyle wrap) {
        int start = 0, part = 1;
        do {
            if (sheet.getLastRowNum() + 1 >= SpreadsheetVersion.EXCEL2007.getMaxRows())
                throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
            int end = specificationEnd(specification, start);
            String text = specification.substring(start, end);
            var detail = part == 1
                    ? row(sheet, product.orderNo(), product.name(), ProductCategories.label(product.productType()), product.quantity(),
                            product.size(), product.flavor(), product.base(), product.filling(), product.message(), product.requirements(), text)
                    : row(sheet, product.orderNo(), product.name() + "（续 " + part + "）", "", null, "", "", "", "", "", "", text);
            detail.getCell(SPEC_COLUMN).setCellStyle(wrap);
            int lines = Arrays.stream(text.split("\n", -1)).mapToInt(line -> Math.max(1, (line.length() + 25) / 26)).sum();
            detail.setHeightInPoints(Math.min(409, Math.max(sheet.getDefaultRowHeightInPoints(), lines * 15 + 6)));
            start = end;
            part++;
        } while (start < specification.length());
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
        var row = sheet.createRow(sheet.getPhysicalNumberOfRows());
        for (int i = 0; i < values.length; i++) {
            String text = values[i] == null ? "" : String.valueOf(values[i]);
            var cell = row.createCell(i);
            if (values[i] instanceof Number number && Math.abs(number.doubleValue()) < 1_000_000_000_000_000d) cell.setCellValue(number.doubleValue());
            else cell.setCellValue(text);
        }
        return row;
    }
}

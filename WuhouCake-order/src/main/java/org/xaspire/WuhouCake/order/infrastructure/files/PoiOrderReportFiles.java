package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.*;
import org.xaspire.WuhouCake.order.domain.port.OrderReportFiles;

public final class PoiOrderReportFiles implements OrderReportFiles {
    @Override public byte[] generate(Filter filter, List<Row> rows, Totals totals, List<SizeSummary> sizes, List<EmployeeSummary> employees, List<ProductRow> products) {
        if (rows.stream().mapToLong(r -> r.products() == null ? 0 : r.products().getBytes(java.nio.charset.StandardCharsets.UTF_8).length).sum() > 8 * 1024 * 1024L
                || rows.stream().anyMatch(r -> r.products() != null && r.products().length() > 32767))
            throw new org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure("REPORT_LIMIT_EXCEEDED");
        long textBytes = 0;
        for (var product : products) for (String value : new String[]{product.name(), product.size(), product.flavor(), product.base(), product.filling(), product.message(), product.requirements()}) {
            if (value == null) continue;
            textBytes += value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
            if (value.length() > 32767 || textBytes > 8 * 1024 * 1024L) throw new org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure("REPORT_LIMIT_EXCEEDED");
        }
        try (var book = new XSSFWorkbook(); var output = new ByteArrayOutputStream()) {
            var summary = book.createSheet("统计");
            row(summary, "日期口径", filter.dateBasis().equals("CREATED") ? "录单日期（北京时间）" : "收货日期"); row(summary, "开始日期", filter.from()); row(summary, "结束日期（含当天）", filter.to().minusDays(1));
            row(summary, "订单状态", label(filter.status())); row(summary, "付款状态", label(filter.paymentStatus())); row(summary, "交接方式", label(filter.fulfillmentType()));
            row(summary, "蛋糕尺寸（寸）", filter.size()); row(summary, "归属员工 ID", filter.creditedEmployeeId());
            row(summary, "仅未归属", filter.unassigned()); row(summary, "包含已取消", filter.includeCancelled()); row(summary, "搜索", filter.keyword());
            row(summary, "订单数", totals.orderCount()); row(summary, "匹配商品件数", totals.matchingQuantity()); row(summary, "蛋糕件数", totals.cakeQuantity());
            row(summary, "尺寸待核对蛋糕件数", totals.unclassifiedCakeQuantity());
            row(summary, "匹配订单已填写的约定总额（元）", yuan(totals.totalAmountCents()));
            row(summary, "标记已付款订单约定金额（元）", yuan(totals.paidAmountCents()));
            row(summary, "标记未付款订单约定金额（元）", yuan(totals.unpaidAmountCents()));
            row(summary, "未填写金额订单数", totals.missingAmountOrders());
            row(summary, "统计说明", "付款状态由员工手动标记；金额不等于实收。尺寸筛选不分摊整单金额。尺寸订单数为各组去重，混合尺寸订单会进入多组，不可相加。员工业绩按账号合并，名称为最近录单的归属快照；本表用于业绩核对。");
            var sizeSheet = book.createSheet("尺寸统计");
            row(sizeSheet, "蛋糕尺寸（寸）", "涉及订单数（组内去重）", "蛋糕件数");
            for (var r : sizes) row(sizeSheet, r.size() == null ? "尺寸待核对" : r.size(), r.orderCount(), r.cakeQuantity());
            var employeeSheet = book.createSheet("员工业绩");
            row(employeeSheet, "归属工号", "归属员工（最近录单快照）", "订单数", "匹配商品件数", "蛋糕件数", "已填写约定金额（元）", "标记已付款约定金额（元）", "标记未付款约定金额（元）", "未填写金额订单数", "归属员工 ID");
            for (var r : employees) row(employeeSheet, r.employeeNumber(), r.employeeName() == null ? "未归属" : r.employeeName(), r.orderCount(), r.matchingQuantity(), r.cakeQuantity(),
                    yuan(r.totalAmountCents()), yuan(r.paidAmountCents()), yuan(r.unpaidAmountCents()), r.missingAmountOrders(), r.employeeId());
            var sheet = book.createSheet("订单明细");
            row(sheet, "订单号", "收货日期", "状态", "付款", "客户", "电话", "归属工号", "归属员工", "创建员工 ID", "订单约定金额（元）", "匹配商品件数", "蛋糕件数", "匹配商品");
            for (var r : rows) row(sheet, r.orderNo(), r.receiveDate(), label(r.status()), label(r.paymentStatus()), r.customerName(), r.phone(), r.employeeNumber(),
                    r.employeeName() == null ? "未归属" : r.employeeName(), r.createdBy(), r.totalAmountCents() == null ? "" : BigDecimal.valueOf(r.totalAmountCents()).movePointLeft(2).toPlainString(),
                    r.matchingQuantity(), r.cakeQuantity(), r.products());
            var productSheet = book.createSheet("商品明细");
            row(productSheet, "订单号", "商品名称", "商品类型", "数量", "尺寸原值（寸）", "奶油", "内胚", "夹馅", "祝福语", "其他要求", "商品单价（元）", "会员单价（元）");
            for (var r : products) row(productSheet, r.orderNo(), r.name(), r.productType(), r.quantity(), r.size(), r.flavor(), r.base(), r.filling(), r.message(), r.requirements(),
                    r.unitPriceCents() == null ? "" : yuan(r.unitPriceCents().toString()), r.memberPriceCents() == null ? "" : yuan(r.memberPriceCents().toString()));
            var header = book.createCellStyle(); var font = book.createFont(); font.setBold(true); header.setFont(font);
            for (var s : List.of(summary, sizeSheet, employeeSheet, sheet, productSheet)) {
                for (int i = 0; i < s.getRow(0).getLastCellNum(); i++) s.setColumnWidth(i, (i == 12 ? 60 : 24) * 256);
                if (s != summary) {
                    s.createFreezePane(0, 1);
                    s.setAutoFilter(new org.apache.poi.ss.util.CellRangeAddress(0, s.getLastRowNum(), 0, s.getRow(0).getLastCellNum() - 1));
                    for (var cell : s.getRow(0)) cell.setCellStyle(header);
                }
            }
            book.write(output); return output.toByteArray();
        } catch (IOException failure) { throw new UncheckedIOException(failure); }
    }
    private static String yuan(String cents) { return new BigDecimal(cents).movePointLeft(2).toPlainString(); }
    private static String label(String value) {
        if (value == null) return "全部";
        return Map.ofEntries(Map.entry("WAITING_PRODUCTION", "待制作"), Map.entry("PROCESSING", "制作中"), Map.entry("WAITING_DELIVERY", "待配送"),
                Map.entry("WAITING_PICKUP", "待自提"), Map.entry("DELIVERING", "配送中"), Map.entry("COMPLETED", "已完成"), Map.entry("CANCELLED", "已取消"),
                Map.entry("PAID", "已付款"), Map.entry("UNPAID", "未付款"), Map.entry("PICKUP", "自提"), Map.entry("DELIVERY", "配送")).getOrDefault(value, value);
    }
    private static void row(org.apache.poi.ss.usermodel.Sheet sheet, Object... values) {
        var row = sheet.createRow(sheet.getPhysicalNumberOfRows());
        for (int i = 0; i < values.length; i++) {
            String text = values[i] == null ? "" : String.valueOf(values[i]);
            var cell = row.createCell(i);
            if (values[i] instanceof Number number && Math.abs(number.doubleValue()) < 1_000_000_000_000_000d) cell.setCellValue(number.doubleValue());
            else cell.setCellValue(text);
        }
    }
}

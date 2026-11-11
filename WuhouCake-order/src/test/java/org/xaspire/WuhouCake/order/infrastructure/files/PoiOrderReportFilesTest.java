package org.xaspire.WuhouCake.order.infrastructure.files;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.util.List;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.*;
import static org.junit.jupiter.api.Assertions.*;

class PoiOrderReportFilesTest {
    private static final Filter FILTER = new Filter(LocalDate.of(2026, 11, 10), LocalDate.of(2026, 11, 11),
            null, null, null, null, null, false, false, null, null);

    @Test void exportsLongSpecificationsWithoutChangingProductQuantitiesOrTotals() throws Exception {
        var shortSpec = "短规格";
        var atBoundary = "甲".repeat(320);
        var withPair = "乙".repeat(319) + "😀";
        var thirtyTwoK = "丙".repeat(32767);
        var overCellLimit = "丁".repeat(32768) + "\n" + "备注\n".repeat(20);
        var products = List.of(product("无规格", null, null), product("普通", shortSpec, null),
                product("边界", atBoundary, null), product("表情", withPair, null), product("长规格", thirtyTwoK, null),
                product("超长", overCellLimit, 1230L));
        var specs = List.of("", shortSpec, atBoundary, withPair, thirtyTwoK, overCellLimit + "\n原商品单价：12.30 元（仅供参考）");
        var totals = new Totals(1, 12, 0, 0, "8800", "8800", "0", 0);
        var order = new Row("id", "00001", FILTER.from(), "CAKE_BASE", "PAID", "PICKUP",
                null, null, null, null, 8800L, 12, 0, "6 项", "其他");
        var employee = new EmployeeSummary("employee", "0001", "客服", 1, 12, 0, "8800", "8800", "0", 0);
        byte[] bytes = new PoiOrderReportFiles().generate(FILTER, List.of(order), totals, List.of(), List.of(employee), products);
        try (var workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
            var sheet = workbook.getSheet("商品明细");
            int row = 1;
            for (int i = 0; i < products.size(); i++) {
                var product = products.get(i);
                assertEquals(product.name(), sheet.getRow(row).getCell(1).getStringCellValue());
                assertEquals(2, sheet.getRow(row).getCell(3).getNumericCellValue());
                var reconstructed = new StringBuilder();
                int part = 1;
                do {
                    var detail = sheet.getRow(row++);
                    assertEquals("00001", detail.getCell(0).getStringCellValue());
                    if (part > 1) {
                        assertEquals(product.name() + "（续 " + part + "）", detail.getCell(1).getStringCellValue());
                        assertNotEquals(CellType.NUMERIC, detail.getCell(3).getCellType());
                        assertEquals("", detail.getCell(3).getStringCellValue());
                    }
                    var specification = detail.getCell(10);
                    var text = specification.getStringCellValue();
                    assertTrue(text.length() <= 320);
                    assertTrue(text.isEmpty() || !Character.isHighSurrogate(text.charAt(text.length() - 1)));
                    assertTrue(specification.getCellStyle().getWrapText());
                    assertTrue(detail.getHeightInPoints() <= 409);
                    reconstructed.append(text);
                    part++;
                } while (row <= sheet.getLastRowNum() && sheet.getRow(row).getCell(1).getStringCellValue().startsWith(product.name() + "（续 "));
                assertEquals(specs.get(i), reconstructed.toString());
                if (i <= 2) assertEquals(2, part, "无规格、短规格和整 320 字符均使用一行");
                else assertTrue(part > 2, "长规格或代理对边界需要续行");
            }
            assertEquals(12, workbook.getSheet("订单明细").getRow(1).getCell(10).getNumericCellValue());
            assertEquals("88.00", workbook.getSheet("订单明细").getRow(1).getCell(9).getStringCellValue());
            assertEquals(12, workbook.getSheet("员工业绩").getRow(1).getCell(3).getNumericCellValue());
            assertEquals("88.00", workbook.getSheet("员工业绩").getRow(1).getCell(5).getStringCellValue());
        }
    }

    @Test void checksUtf8ByteLimitIncludingFormattedPriceBeforeWriting() {
        String nearLimit = "文".repeat((8 * 1024 * 1024 - 20) / 3);
        var products = List.of(product("套餐", nearLimit, 1230L));
        var totals = new Totals(1, 2, 0, 0, "8800", "8800", "0", 0);
        assertEquals("REPORT_LIMIT_EXCEEDED", assertThrows(OrderFailure.class,
                () -> new PoiOrderReportFiles().generate(FILTER, List.of(), totals, List.of(), List.of(), products)).code());
    }

    private static ProductRow product(String name, String specification, Long price) {
        return new ProductRow("00001", name, "OTHER", 2, null, null, null, null, null, null, specification, price, null);
    }
}

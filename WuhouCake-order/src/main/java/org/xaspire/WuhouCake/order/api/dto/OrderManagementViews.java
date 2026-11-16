package org.xaspire.WuhouCake.order.api.dto;

import java.time.LocalDate;
import java.util.List;

public final class OrderManagementViews {
    private OrderManagementViews() { }
    public record Row(String orderId, String orderNo, LocalDate receiveDate, String status, String paymentStatus,
            String phone, String customerName, String employeeNumber, String employeeName, String createdBy,
            String totalAmountCents, long matchingQuantity, long cakeQuantity, String products, List<String> productTypes, boolean deleted) { }
    public record Totals(long orderCount, long matchingQuantity, long cakeQuantity, long unclassifiedCakeQuantity, String totalAmountCents,
            String paidAmountCents, String unpaidAmountCents, long missingAmountOrders) { }
    public record SizeSummary(String size, long orderCount, long cakeQuantity) { }
    public record EmployeeSummary(String employeeId, String employeeNumber, String employeeName, long orderCount, long matchingQuantity,
            long cakeQuantity, String totalAmountCents, String paidAmountCents, String unpaidAmountCents, long missingAmountOrders) { }
    public record Result(List<Row> items, Totals totals, List<SizeSummary> sizes, List<EmployeeSummary> employees, int page, int size) {
        public Result { items = List.copyOf(items); sizes = List.copyOf(sizes); employees = List.copyOf(employees); }
    }
}

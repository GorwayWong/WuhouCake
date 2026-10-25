package org.xaspire.WuhouCake.order.domain.port;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.valobj.CakeSpecifications;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public interface OrderManagementQueries {
    record Filter(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
            String size, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis, boolean allUnpaid, boolean deleted) {
        public Filter(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
                String size, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis, boolean allUnpaid) {
            this(from, to, status, paymentStatus, fulfillmentType, size, creditedEmployeeId, unassigned, includeCancelled, keyword, dateBasis, allUnpaid, false);
        }
        public Filter(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
                String size, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis) {
            this(from, to, status, paymentStatus, fulfillmentType, size, creditedEmployeeId, unassigned, includeCancelled, keyword, dateBasis, false);
        }
        public Filter {
            if (deleted) {
                allUnpaid = false; includeCancelled = true;
            }
            if (allUnpaid) {
                from = null; to = null; status = null; paymentStatus = "UNPAID"; fulfillmentType = null; size = null;
                creditedEmployeeId = null; unassigned = false; includeCancelled = true; keyword = null; dateBasis = "CREATED";
            } else if (from == null || to == null || from.getYear() < 1 || to.getYear() > 9999 || !from.isBefore(to) || ChronoUnit.DAYS.between(from, to) > 366) throw invalid();
            status = option(status, Set.of("WAITING_PRODUCTION", "PROCESSING", "WAITING_DELIVERY", "WAITING_PICKUP", "DELIVERING", "COMPLETED", "CANCELLED"));
            paymentStatus = option(paymentStatus, Set.of("PAID", "UNPAID"));
            fulfillmentType = option(fulfillmentType, Set.of("DELIVERY", "PICKUP"));
            dateBasis = option(dateBasis, Set.of("RECEIVE", "CREATED"));
            if (dateBasis == null) dateBasis = "RECEIVE";
            size = CakeSpecifications.size(size);
            if (creditedEmployeeId != null && unassigned) throw invalid();
            if (keyword != null) { keyword = keyword.strip(); if (keyword.isEmpty()) keyword = null; else if (keyword.length() > 100) throw invalid(); }
        }
        private static String option(String value, Set<String> values) {
            if (value == null || value.isBlank()) return null;
            value = value.strip().toUpperCase(Locale.ROOT);
            if (!values.contains(value)) throw invalid();
            return value;
        }
    }
    record Row(String orderId, String orderNo, LocalDate receiveDate, String status, String paymentStatus,
            String phone, String customerName, String employeeNumber, String employeeName, String createdBy,
            Long totalAmountCents, long matchingQuantity, long cakeQuantity, String products, String productTypes) { }
    record Totals(long orderCount, long matchingQuantity, long cakeQuantity, long unclassifiedCakeQuantity, String totalAmountCents,
            String paidAmountCents, String unpaidAmountCents, long missingAmountOrders) { }
    record SizeSummary(String size, long orderCount, long cakeQuantity) { }
    record EmployeeSummary(String employeeId, String employeeNumber, String employeeName, long orderCount, long matchingQuantity,
            long cakeQuantity, String totalAmountCents, String paidAmountCents, String unpaidAmountCents, long missingAmountOrders) { }
    record ProductRow(String orderNo, String name, String productType, long quantity, String size, String flavor, String base,
            String filling, String message, String requirements, Long unitPriceCents, Long memberPriceCents) { }
    List<Row> search(Filter filter, int limit, long offset);
    default long count(Filter filter) { return totals(filter).orderCount(); }
    Totals totals(Filter filter);
    List<SizeSummary> sizes(Filter filter);
    List<EmployeeSummary> employees(Filter filter);
    List<ProductRow> products(Filter filter, int limit);
}

package org.xaspire.WuhouCake.order.api.query;

import java.time.LocalDate;
import java.util.UUID;

public record OrderManagementQuery(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
        String sizeInches, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis, boolean allUnpaid, boolean deleted) {
    public OrderManagementQuery(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
            String sizeInches, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis, boolean allUnpaid) {
        this(from, to, status, paymentStatus, fulfillmentType, sizeInches, creditedEmployeeId, unassigned, includeCancelled, keyword, dateBasis, allUnpaid, false);
    }
    public OrderManagementQuery(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
            String sizeInches, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis) {
        this(from, to, status, paymentStatus, fulfillmentType, sizeInches, creditedEmployeeId, unassigned, includeCancelled, keyword, dateBasis, false);
    }
}

package org.xaspire.WuhouCake.order.api.query;

import java.time.LocalDate;
import java.util.UUID;

public record OrderManagementQuery(LocalDate from, LocalDate to, String status, String paymentStatus, String fulfillmentType,
        String sizeInches, UUID creditedEmployeeId, boolean unassigned, boolean includeCancelled, String keyword, String dateBasis) { }

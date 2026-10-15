package org.xaspire.WuhouCake.order.api.command;

import java.time.LocalDate;

public record OrderExportRequest(LocalDate from, LocalDate to, String status, String fulfillmentType, String paymentStatus) { }

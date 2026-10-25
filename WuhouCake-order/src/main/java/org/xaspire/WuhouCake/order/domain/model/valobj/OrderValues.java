package org.xaspire.WuhouCake.order.domain.model.valobj;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public final class OrderValues {
    private OrderValues() { }
    /** Largest integer cent value that remains exact in numeric JSON browser clients. */
    public static final long MAX_MONEY_CENTS = 9_007_199_254_740_991L;

    public enum FulfillmentType { DELIVERY, PICKUP }

    public record CustomerContact(String customerName, String phone, String memberPhone, String buyerName) {
        public CustomerContact {
            customerName = optionalText(customerName, 80);
            phone = requiredText(phone, 32);
            memberPhone = optionalText(memberPhone, 32);
            buyerName = optionalText(buyerName, 80);
        }
    }
    public record FulfillmentPlan(FulfillmentType type, String address, LocalDate requestedReceiveDate,
            Instant plannedHandoffAt, Instant plannedFinishAt, Instant requestedReceiveAt) {
        public FulfillmentPlan(FulfillmentType type, String address, LocalDate requestedReceiveDate, Instant plannedHandoffAt, Instant plannedFinishAt) {
            this(type, address, requestedReceiveDate, plannedHandoffAt, plannedFinishAt, null);
        }
        public FulfillmentPlan {
            if (type == null || requestedReceiveDate == null) throw invalid();
            if (requestedReceiveAt != null && !requestedReceiveDate.equals(receiveDate(requestedReceiveAt))) throw invalid();
            address = type == FulfillmentType.DELIVERY ? requiredText(address, Integer.MAX_VALUE) : optionalText(address, Integer.MAX_VALUE);
        }
    }
    public static LocalDate receiveDate(Instant value) { return value.atZone(java.time.ZoneId.of("Asia/Shanghai")).toLocalDate(); }
    public record Actor(UUID accountId, String nickname) {
        public Actor {
            if (accountId == null) throw invalid();
            nickname = requiredText(nickname, 100);
        }
    }
    public record Attribution(UUID accountId, String employeeNumber, String nickname) {
        public Attribution {
            if (accountId == null) throw invalid();
            employeeNumber = requiredText(employeeNumber, 32);
            nickname = requiredText(nickname, 100);
        }
    }
    public static String requiredText(Object value, int maximum) {
        if (!(value instanceof String text) || text.isBlank() || text.length() > maximum) throw invalid();
        return text.strip();
    }
    public static String optionalText(String value, int maximum) {
        if (value == null) return null;
        if (value.length() > maximum) throw invalid();
        return value.isBlank() ? null : value.strip();
    }
    public static long nonNegativeInteger(Object value) {
        if (!(value instanceof Number number) || number instanceof Double || number instanceof Float) throw invalid();
        try {
            long result = new BigDecimal(number.toString()).longValueExact();
            if (result < 0) throw invalid();
            return result;
        } catch (ArithmeticException | NumberFormatException failure) { throw invalid(); }
    }
    public static Long money(Object value) {
        if (value == null) return null;
        long cents = nonNegativeInteger(value);
        if (cents > MAX_MONEY_CENTS) throw invalid();
        return cents;
    }
    public static int quantity(Object value) {
        long result = nonNegativeInteger(value);
        if (result == 0 || result > Integer.MAX_VALUE) throw invalid();
        return (int) result;
    }
    public static OrderFailure invalid() { return new OrderFailure("VALIDATION_FAILED"); }
}

package org.xaspire.WuhouCake.order.domain.port;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderActivity;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderFileLimits.*;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public interface OrderExportQueries {
    /** 最多返回 EXPORT_ORDERS + 1 个 ID，以检测超限而不截断结果。 */
    List<UUID> select(Filter filter);
    List<OrderActivity> orderNotes(UUID orderId);
    ContentSize contentSize(List<UUID> orderIds);
    record ContentSize(long bytes, long rows) { }

    record Filter(LocalDate from, LocalDate to, String status, String fulfillmentType, String paymentStatus) {
        public Filter {
            if (from == null || to == null || !from.isBefore(to)) throw invalid();
            if (ChronoUnit.DAYS.between(from, to) > EXPORT_DAYS) throw new OrderFailure("EXPORT_LIMIT_EXCEEDED");
            if (status != null && !Set.of("WAITING_PRODUCTION", "PROCESSING", "WAITING_DELIVERY", "WAITING_PICKUP",
                    "DELIVERING", "COMPLETED", "CANCELLED").contains(status)) throw invalid();
            if (fulfillmentType != null && !Set.of("DELIVERY", "PICKUP").contains(fulfillmentType)) throw invalid();
            if (paymentStatus != null && !Set.of("UNPAID", "PAID").contains(paymentStatus)) throw invalid();
        }
        public Map<String, Object> summary() {
            var result = new LinkedHashMap<String, Object>();
            result.put("from", from.toString()); result.put("to", to.toString());
            if (status != null) result.put("status", status);
            if (fulfillmentType != null) result.put("fulfillmentType", fulfillmentType);
            if (paymentStatus != null) result.put("paymentStatus", paymentStatus);
            return result;
        }
    }
}

package org.xaspire.WuhouCake.order.domain.port;

import java.util.List;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.*;

public interface OrderReportFiles {
    default byte[] generate(Filter filter, List<Row> rows, Totals totals, List<SizeSummary> sizes, List<EmployeeSummary> employees, List<ProductRow> products) {
        return generate(filter, rows, totals, sizes, employees, products, () -> { });
    }
    byte[] generate(Filter filter, List<Row> rows, Totals totals, List<SizeSummary> sizes, List<EmployeeSummary> employees,
            List<ProductRow> products, Runnable checkDeadline);
}

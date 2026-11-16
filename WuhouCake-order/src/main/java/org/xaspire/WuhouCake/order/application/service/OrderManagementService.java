package org.xaspire.WuhouCake.order.application.service;

import java.util.List;
import org.springframework.transaction.annotation.*;
import org.springframework.transaction.support.TransactionOperations;
import org.xaspire.WuhouCake.order.api.dto.OrderManagementViews.*;
import org.xaspire.WuhouCake.order.api.query.OrderManagementQuery;
import org.xaspire.WuhouCake.order.domain.port.OrderReportFiles;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries.Filter;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure;
import org.xaspire.WuhouCake.shared.json.JsonCodec;
import static org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.invalid;

public class OrderManagementService {
    private final OrderManagementQueries queries;
    private final OrderReportFiles files;
    private final JsonCodec json;
    private final org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity;
    private final TransactionOperations reportReads;

    public OrderManagementService(OrderManagementQueries queries, OrderReportFiles files, JsonCodec json,
            org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity, TransactionOperations reportReads) {
        this.queries = queries;
        this.files = files;
        this.json = json;
        this.identity = identity;
        this.reportReads = reportReads;
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Result search(OrderManagementQuery query, int page, int size) {
        var filter = filter(query);
        if (page < 1 || size < 1 || size > 100) throw invalid();
        if (filter.deleted()) {
            OrderReadAccess.requireDeletedRead(identity);
            return new Result(rows(queries.search(filter, size, (long) (page - 1) * size), true),
                    new Totals(queries.count(filter), 0, 0, 0, "0", "0", "0", 0), List.of(), List.of(), page, size);
        }
        var totals = totals(queries.totals(filter));
        return new Result(rows(queries.search(filter, size, (long) (page - 1) * size)), totals,
                queries.sizes(filter).stream().map(r -> new SizeSummary(r.size(), r.orderCount(), r.cakeQuantity())).toList(),
                queries.employees(filter).stream().map(r -> new EmployeeSummary(r.employeeId(), r.employeeNumber(), r.employeeName(), r.orderCount(),
                        r.matchingQuantity(), r.cakeQuantity(), r.totalAmountCents(), r.paidAmountCents(), r.unpaidAmountCents(), r.missingAmountOrders())).toList(), page, size);
    }
    public byte[] export(OrderManagementQuery query) {
        var checkDeadline = OrderExportService.exportDeadline();
        var filter = filter(query);
        if (filter.deleted()) throw new OrderFailure("DELETED_REPORT_UNAVAILABLE");
        var snapshot = reportReads.execute(status -> {
            var totals = queries.totals(filter);
            if (totals.orderCount() > 10000) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
            var products = queries.products(filter, 50001);
            if (products.size() > 50000) throw new OrderFailure("REPORT_LIMIT_EXCEEDED");
            return new ReportSnapshot(queries.search(filter, 10001, 0), totals, queries.sizes(filter), queries.employees(filter), products);
        });
        checkDeadline.run();
        return files.generate(filter, snapshot.rows(), snapshot.totals(), snapshot.sizes(), snapshot.employees(), snapshot.products(), checkDeadline);
    }

    private record ReportSnapshot(List<OrderManagementQueries.Row> rows, OrderManagementQueries.Totals totals,
            List<OrderManagementQueries.SizeSummary> sizes, List<OrderManagementQueries.EmployeeSummary> employees,
            List<OrderManagementQueries.ProductRow> products) { }

    static Filter filter(OrderManagementQuery q) { return new Filter(q.from(), q.to(), q.status(), q.paymentStatus(), q.fulfillmentType(),
            q.sizeInches(), q.creditedEmployeeId(), q.unassigned(), q.includeCancelled(), q.keyword(), q.dateBasis(), q.allUnpaid(), q.deleted(), q.productName(), q.orderingMethod()); }
    private static Totals totals(OrderManagementQueries.Totals t) { return new Totals(t.orderCount(), t.matchingQuantity(), t.cakeQuantity(), t.unclassifiedCakeQuantity(), t.totalAmountCents(), t.paidAmountCents(), t.unpaidAmountCents(), t.missingAmountOrders()); }
    private List<Row> rows(List<OrderManagementQueries.Row> rows) {
        return rows(rows, false);
    }
    private List<Row> rows(List<OrderManagementQueries.Row> rows, boolean deleted) {
        return rows.stream().map(r -> new Row(r.orderId(), r.orderNo(), r.receiveDate(), r.status(), r.paymentStatus(), r.phone(),
                r.customerName(), r.employeeNumber(), r.employeeName(), r.createdBy(), r.totalAmountCents() == null ? null : r.totalAmountCents().toString(), r.matchingQuantity(), r.cakeQuantity(), r.products(),
                List.of(json.read(r.productTypes(), String[].class)), deleted)).toList();
    }
}

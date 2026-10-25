package org.xaspire.WuhouCake.order.infrastructure.persistence.repository;

import java.util.List;
import org.xaspire.WuhouCake.order.domain.port.OrderManagementQueries;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderManagementMapper;

public final class PostgresOrderManagementQueries implements OrderManagementQueries {
    private final OrderManagementMapper mapper;
    public PostgresOrderManagementQueries(OrderManagementMapper mapper) { this.mapper = mapper; }
    @Override public List<Row> search(Filter filter, int limit, long offset) { return mapper.search(filter, limit, offset); }
    @Override public Totals totals(Filter filter) { return mapper.totals(filter); }
    @Override public long count(Filter filter) { return mapper.count(filter); }
    @Override public List<SizeSummary> sizes(Filter filter) { return mapper.sizes(filter); }
    @Override public List<EmployeeSummary> employees(Filter filter) { return mapper.employees(filter); }
    @Override public List<ProductRow> products(Filter filter, int limit) { return mapper.products(filter, limit); }
}

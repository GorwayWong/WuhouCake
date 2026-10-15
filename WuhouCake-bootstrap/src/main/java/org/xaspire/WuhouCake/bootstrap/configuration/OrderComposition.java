package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.*;
import org.springframework.context.ApplicationEventPublisher;
import org.xaspire.WuhouCake.order.domain.port.*;
import org.xaspire.WuhouCake.order.application.service.*;
import org.xaspire.WuhouCake.order.infrastructure.files.*;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderImageMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.xaspire.WuhouCake.order.domain.repository.*;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderMapper;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderActivityMapper;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderQueryMapper;
import org.xaspire.WuhouCake.order.infrastructure.persistence.repository.*;
import org.xaspire.WuhouCake.shared.id.IdGenerator;
import org.xaspire.WuhouCake.shared.json.JsonCodec;

@Configuration(proxyBeanMethods = false)
@MapperScan(basePackageClasses = OrderMapper.class)
public class OrderComposition {
    @Bean OrderImages orderImages(OrderImageMapper mapper) { return new PostgresOrderImages(mapper); }
    @Bean OrderImageValidator orderImageValidator() { return new JavaOrderImageValidator(); }
    @Bean OrderImageService orderImageService(Orders orders, OrderImages images, OrderImageValidator validator,
            PlatformTransactionManager transactions, IdGenerator ids, Clock clock, OrderActivities activities, ApplicationEventPublisher events) {
        var writes = new TransactionTemplate(transactions);
        writes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        return new OrderImageService(orders, images, validator, writes, ids, clock, activities, events);
    }
    @Bean OrderExportQueries orderExportQueries(OrderQueryMapper queries, OrderActivityMapper activities, JsonCodec json) {
        return new PostgresOrderExportQueries(queries, activities, json);
    }
    @Bean OrderExportFiles orderExportFiles(OrderImages images, JsonCodec json) { return new PoiOrderExportFiles(images, json); }
    @Bean OrderExportSnapshotService orderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images) {
        return new OrderExportSnapshotService(orders, activities, queries, images);
    }
    @Bean OrderExportLogService orderExportLogService(OrderActivities activities, Clock clock) { return new OrderExportLogService(activities, clock); }
    @Bean OrderExportService orderExportService(OrderExportSnapshotService snapshots, OrderExportLogService logs, OrderExportFiles files, IdGenerator ids) {
        return new OrderExportService(snapshots, logs, files, ids);
    }
    @Bean OrderQueries orderQueries(OrderQueryMapper mapper, JsonCodec json) { return new PostgresOrderQueries(mapper, json); }
    @Bean OrderQueryService orderQueryService(OrderQueries queries) { return new OrderQueryService(queries); }
    @Bean Orders orders(OrderMapper mapper, JsonCodec json) { return new PostgresOrders(mapper, json); }
    @Bean OrderActivities orderActivities(OrderActivityMapper mapper, JsonCodec json) {
        return new PostgresOrderActivities(mapper, json);
    }
    @Bean OrderService orderService(Orders orders, OrderActivities activities, IdGenerator ids, Clock clock, ApplicationEventPublisher events) {
        return new OrderService(orders, activities, ids, clock, events);
    }
}

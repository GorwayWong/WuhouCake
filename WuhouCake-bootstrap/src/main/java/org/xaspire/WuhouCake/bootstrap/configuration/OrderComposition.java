package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;
import org.xaspire.WuhouCake.audit.api.facade.AuditFacade;
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
    @Bean OrderPackages orderPackages(org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderPackageMapper mapper, JsonCodec json) { return new PostgresOrderPackages(mapper, json); }
    @Bean OrderPackageService orderPackageService(OrderPackages packages, IdGenerator ids, Clock clock, IdentityFacade identity, AuditFacade audit, JsonCodec json, ApplicationEventPublisher events) { return new OrderPackageService(packages, ids, clock, identity, audit, json, events); }
    @Bean OrderCreations orderCreations(org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderCreationMapper mapper) { return new PostgresOrderCreations(mapper); }
    @Bean OrderCreationService orderCreationService(OrderService orders, OrderCreations creations, JsonCodec json) { return new OrderCreationService(orders, creations, json); }
    @Bean OrderManagementQueries orderManagementQueries(org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderManagementMapper mapper) {
        return new PostgresOrderManagementQueries(mapper);
    }
    @Bean OrderReportFiles orderReportFiles() { return new PoiOrderReportFiles(); }
    @Bean OrderManagementService orderManagementService(OrderManagementQueries queries, OrderReportFiles files) { return new OrderManagementService(queries, files); }
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
    @Bean OrderExportService orderExportService(OrderExportSnapshotService snapshots, OrderExportFiles files) {
        return new OrderExportService(snapshots, files);
    }
    @Bean OrderQueries orderQueries(OrderQueryMapper mapper, JsonCodec json) { return new PostgresOrderQueries(mapper, json); }
    @Bean OrderQueryService orderQueryService(OrderQueries queries) { return new OrderQueryService(queries); }
    @Bean Orders orders(OrderMapper mapper, JsonCodec json) { return new PostgresOrders(mapper, json); }
    @Bean OrderActivities orderActivities(OrderActivityMapper mapper, JsonCodec json) {
        return new PostgresOrderActivities(mapper, json);
    }
    @Bean OrderService orderService(Orders orders, OrderActivities activities, IdGenerator ids, Clock clock, ApplicationEventPublisher events,
            org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity) {
        return new OrderService(orders, activities, ids, clock, events, identity);
    }
}

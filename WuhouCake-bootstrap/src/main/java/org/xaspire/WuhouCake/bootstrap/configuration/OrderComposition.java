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
    @Bean OrderPackageService orderPackageService(OrderPackages packages, IdGenerator ids, Clock clock, IdentityFacade identity, AuditFacade audit, JsonCodec json, ApplicationEventPublisher events, OrderImageValidator validator, PlatformTransactionManager transactions) { return new OrderPackageService(packages, ids, clock, identity, audit, json, events, validator, new TransactionTemplate(transactions)); }
    @Bean OrderCreations orderCreations(org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderCreationMapper mapper) { return new PostgresOrderCreations(mapper); }
    @Bean OrderCreationService orderCreationService(OrderService orders, OrderCreations creations, JsonCodec json) { return new OrderCreationService(orders, creations, json); }
    @Bean OrderManagementQueries orderManagementQueries(org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderManagementMapper mapper) {
        return new PostgresOrderManagementQueries(mapper);
    }
    @Bean OrderReportFiles orderReportFiles() { return new PoiOrderReportFiles(); }
    @Bean OrderManagementService orderManagementService(OrderManagementQueries queries, OrderReportFiles files, JsonCodec json,
            IdentityFacade identity, PlatformTransactionManager transactions) {
        var reads = new TransactionTemplate(transactions);
        reads.setReadOnly(true);
        reads.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        reads.setTimeout(20);
        return new OrderManagementService(queries, files, json, identity, reads);
    }
    @Bean OrderImages orderImages(OrderImageMapper mapper) { return new PostgresOrderImages(mapper); }
    @Bean OrderImageValidator orderImageValidator(org.springframework.core.env.Environment environment) {
        String endpoint = environment.getProperty("wuhoucake.images.worker-url", "");
        if (!endpoint.isBlank()) return new RemoteOrderImageValidator(java.net.URI.create(endpoint));
        if (environment.acceptsProfiles(org.springframework.core.env.Profiles.of("prod"))) {
            if ("none".equals(environment.getProperty("spring.main.web-application-type"))
                    && !environment.getProperty("wuhoucake.identity.command", "").isBlank())
                return (content, filename) -> { throw new org.xaspire.WuhouCake.order.domain.model.valobj.OrderFailure("IMAGE_PROCESSING_UNAVAILABLE"); };
            throw new IllegalStateException("IMAGE_WORKER_URL is required in prod");
        }
        return new JavaOrderImageValidator();
    }
    @Bean OrderImageService orderImageService(Orders orders, OrderImages images, OrderImageValidator validator,
            PlatformTransactionManager transactions, IdGenerator ids, Clock clock, OrderActivities activities, ApplicationEventPublisher events, IdentityFacade identity) {
        var writes = new TransactionTemplate(transactions);
        writes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        return new OrderImageService(orders, images, validator, writes, ids, clock, activities, events, identity);
    }
    @Bean OrderExportQueries orderExportQueries(OrderQueryMapper queries, OrderActivityMapper activities, JsonCodec json) {
        return new PostgresOrderExportQueries(queries, activities, json);
    }
    @Bean OrderExportFiles orderExportFiles(OrderImages images, PlatformTransactionManager transactions, io.micrometer.core.instrument.MeterRegistry metrics) {
        var legacyReads = new TransactionTemplate(transactions);
        legacyReads.setReadOnly(true);
        legacyReads.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        legacyReads.setTimeout(10);
        return new PoiOrderExportFiles(images, legacyReads, metrics.counter("wuhou.temp.cleanup.failures")::increment);
    }
    @Bean OrderExportSnapshotService orderExportSnapshotService(Orders orders, OrderActivities activities, OrderExportQueries queries, OrderImages images,
            OrderManagementQueries management, IdentityFacade identity) {
        return new OrderExportSnapshotService(orders, activities, queries, images, management, identity);
    }
    @Bean OrderExportService orderExportService(OrderExportSnapshotService snapshots, OrderExportFiles files) {
        return new OrderExportService(snapshots, files);
    }
    @Bean OrderQueries orderQueries(OrderQueryMapper mapper, JsonCodec json) { return new PostgresOrderQueries(mapper, json); }
    @Bean OrderQueryService orderQueryService(OrderQueries queries, Clock clock) { return new OrderQueryService(queries, clock); }
    @Bean Orders orders(OrderMapper mapper, JsonCodec json) { return new PostgresOrders(mapper, json); }
    @Bean OrderActivities orderActivities(OrderActivityMapper mapper, JsonCodec json) {
        return new PostgresOrderActivities(mapper, json);
    }
    @Bean OrderService orderService(Orders orders, OrderActivities activities, IdGenerator ids, Clock clock, ApplicationEventPublisher events,
            org.xaspire.WuhouCake.identity.api.facade.IdentityFacade identity, JsonCodec json) {
        return new OrderService(orders, activities, ids, clock, events, identity, json);
    }
}

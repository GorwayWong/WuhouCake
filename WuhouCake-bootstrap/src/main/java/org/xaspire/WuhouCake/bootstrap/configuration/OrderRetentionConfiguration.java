package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.*;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.*;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.xaspire.WuhouCake.order.application.service.OrderRetentionService;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderRetentionMapper;
import org.xaspire.WuhouCake.order.infrastructure.persistence.repository.PostgresOrderRetention;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name = "wuhoucake.maintenance.recompress-images", havingValue = "false", matchIfMissing = true)
public class OrderRetentionConfiguration {
    @Bean OrderRetentionService orderRetentionService(OrderRetentionMapper mapper, PlatformTransactionManager manager, Clock clock) {
        var transactions = new TransactionTemplate(manager);
        transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return new OrderRetentionService(new PostgresOrderRetention(mapper), transactions, clock);
    }
    @Bean RetentionJob orderRetentionJob(OrderRetentionService service) { return new RetentionJob(service); }
    static final class RetentionJob {
        private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(RetentionJob.class);
        private final OrderRetentionService service;
        RetentionJob(OrderRetentionService service) { this.service = service; }
        @EventListener(ApplicationReadyEvent.class)
        public void start() { clean(); }
        @Scheduled(initialDelay = 3_600_000, fixedDelay = 3_600_000)
        public void clean() {
            try { service.purgeExpired(); }
            catch (RuntimeException failure) { LOG.error("order_retention_unavailable failureType={}", failure.getClass().getSimpleName()); }
        }
    }
}

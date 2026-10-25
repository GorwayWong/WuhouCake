package org.xaspire.WuhouCake.bootstrap.configuration;

import org.slf4j.*;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.xaspire.WuhouCake.order.application.service.OrderImageMaintenanceService;
import org.xaspire.WuhouCake.order.domain.port.OrderImageValidator;
import org.xaspire.WuhouCake.order.infrastructure.persistence.mapper.OrderImageMaintenanceMapper;
import org.xaspire.WuhouCake.order.infrastructure.persistence.repository.PostgresOrderImageMaintenance;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "wuhoucake.maintenance.recompress-images", havingValue = "true")
public class OrderImageMaintenanceConfiguration {
    private static final Logger LOG = LoggerFactory.getLogger(OrderImageMaintenanceConfiguration.class);
    @Bean ApplicationRunner recompressOrderImages(OrderImageMaintenanceMapper mapper, OrderImageValidator validator, Environment environment) {
        return args -> {
            MaintenanceBackup.require(environment);
            var result = new OrderImageMaintenanceService(new PostgresOrderImageMaintenance(mapper), validator).recompress();
            LOG.info("image_recompression_completed processed={} skipped={} failed={} originalBytes={} storedBytes={}", result.processed(), result.skipped(), result.failed(), result.originalBytes(), result.storedBytes());
            if (result.failed() > 0) throw new IllegalStateException("部分图片处理失败，原图已保留；核对 image_recompression_failed 后可重新运行");
        };
    }
}

package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.xaspire.WuhouCake.order.adapter.web.*;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.order.application.service.OrderImageService;
import org.xaspire.WuhouCake.order.application.service.OrderExportService;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class OrderWebComposition {
    @Bean OrderPackageController orderPackageController(org.xaspire.WuhouCake.order.application.service.OrderPackageService service) { return new OrderPackageController(service); }
    @Bean org.xaspire.WuhouCake.order.adapter.web.OrderManagementController orderManagementController(org.xaspire.WuhouCake.order.application.service.OrderManagementService service, OrderExportService exports) {
        return new org.xaspire.WuhouCake.order.adapter.web.OrderManagementController(service, exports);
    }
    @Bean OrderFileController orderFileController(OrderImageService images, OrderExportService exports) { return new OrderFileController(images, exports); }
    @Bean OrderController orderController(OrderService orders, org.xaspire.WuhouCake.order.application.service.OrderCreationService creations) { return new OrderController(orders, creations); }
    @Bean OrderQueryController orderQueryController(OrderQueryService queries) { return new OrderQueryController(queries); }
    @Bean(destroyMethod = "shutdownNow") ScheduledExecutorService orderStreamScheduler() {
        var scheduler = new ScheduledThreadPoolExecutor(1, Thread.ofPlatform().name("order-stream-timer-", 0).factory());
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }
    @Bean(destroyMethod = "shutdownNow") ExecutorService orderStreamSender() {
        return new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(OrderStreams.MAX_CONNECTIONS), Thread.ofPlatform().name("order-stream-send-", 0).factory());
    }
    @Bean(destroyMethod = "close") OrderStreams orderStreams(Clock clock,
            @Qualifier("orderStreamScheduler") ScheduledExecutorService scheduler,
            @Qualifier("orderStreamSender") ExecutorService sender,
            io.micrometer.core.instrument.MeterRegistry metrics) {
        var streams = new OrderStreams(clock, scheduler, sender);
        metrics.gauge("wuhou.sse.connections", streams, OrderStreams::connectionCount);
        io.micrometer.core.instrument.FunctionCounter.builder("wuhou.sse.rejected", streams, OrderStreams::rejectedCount).register(metrics);
        io.micrometer.core.instrument.FunctionCounter.builder("wuhou.sse.send.failures", streams, OrderStreams::sendFailureCount).register(metrics);
        io.micrometer.core.instrument.FunctionCounter.builder("wuhou.sse.queue.overflows", streams, OrderStreams::overflowCount).register(metrics);
        return streams;
    }
    @Bean OrderStreamController orderStreamController(OrderStreams streams, IdentityFacade identity) { return new OrderStreamController(streams, identity); }
}

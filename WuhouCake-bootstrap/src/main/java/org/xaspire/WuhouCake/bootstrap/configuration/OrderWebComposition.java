package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.xaspire.WuhouCake.order.adapter.web.*;
import org.xaspire.WuhouCake.order.application.service.OrderService;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class OrderWebComposition {
    @Bean OrderController orderController(OrderService orders) { return new OrderController(orders); }
    @Bean(destroyMethod = "shutdownNow") ScheduledExecutorService orderStreamScheduler() {
        var scheduler = new ScheduledThreadPoolExecutor(1, Thread.ofPlatform().name("order-stream-timer-", 0).factory());
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }
    @Bean(destroyMethod = "shutdownNow") ExecutorService orderStreamSender() {
        return Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("order-stream-send-", 0).factory());
    }
    @Bean(destroyMethod = "close") OrderStreams orderStreams(Clock clock,
            @Qualifier("orderStreamScheduler") ScheduledExecutorService scheduler,
            @Qualifier("orderStreamSender") ExecutorService sender) {
        return new OrderStreams(clock, scheduler, sender);
    }
    @Bean OrderStreamController orderStreamController(OrderStreams streams) { return new OrderStreamController(streams); }
}

package org.xaspire.WuhouCake.bootstrap.configuration;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.xaspire.WuhouCake.order.adapter.web.OrderController;
import org.xaspire.WuhouCake.order.application.service.OrderService;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class OrderWebComposition {
    @Bean OrderController orderController(OrderService orders) { return new OrderController(orders); }
}

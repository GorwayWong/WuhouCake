package org.xaspire.WuhouCake.bootstrap.configuration;

import java.time.Clock;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.*;
import org.springframework.context.ApplicationEventPublisher;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.application.service.OrderQueryService;
import org.xaspire.WuhouCake.order.domain.port.OrderQueries;
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

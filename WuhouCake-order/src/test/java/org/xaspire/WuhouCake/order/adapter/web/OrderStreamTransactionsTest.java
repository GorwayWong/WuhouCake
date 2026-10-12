package org.xaspire.WuhouCake.order.adapter.web;

import java.io.IOException;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.*;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.xaspire.WuhouCake.order.api.command.OrderCommands;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.application.service.OrderService;
import org.xaspire.WuhouCake.order.domain.model.aggregate.Order;
import org.xaspire.WuhouCake.order.domain.model.entity.OrderItem;
import org.xaspire.WuhouCake.order.domain.model.valobj.OrderValues.*;
import org.xaspire.WuhouCake.order.domain.repository.*;
import org.xaspire.WuhouCake.shared.id.IdGenerator;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderStreamTransactionsTest {
    private static final Instant NOW = Instant.parse("2026-10-12T01:00:00Z");
    private final AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
    private final Connection connection = mock(Connection.class);
    private final SseEmitter emitter = mock(SseEmitter.class);
    private final Orders orders = mock(Orders.class);
    private final OrderActivities activities = mock(OrderActivities.class);
    private final OrderCommands.Operator operator = new OrderCommands.Operator(UUID.randomUUID(), "员工");
    private DataSourceTransactionManager manager;
    private Order order;

    @Configuration(proxyBeanMethods = false) @EnableTransactionManagement
    static class Transactions { }

    @BeforeEach void setup() throws Exception {
        var source = mock(DataSource.class); when(source.getConnection()).thenReturn(connection); when(connection.getAutoCommit()).thenReturn(true);
        manager = new DataSourceTransactionManager(source);
        var scheduler = mock(ScheduledExecutorService.class);
        doReturn(mock(ScheduledFuture.class)).when(scheduler).scheduleWithFixedDelay(any(Runnable.class), anyLong(), anyLong(), any(TimeUnit.class));
        doReturn(mock(ScheduledFuture.class)).when(scheduler).schedule(any(Runnable.class), anyLong(), any(TimeUnit.class));
        var clock = Clock.fixed(NOW, ZoneOffset.UTC);
        var streams = new OrderStreams(clock, scheduler, Runnable::run, timeout -> emitter);
        context.register(Transactions.class);
        context.registerBean(PlatformTransactionManager.class, () -> manager);
        context.registerBean(OrderStreams.class, () -> streams);
        context.registerBean(OrderService.class, () -> new OrderService(orders, activities, mock(IdGenerator.class), clock, context));
        context.refresh(); streams.subscribe(NOW.plusSeconds(60));
        order = Order.create(UUID.randomUUID(), "0000001", new CustomerContact(null, "13800000000", null, null),
                new FulfillmentPlan(FulfillmentType.PICKUP, null, LocalDate.of(2026, 10, 16), NOW.plusSeconds(3600), null),
                null, List.of(OrderItem.create(UUID.randomUUID(), "蛋糕", null, 1, null, null, Map.of(), NOW)), operator.accountId(), NOW);
        when(orders.find(order.id())).thenReturn(Optional.of(order));
        when(activities.append(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }
    @AfterEach void close() { context.close(); }
    private OrderChanged event() { return new OrderChanged(order.id(), null, OrderChanged.Type.NOTE, order.version()); }

    @Test void eventWaitsForCommitAndDoesNotRunOutsideATransaction() throws Exception {
        context.publishEvent(event()); verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
        new TransactionTemplate(manager).executeWithoutResult(status -> {
            context.publishEvent(event());
            try { verify(emitter).send(any(SseEmitter.SseEventBuilder.class)); }
            catch (IOException failure) { throw new AssertionError(failure); }
        });
        verify(connection).commit(); verify(emitter, times(2)).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void rollbackAndCommitFailureDoNotNotify() throws Exception {
        new TransactionTemplate(manager).executeWithoutResult(status -> { context.publishEvent(event()); status.setRollbackOnly(); });
        assertThrows(IllegalStateException.class, () -> new TransactionTemplate(manager).executeWithoutResult(status -> {
            context.publishEvent(event()); throw new IllegalStateException("rollback");
        }));
        verify(connection, times(2)).rollback();
        doThrow(new SQLException("commit failed")).when(connection).commit();
        assertThrows(TransactionException.class, () -> new TransactionTemplate(manager).executeWithoutResult(status -> context.publishEvent(event())));
        verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void serviceNoteCommitsAndNotifiesDespiteUnchangedVersion() throws Exception {
        var itemId = order.activeItems().getFirst().itemId();
        var result = context.getBean(OrderService.class).note(order.id(), new OrderCommands.Note(itemId, "少糖"), operator);
        assertEquals("少糖", result.content()); assertEquals(0, order.version());
        verify(connection).commit(); verify(emitter, times(2)).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void serviceFailureRollsBackWithoutNotification() throws Exception {
        doThrow(new IllegalStateException("activity unavailable")).when(activities).append(any());
        assertThrows(IllegalStateException.class, () -> context.getBean(OrderService.class).note(order.id(), new OrderCommands.Note(null, "少糖"), operator));
        verify(connection).rollback(); verify(connection, never()).commit(); verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void sendFailureCannotFailTheCommittedServiceOperation() throws Exception {
        doThrow(new IOException("disconnected")).when(emitter).send(any(SseEmitter.SseEventBuilder.class));
        var result = assertDoesNotThrow(() -> context.getBean(OrderService.class).note(order.id(), new OrderCommands.Note(null, "少糖"), operator));
        assertEquals("少糖", result.content()); verify(connection).commit(); verify(connection, never()).rollback();
    }
}

package org.xaspire.WuhouCake.order.adapter.web;

import java.io.IOException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade.CredentialsRevoked;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OrderStreamsTest {
    private static final Instant NOW = Instant.parse("2026-10-12T01:00:00Z");
    private final Clock clock = mock(Clock.class);
    private final ScheduledExecutorService scheduler = mock(ScheduledExecutorService.class);
    private final ScheduledFuture<?> heartbeat = mock(ScheduledFuture.class), expiry = mock(ScheduledFuture.class);
    private final ArrayDeque<SseEmitter> emitters = new ArrayDeque<>();
    private OrderStreams streams;

    @BeforeEach void setup() {
        when(clock.instant()).thenReturn(NOW);
        doReturn(heartbeat).when(scheduler).scheduleWithFixedDelay(any(Runnable.class), eq(15L), eq(15L), eq(TimeUnit.SECONDS));
        doReturn(expiry).when(scheduler).schedule(any(Runnable.class), anyLong(), eq(TimeUnit.NANOSECONDS));
    }
    @AfterEach void close() { if (streams != null) streams.close(); }
    private OrderStreams streams(Executor sender) {
        return streams = new OrderStreams(clock, scheduler, sender, timeout -> {
            var emitter = emitters.removeFirst(); when(emitter.getTimeout()).thenReturn(timeout); return emitter;
        });
    }
    private SseEmitter emitter() { var emitter = mock(SseEmitter.class); emitters.add(emitter); return emitter; }
    private SseEmitter subscribe(Instant expiresAt) { return streams.subscribe(UUID.randomUUID(), 0, expiresAt, () -> true); }
    private static OrderChanged event(long version) { return new OrderChanged(UUID.randomUUID(), null, OrderChanged.Type.NOTE, version); }
    private static List<Object> data(SseEmitter.SseEventBuilder event) { return event.build().stream().map(value -> value.getData()).toList(); }
    private static String text(SseEmitter.SseEventBuilder event) { return data(event).stream().filter(String.class::isInstance).map(String.class::cast).reduce("", String::concat); }

    @Test void readyPrecedesChangesAndLifetimeIsBoundedByJwtAndFiveMinutes() throws Exception {
        var shortLived = emitter(); var longLived = emitter(); var streams = streams(Runnable::run);
        assertSame(shortLived, subscribe(NOW.plusSeconds(9))); assertEquals(9000L, shortLived.getTimeout());
        subscribe(NOW.plusSeconds(900)); assertEquals(300000L, longLived.getTimeout());
        var change = event(0); streams.changed(change);
        var sent = ArgumentCaptor.forClass(SseEmitter.SseEventBuilder.class);
        verify(shortLived, times(2)).send(sent.capture());
        assertTrue(text(sent.getAllValues().getFirst()).contains("event:ready"));
        assertTrue(text(sent.getAllValues().getLast()).contains("event:order.changed"));
        assertTrue(data(sent.getAllValues().getLast()).contains(change));
        assertThrows(IllegalArgumentException.class, () -> subscribe(NOW));
        assertThrows(IllegalArgumentException.class, () -> subscribe(null));
    }
    @Test void heartbeatIsACommentAndExpiredConnectionsAreClosedBeforeSending() throws Exception {
        var emitter = emitter(); var streams = streams(Runnable::run); subscribe(NOW.plusSeconds(9));
        var tick = ArgumentCaptor.forClass(Runnable.class);
        verify(scheduler).scheduleWithFixedDelay(tick.capture(), eq(15L), eq(15L), eq(TimeUnit.SECONDS));
        tick.getValue().run();
        var sent = ArgumentCaptor.forClass(SseEmitter.SseEventBuilder.class); verify(emitter, times(2)).send(sent.capture());
        assertEquals(":heartbeat\n\n", text(sent.getAllValues().getLast()));
        when(clock.instant()).thenReturn(NOW.plusSeconds(9)); streams.changed(event(1));
        verify(emitter).complete(); verify(expiry).cancel(false);
        streams.changed(event(2)); verify(emitter, times(2)).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void scheduledExpiryAndEveryLifecycleCallbackCleanUp() throws Exception {
        var timed = emitter(); var done = emitter(); var errored = emitter(); var expired = emitter();
        var timeout = ArgumentCaptor.forClass(Runnable.class); var completion = ArgumentCaptor.forClass(Runnable.class);
        @SuppressWarnings("unchecked") var error = (ArgumentCaptor<Consumer<Throwable>>) (ArgumentCaptor<?>) ArgumentCaptor.forClass(Consumer.class);
        var streams = streams(Runnable::run);
        for (int i = 0; i < 4; i++) subscribe(NOW.plusSeconds(60));
        verify(timed).onTimeout(timeout.capture()); verify(done).onCompletion(completion.capture()); verify(errored).onError(error.capture());
        var deadlines = ArgumentCaptor.forClass(Runnable.class);
        verify(scheduler, times(4)).schedule(deadlines.capture(), anyLong(), eq(TimeUnit.NANOSECONDS));
        timeout.getValue().run(); completion.getValue().run(); error.getValue().accept(new IOException()); deadlines.getAllValues().getLast().run();
        streams.changed(event(1));
        for (var emitter : List.of(timed, done, errored, expired)) verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
        verify(expiry, times(4)).cancel(false); verify(timed).complete(); verify(expired).complete();
        timeout.getValue().run(); verify(timed).complete();
    }
    @Test void brokenConnectionDoesNotPreventOtherClientsFromReceiving() throws Exception {
        var broken = emitter(); var healthy = emitter(); var streams = streams(Runnable::run);
        subscribe(NOW.plusSeconds(60)); subscribe(NOW.plusSeconds(60));
        doThrow(new IOException("disconnected")).when(broken).send(any(SseEmitter.SseEventBuilder.class));
        assertDoesNotThrow(() -> streams.changed(event(1))); assertDoesNotThrow(() -> streams.changed(event(2)));
        verify(broken, times(2)).send(any(SseEmitter.SseEventBuilder.class)); verify(healthy, times(3)).send(any(SseEmitter.SseEventBuilder.class));
        verify(expiry).cancel(false);
    }
    @Test void readyFailureDoesNotLeaveARegisteredConnection() throws Exception {
        var emitter = emitter(); doThrow(new IOException()).when(emitter).send(any(SseEmitter.SseEventBuilder.class));
        var streams = streams(Runnable::run); subscribe(NOW.plusSeconds(60)); streams.changed(event(1));
        verify(emitter).send(any(SseEmitter.SseEventBuilder.class)); verify(emitter).complete();
        verify(scheduler, never()).schedule(any(Runnable.class), anyLong(), any(TimeUnit.class));
    }
    @Test void queuedEventsUseOneSerialDrainAndOverflowClosesTheConnection() throws Exception {
        var emitter = emitter(); var tasks = new ArrayDeque<Runnable>(); var streams = streams(tasks::addLast);
        subscribe(NOW.plusSeconds(60)); var first = event(1); var second = event(2);
        streams.changed(first); streams.changed(second); assertEquals(1, tasks.size()); tasks.removeFirst().run();
        var sent = ArgumentCaptor.forClass(SseEmitter.SseEventBuilder.class); verify(emitter, times(3)).send(sent.capture());
        assertTrue(data(sent.getAllValues().get(1)).contains(first)); assertTrue(data(sent.getAllValues().get(2)).contains(second));
        for (int i = 0; i < 65; i++) streams.changed(event(i));
        verify(emitter).complete(); assertEquals(1, tasks.size()); tasks.removeFirst().run();
        verify(emitter, times(3)).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void rejectedSendAndApplicationShutdownAreIsolatedAndCleanUp() throws Exception {
        var emitter = emitter(); var sender = mock(Executor.class);
        doThrow(new RejectedExecutionException()).when(sender).execute(any());
        var streams = streams(sender); subscribe(NOW.plusSeconds(60));
        assertDoesNotThrow(() -> streams.changed(event(1))); verify(emitter).complete(); verify(expiry).cancel(false);
        streams.close(); streams.close(); verify(heartbeat).cancel(false);
        assertThrows(RejectedExecutionException.class, () -> subscribe(NOW.plusSeconds(60)));
    }
    @Test void changeDuringReadyWaitsUntilTheConnectionIsRegistered() throws Exception {
        var emitter = emitter(); var streams = streams(Runnable::run);
        var ready = new CountDownLatch(1); var proceed = new CountDownLatch(1); var changing = new CountDownLatch(1);
        doAnswer(invocation -> {
            if (text(invocation.getArgument(0)).contains("event:ready")) {
                ready.countDown(); assertTrue(proceed.await(3, TimeUnit.SECONDS));
            }
            return null;
        }).when(emitter).send(any(SseEmitter.SseEventBuilder.class));
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var subscription = workers.submit(() -> subscribe(NOW.plusSeconds(60)));
            try {
                assertTrue(ready.await(3, TimeUnit.SECONDS));
                var change = workers.submit(() -> { changing.countDown(); streams.changed(event(1)); });
                assertTrue(changing.await(3, TimeUnit.SECONDS));
                assertThrows(TimeoutException.class, () -> change.get(50, TimeUnit.MILLISECONDS));
                proceed.countDown(); subscription.get(3, TimeUnit.SECONDS); change.get(3, TimeUnit.SECONDS);
                var sent = ArgumentCaptor.forClass(SseEmitter.SseEventBuilder.class); verify(emitter, times(2)).send(sent.capture());
                assertTrue(text(sent.getAllValues().getFirst()).contains("event:ready"));
                assertTrue(text(sent.getAllValues().getLast()).contains("event:order.changed"));
            } finally { proceed.countDown(); }
        }
    }
    @Test void rejectedExpirySchedulingFailsSubscriptionAndRemovesTheConnection() throws Exception {
        var emitter = emitter(); var streams = streams(Runnable::run);
        doThrow(new RejectedExecutionException()).when(scheduler).schedule(any(Runnable.class), anyLong(), any(TimeUnit.class));
        assertThrows(RejectedExecutionException.class, () -> subscribe(NOW.plusSeconds(60)));
        streams.changed(event(1)); verify(emitter).complete(); verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void revocationDropsQueuedEventsForEveryOldConnectionButPreservesOtherAccountsAndNewVersions() throws Exception {
        var first = emitter(); var second = emitter(); var current = emitter(); var other = emitter();
        var tasks = new ArrayDeque<Runnable>(); var streams = streams(tasks::addLast); var account = UUID.randomUUID();
        streams.subscribe(account, 0, NOW.plusSeconds(60), () -> true);
        streams.subscribe(account, 0, NOW.plusSeconds(60), () -> true);
        streams.subscribe(account, 1, NOW.plusSeconds(60), () -> true);
        streams.subscribe(UUID.randomUUID(), 0, NOW.plusSeconds(60), () -> true);
        streams.changed(event(1)); assertEquals(4, tasks.size());
        streams.credentialsRevoked(new CredentialsRevoked(account, 1));
        for (var old : List.of(first, second)) { verify(old).complete(); verify(old).send(any(SseEmitter.SseEventBuilder.class)); }
        verify(current, never()).complete(); verify(other, never()).complete();
        while (!tasks.isEmpty()) tasks.removeFirst().run();
        for (var old : List.of(first, second)) verify(old).send(any(SseEmitter.SseEventBuilder.class));
        verify(current, times(2)).send(any(SseEmitter.SseEventBuilder.class)); verify(other, times(2)).send(any(SseEmitter.SseEventBuilder.class));
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void queuedEventsRecheckAuthenticationAndFailClosedWithoutARevocationNotification(boolean unavailable) throws Exception {
        var emitter = emitter(); var tasks = new ArrayDeque<Runnable>(); var streams = streams(tasks::addLast);
        var active = new AtomicBoolean(true);
        streams.subscribe(UUID.randomUUID(), 0, NOW.plusSeconds(60), () -> {
            if (active.get()) return true;
            if (unavailable) throw new IllegalStateException("authentication unavailable");
            return false;
        });
        streams.changed(event(1)); assertEquals(1, tasks.size()); active.set(false); tasks.removeFirst().run();
        verify(emitter).complete(); verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
        streams.changed(event(2)); assertTrue(tasks.isEmpty());
    }
    @Test void revocationDuringRegistrationCannotLeaveAnOldConnectionOpen() throws Exception {
        var emitter = emitter(); var streams = streams(Runnable::run); var account = UUID.randomUUID();
        assertThrows(IllegalArgumentException.class, () -> streams.subscribe(account, 0, NOW.plusSeconds(60), () -> {
            streams.credentialsRevoked(new CredentialsRevoked(account, 1)); return true;
        }));
        verify(emitter).complete(); verify(emitter, never()).send(any(SseEmitter.SseEventBuilder.class));
        streams.changed(event(1)); verify(emitter, never()).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void heartbeatClosesAnInvalidSessionWithoutWaitingForAnOrderEvent() throws Exception {
        var emitter = emitter(); var streams = streams(Runnable::run); var active = new AtomicBoolean(true);
        streams.subscribe(UUID.randomUUID(), 0, NOW.plusSeconds(60), active::get);
        var tick = ArgumentCaptor.forClass(Runnable.class);
        verify(scheduler).scheduleWithFixedDelay(tick.capture(), eq(15L), eq(15L), eq(TimeUnit.SECONDS));
        active.set(false); tick.getValue().run();
        verify(emitter).complete(); verify(emitter).send(any(SseEmitter.SseEventBuilder.class));
    }
    @Test void revocationWaitsForTheActiveSendAndDiscardsTheFollowingFrames() throws Exception {
        var emitter = emitter(); var sending = new CountDownLatch(1); var release = new CountDownLatch(1); var closing = new CountDownLatch(1);
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var streams = streams(workers); var account = UUID.randomUUID();
            streams.subscribe(account, 0, NOW.plusSeconds(60), () -> true);
            doAnswer(invocation -> { closing.countDown(); return true; }).when(expiry).cancel(false);
            doAnswer(invocation -> { sending.countDown(); assertTrue(release.await(3, TimeUnit.SECONDS)); return null; })
                    .when(emitter).send(any(SseEmitter.SseEventBuilder.class));
            try {
                streams.changed(event(1)); assertTrue(sending.await(3, TimeUnit.SECONDS)); streams.changed(event(2));
                var revoked = workers.submit(() -> streams.credentialsRevoked(new CredentialsRevoked(account, 1)));
                assertTrue(closing.await(3, TimeUnit.SECONDS)); assertFalse(revoked.isDone());
                release.countDown(); revoked.get(3, TimeUnit.SECONDS);
                streams.changed(event(3)); verify(emitter).complete(); verify(emitter, times(2)).send(any(SseEmitter.SseEventBuilder.class));
            } finally { release.countDown(); }
        }
    }
    @Test void queueOverflowDoesNotWaitForTheActiveSendBarrier() throws Exception {
        var emitter = emitter(); var sending = new CountDownLatch(1); var release = new CountDownLatch(1);
        try (var workers = Executors.newVirtualThreadPerTaskExecutor()) {
            var streams = streams(workers); subscribe(NOW.plusSeconds(60));
            doAnswer(invocation -> { sending.countDown(); assertTrue(release.await(5, TimeUnit.SECONDS)); return null; })
                    .when(emitter).send(any(SseEmitter.SseEventBuilder.class));
            try {
                streams.changed(event(1)); assertTrue(sending.await(3, TimeUnit.SECONDS));
                workers.submit(() -> { for (int i = 0; i < 65; i++) streams.changed(event(i)); }).get(3, TimeUnit.SECONDS);
                verify(emitter).complete(); verify(expiry).cancel(false);
            } finally { release.countDown(); }
        }
    }
}

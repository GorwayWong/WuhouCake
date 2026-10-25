package org.xaspire.WuhouCake.order.adapter.web;

import java.io.IOException;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;
import java.util.function.BooleanSupplier;
import org.slf4j.*;
import org.springframework.transaction.event.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.xaspire.WuhouCake.order.application.event.OrderChanged;
import org.xaspire.WuhouCake.order.application.event.OrderPackageChanged;
import org.xaspire.WuhouCake.identity.api.facade.IdentityFacade.CredentialsRevoked;

public final class OrderStreams implements AutoCloseable {
    private static final Logger LOG = LoggerFactory.getLogger(OrderStreams.class);
    private static final Duration MAX_LIFETIME = Duration.ofMinutes(5);
    private static final int MAX_PENDING = 64;
    private final Set<Connection> connections = ConcurrentHashMap.newKeySet();
    private final Clock clock;
    private final ScheduledExecutorService scheduler;
    private final Executor sender;
    private final Function<Long, SseEmitter> emitters;
    private final ScheduledFuture<?> heartbeat;
    private boolean closed;

    public OrderStreams(Clock clock, ScheduledExecutorService scheduler, Executor sender) {
        this(clock, scheduler, sender, SseEmitter::new);
    }
    OrderStreams(Clock clock, ScheduledExecutorService scheduler, Executor sender, Function<Long, SseEmitter> emitters) {
        this.clock = clock; this.scheduler = scheduler; this.sender = sender; this.emitters = emitters;
        heartbeat = scheduler.scheduleWithFixedDelay(this::heartbeat, 15, 15, TimeUnit.SECONDS);
    }
    public synchronized SseEmitter subscribe(UUID accountId, long credentialVersion, Instant expiresAt, BooleanSupplier authorized) {
        if (closed) throw new RejectedExecutionException("Order streams closed");
        var now = clock.instant();
        if (expiresAt == null || !expiresAt.isAfter(now)) throw new IllegalArgumentException("Expired token");
        var deadline = expiresAt.isBefore(now.plus(MAX_LIFETIME)) ? expiresAt : now.plus(MAX_LIFETIME);
        long timeout = Duration.between(now, deadline).toMillis();
        if (timeout < 1) throw new IllegalArgumentException("Expired token");
        var connection = new Connection(emitters.apply(timeout), deadline, Objects.requireNonNull(accountId), credentialVersion, Objects.requireNonNull(authorized));
        connection.emitter.onCompletion(() -> connection.close(false));
        connection.emitter.onTimeout(() -> connection.close(true));
        connection.emitter.onError(failure -> connection.close(false));
        // Register first so a concurrent revocation is either delivered here or observed by authentication.
        connection.register();
        try {
            synchronized (connection.delivery) {
                if (!connection.authorized()) throw new IllegalArgumentException("Inactive session");
                connection.emitter.send(SseEmitter.event().name("ready").data(Map.of()));
            }
            long remaining = Math.max(0, Duration.between(clock.instant(), deadline).toNanos());
            connection.expire(scheduler.schedule(() -> connection.close(true), remaining, TimeUnit.NANOSECONDS));
        } catch (RejectedExecutionException failure) {
            connection.close(true); throw failure;
        } catch (IllegalArgumentException failure) {
            connection.close(true); throw failure;
        } catch (IOException | RuntimeException failure) {
            connection.close(true);
            LOG.debug("order_stream_open_failed failureType={}", failure.getClass().getSimpleName());
        }
        return connection.emitter;
    }
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public synchronized void changed(OrderChanged event) {
        for (var connection : connections) connection.enqueue(SseEmitter.event().name("order.changed").data(event));
    }
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public synchronized void packageChanged(OrderPackageChanged event) {
        for (var connection : connections) connection.enqueue(SseEmitter.event().name("package.changed").data(event));
    }
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void credentialsRevoked(CredentialsRevoked event) {
        for (var connection : connections)
            if (connection.accountId.equals(event.accountId()) && connection.credentialVersion < event.credentialVersion()) connection.revoke();
    }
    private synchronized void heartbeat() {
        for (var connection : connections) connection.enqueue(SseEmitter.event().comment("heartbeat"));
    }
    @Override public synchronized void close() {
        if (closed) return;
        closed = true; heartbeat.cancel(false);
        for (var connection : connections) connection.close(true);
    }

    private final class Connection {
        private final SseEmitter emitter;
        private final Instant deadline;
        private final UUID accountId;
        private final long credentialVersion;
        private final BooleanSupplier authorized;
        private final Object delivery = new Object();
        private final ArrayDeque<SseEmitter.SseEventBuilder> pending = new ArrayDeque<>();
        private ScheduledFuture<?> expiry;
        private boolean sending;
        private volatile boolean closed;

        private Connection(SseEmitter emitter, Instant deadline, UUID accountId, long credentialVersion, BooleanSupplier authorized) {
            this.emitter = emitter; this.deadline = deadline; this.accountId = accountId;
            this.credentialVersion = credentialVersion; this.authorized = authorized;
        }
        private boolean authorized() {
            if (closed || !clock.instant().isBefore(deadline)) return false;
            try { return authorized.getAsBoolean() && !closed; }
            catch (RuntimeException failure) {
                LOG.warn("order_stream_authentication_failed failureType={}", failure.getClass().getSimpleName()); return false;
            }
        }
        private synchronized void register() { if (!closed) connections.add(this); }
        private synchronized void expire(ScheduledFuture<?> task) {
            if (closed) task.cancel(false); else expiry = task;
        }
        private void enqueue(SseEmitter.SseEventBuilder event) {
            boolean start = false, overflow;
            synchronized (this) {
                if (closed) return;
                overflow = pending.size() >= MAX_PENDING;
                if (!overflow) {
                    pending.addLast(event);
                    if (!sending) { sending = true; start = true; }
                }
            }
            if (overflow) { close(true); return; }
            if (start) {
                try { sender.execute(this::drain); }
                catch (RuntimeException failure) { close(true); }
            }
        }
        private void drain() {
            while (true) {
                SseEmitter.SseEventBuilder event;
                synchronized (this) {
                    if (closed) return;
                    event = pending.pollFirst();
                    if (event == null) { sending = false; return; }
                }
                synchronized (delivery) {
                    if (!authorized()) { close(true); return; }
                    try { emitter.send(event); }
                    catch (IOException failure) {
                        // The servlet container completes an emitter after a write I/O failure.
                        close(false); return;
                    } catch (RuntimeException failure) { close(true); return; }
                }
            }
        }
        private boolean invalidate() {
            synchronized (this) {
                if (closed) return false;
                closed = true; pending.clear(); connections.remove(this);
                if (expiry != null) expiry.cancel(false);
                return true;
            }
        }
        private void complete() {
            try { emitter.complete(); }
            catch (RuntimeException failure) { LOG.debug("order_stream_close_failed failureType={}", failure.getClass().getSimpleName()); }
        }
        private void revoke() {
            boolean removed = invalidate();
            // Revocation waits for an in-flight write; ordinary queue cleanup must not wait on this barrier.
            synchronized (delivery) {
                if (removed) complete();
            }
        }
        private void close(boolean complete) { if (invalidate() && complete) complete(); }
    }
}
